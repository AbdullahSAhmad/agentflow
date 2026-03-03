import { EventEmitter } from 'events';
import type { AgentState, AgentEvent, ZoneId, ActivityEntry, TimelineEvent } from '@agentflow/shared';
import { getZoneForTool } from '@agentflow/shared';
import { config } from '../config.js';
import type { ParsedActivity } from '../watcher/jsonl-parser.js';
import type { SessionInfo } from '../watcher/claude-paths.js';

const MAX_HISTORY_PER_AGENT = 500;
const MAX_HISTORY_AGE_MS = 30 * 60 * 1000; // 30 minutes
const MAX_TIMELINE_EVENTS = 5000;
/** How long to wait for identity before promoting a hidden agent (ms) */
const IDENTITY_TIMEOUT_MS = 15_000;

export class AgentStateManager extends EventEmitter {
  private agents = new Map<string, AgentState>();
  private idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private shutdownTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private colorCounter = 0;
  private activityHistory = new Map<string, ActivityEntry[]>();
  private timelineBuffer: TimelineEvent[] = [];
  /** Queue of task descriptions from Agent tool calls, keyed by parent agent ID */
  private pendingSubagentTasks = new Map<string, string[]>();
  /** Queue of agent names from Agent tool calls, keyed by parent agent ID */
  private pendingSubagentNames = new Map<string, string[]>();
  /** Maps sessionId → canonical agent ID (for merging multiple sessions into one agent) */
  private sessionToAgent = new Map<string, string>();
  /** Maps projectDir:agentName → canonical agent ID */
  private namedAgentMap = new Map<string, string>();
  /** Agents that are hidden pending identity confirmation — no events emitted */
  private hiddenAgents = new Set<string>();
  /** Timers to promote hidden agents after timeout */
  private identityTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Queued recipient names from SendMessage calls: projectDir → [{sender, recipient}] */
  private pendingRecipients = new Map<string, Array<{ sender: string; recipient: string }>>();

  getAll(): AgentState[] {
    // Exclude hidden agents from public state
    return Array.from(this.agents.values()).filter(a => !this.hiddenAgents.has(a.id));
  }

  get(id: string): AgentState | undefined {
    return this.agents.get(id);
  }

  getHistory(agentId: string): ActivityEntry[] {
    return this.activityHistory.get(agentId) ?? [];
  }

  getTimeline(): TimelineEvent[] {
    return this.timelineBuffer;
  }

  /** Check if any named agents exist for a given project directory */
  private hasNamedAgentsForProject(projectDir: string): boolean {
    for (const key of this.namedAgentMap.keys()) {
      if (key.startsWith(projectDir + ':')) return true;
    }
    return false;
  }

  private recordTimeline(event: AgentEvent): void {
    this.timelineBuffer.push({
      type: event.type,
      agent: { ...event.agent },
      timestamp: event.timestamp,
    });

    const cutoff = Date.now() - MAX_HISTORY_AGE_MS;
    while (this.timelineBuffer.length > 0 && this.timelineBuffer[0].timestamp < cutoff) {
      this.timelineBuffer.shift();
    }
    if (this.timelineBuffer.length > MAX_TIMELINE_EVENTS) {
      this.timelineBuffer.splice(0, this.timelineBuffer.length - MAX_TIMELINE_EVENTS);
    }
  }

  private addHistory(agentId: string, entry: ActivityEntry): void {
    let entries = this.activityHistory.get(agentId);
    if (!entries) {
      entries = [];
      this.activityHistory.set(agentId, entries);
    }
    entries.push(entry);

    const cutoff = Date.now() - MAX_HISTORY_AGE_MS;
    while (entries.length > 0 && entries[0].timestamp < cutoff) {
      entries.shift();
    }
    if (entries.length > MAX_HISTORY_PER_AGENT) {
      entries.splice(0, entries.length - MAX_HISTORY_PER_AGENT);
    }
  }

  private summarizeToolInput(input: unknown): string {
    if (!input) return '';
    try {
      const obj = input as Record<string, unknown>;
      const summary = obj.command ?? obj.file_path ?? obj.pattern ?? obj.query ?? obj.url ?? obj.content;
      if (typeof summary === 'string') {
        return summary.length > 120 ? summary.slice(0, 117) + '...' : summary;
      }
      const json = JSON.stringify(input);
      return json.length > 120 ? json.slice(0, 117) + '...' : json;
    } catch {
      return '';
    }
  }

  /**
   * Resolve a sessionId to its canonical agent ID.
   */
  private resolveAgentId(sessionId: string): string {
    return this.sessionToAgent.get(sessionId) ?? sessionId;
  }

  /**
   * Merge a hidden agent into an existing named agent.
   * Returns the existing agent if merged, or null.
   */
  private mergeIntoNamed(hiddenId: string, agentName: string, sessionInfo: SessionInfo): AgentState | null {
    const key = `${sessionInfo.projectDir}:${agentName}`;
    const existingId = this.namedAgentMap.get(key);

    if (!existingId || existingId === hiddenId) return null;

    const existing = this.agents.get(existingId);
    if (!existing) return null;

    const hidden = this.agents.get(hiddenId);
    if (hidden) {
      // Transfer accumulated tokens
      existing.totalInputTokens += hidden.totalInputTokens;
      existing.totalOutputTokens += hidden.totalOutputTokens;
      existing.cacheReadTokens += hidden.cacheReadTokens;
      existing.cacheCreationTokens += hidden.cacheCreationTokens;

      // Remove hidden agent
      this.agents.delete(hiddenId);
      this.hiddenAgents.delete(hiddenId);
      const timer = this.idleTimers.get(hiddenId);
      if (timer) clearTimeout(timer);
      this.idleTimers.delete(hiddenId);
      const shutdownTimer = this.shutdownTimers.get(hiddenId);
      if (shutdownTimer) clearTimeout(shutdownTimer);
      this.shutdownTimers.delete(hiddenId);
      const idTimer = this.identityTimers.get(hiddenId);
      if (idTimer) clearTimeout(idTimer);
      this.identityTimers.delete(hiddenId);
    }

    // Redirect future messages from this sessionId to the existing agent
    this.sessionToAgent.set(hiddenId, existingId);

    // Wake up the existing agent
    existing.isIdle = false;
    existing.isDone = false;
    existing.lastActivityAt = Date.now();

    console.log(`Merged session ${hiddenId.slice(0, 12)}… into agent "${agentName}" (${existingId.slice(0, 12)}…)`);
    return existing;
  }

  /**
   * Promote a hidden agent to visible (emit spawn event).
   */
  private promoteAgent(agentId: string): void {
    this.hiddenAgents.delete(agentId);
    const idTimer = this.identityTimers.get(agentId);
    if (idTimer) clearTimeout(idTimer);
    this.identityTimers.delete(agentId);

    const agent = this.agents.get(agentId);
    if (!agent) return;

    console.log(`Promoting hidden agent ${agentId.slice(0, 12)}… (name: ${agent.agentName ?? 'unknown'})`);
    const now = Date.now();
    const spawnEvent = { type: 'agent:spawn', agent: { ...agent }, timestamp: now } satisfies AgentEvent;
    this.recordTimeline(spawnEvent);
    this.emit('agent:spawn', spawnEvent);

    // Also emit current state as an update
    const updateEvent = { type: 'agent:update', agent: { ...agent }, timestamp: now } satisfies AgentEvent;
    this.recordTimeline(updateEvent);
    this.emit('agent:update', updateEvent);
  }

  processMessage(sessionId: string, activity: ParsedActivity, sessionInfo: SessionInfo) {
    // Check if this session has already been merged into another agent
    const canonicalId = this.resolveAgentId(sessionId);
    if (canonicalId !== sessionId) {
      // This session was merged — route to the canonical agent
      const agent = this.agents.get(canonicalId);
      if (agent) {
        this.applyActivity(agent, activity, Date.now(), sessionInfo);
        return;
      }
    }

    let agent = this.agents.get(canonicalId);
    const now = Date.now();

    // --- Handle identity discovery for hidden agents ---
    if (agent && this.hiddenAgents.has(canonicalId)) {
      // Try to discover identity from multiple sources
      let discoveredName = activity.agentName ?? null;

      // If no direct identity, try matching messageSender against queued recipients
      if (!discoveredName && activity.messageSender) {
        discoveredName = this.popRecipientBySender(sessionInfo.projectDir, activity.messageSender);
      }

      if (discoveredName) {
        // Identity discovered! Try to merge into existing named agent
        const merged = this.mergeIntoNamed(canonicalId, discoveredName, sessionInfo);
        if (merged) {
          this.applyActivity(merged, activity, now, sessionInfo);
          return;
        }
        // No existing agent with this name — register and promote
        agent.agentName = discoveredName;
        agent.role = 'team-member';
        this.namedAgentMap.set(`${sessionInfo.projectDir}:${discoveredName}`, canonicalId);
        this.promoteAgent(canonicalId);
        this.applyActivity(agent, activity, now, sessionInfo);
        return;
      }
      // Still hidden — accumulate state silently (no events emitted)
      this.applyActivitySilent(agent, activity, now, sessionInfo);
      return;
    }

    // --- Handle identity discovery for already-visible agents ---
    if (agent && activity.agentName && !agent.agentName) {
      const key = `${sessionInfo.projectDir}:${activity.agentName}`;
      const existingId = this.namedAgentMap.get(key);
      if (existingId && existingId !== canonicalId) {
        // There's already a different agent with this name — merge into it
        const existing = this.agents.get(existingId);
        if (existing) {
          // Transfer tokens
          existing.totalInputTokens += agent.totalInputTokens;
          existing.totalOutputTokens += agent.totalOutputTokens;
          existing.cacheReadTokens += agent.cacheReadTokens;
          existing.cacheCreationTokens += agent.cacheCreationTokens;

          // Remove this agent
          this.agents.delete(canonicalId);
          const t1 = this.idleTimers.get(canonicalId);
          if (t1) clearTimeout(t1);
          this.idleTimers.delete(canonicalId);
          const t2 = this.shutdownTimers.get(canonicalId);
          if (t2) clearTimeout(t2);
          this.shutdownTimers.delete(canonicalId);

          // Redirect
          this.sessionToAgent.set(sessionId, existingId);

          // Shutdown the duplicate sprite on clients
          this.emit('agent:shutdown', {
            type: 'agent:shutdown',
            agent: { id: canonicalId } as AgentState,
            timestamp: now,
          } satisfies AgentEvent);

          // Wake up existing
          existing.isIdle = false;
          existing.isDone = false;
          existing.lastActivityAt = now;
          console.log(`Late-merged agent ${canonicalId.slice(0, 12)}… into "${activity.agentName}" (${existingId.slice(0, 12)}…)`);
          this.applyActivity(existing, activity, now, sessionInfo);
          return;
        }
      }
      // No conflict — just register the name
      agent.agentName = activity.agentName;
      agent.role = 'team-member';
      this.namedAgentMap.set(key, canonicalId);
      console.log(`Agent ${canonicalId.slice(0, 12)}… identified as "${activity.agentName}"`);
    }

    // --- Handle new session ---
    if (!agent) {
      const parentId = sessionInfo.isSubagent ? this.findParentId(sessionInfo.projectDir) : null;
      const taskDescription = parentId ? this.popPendingTask(parentId) : null;
      // Try multiple sources for agent name: pending queue, routing sender, message recipient matching
      let agentName = (parentId ? this.popPendingName(parentId) : null) ?? activity.agentName ?? null;
      if (!agentName && activity.messageSender) {
        agentName = this.popRecipientBySender(sessionInfo.projectDir, activity.messageSender);
      }

      // If we have a name and it matches an existing agent, merge immediately
      if (agentName) {
        const key = `${sessionInfo.projectDir}:${agentName}`;
        const existingId = this.namedAgentMap.get(key);
        if (existingId) {
          const existing = this.agents.get(existingId);
          if (existing) {
            this.sessionToAgent.set(sessionId, existingId);
            existing.isIdle = false;
            existing.isDone = false;
            existing.lastActivityAt = now;
            console.log(`Immediate merge: session ${sessionId.slice(0, 12)}… → agent "${agentName}" (${existingId.slice(0, 12)}…)`);
            this.applyActivity(existing, activity, now, sessionInfo);
            return;
          }
        }
      }

      // Create the agent
      agent = {
        id: sessionId,
        sessionId,
        projectPath: sessionInfo.projectPath,
        projectName: sessionInfo.projectName,
        agentName,
        role: agentName ? 'team-member' : this.determineRole(activity, sessionInfo),
        parentId,
        teamName: null,
        currentZone: 'spawn',
        currentTool: null,
        currentActivity: null,
        messageTarget: null,
        taskDescription,
        speechText: null,
        lastActivityAt: now,
        spawnedAt: now,
        isIdle: false,
        isDone: false,
        isPlanning: false,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        model: activity.model ?? null,
        colorIndex: this.colorCounter++ % 12,
      };
      this.agents.set(sessionId, agent);
      this.sessionToAgent.set(sessionId, sessionId);

      // Decide whether to hide or show immediately
      const shouldHide = sessionInfo.isSubagent
        && !agentName
        && this.hasNamedAgentsForProject(sessionInfo.projectDir);

      if (shouldHide) {
        // Hide this agent — don't emit spawn until we know who it is
        this.hiddenAgents.add(sessionId);
        console.log(`Hiding new session ${sessionId.slice(0, 12)}… (pending identity)`);

        // Timeout: silently discard if identity not discovered in time
        const timer = setTimeout(() => {
          if (this.hiddenAgents.has(sessionId)) {
            console.log(`Identity timeout for ${sessionId.slice(0, 12)}… — discarding (unidentified)`);
            this.hiddenAgents.delete(sessionId);
            this.agents.delete(sessionId);
            this.identityTimers.delete(sessionId);
            const idleT = this.idleTimers.get(sessionId);
            if (idleT) clearTimeout(idleT);
            this.idleTimers.delete(sessionId);
            const shutT = this.shutdownTimers.get(sessionId);
            if (shutT) clearTimeout(shutT);
            this.shutdownTimers.delete(sessionId);
          }
        }, IDENTITY_TIMEOUT_MS);
        this.identityTimers.set(sessionId, timer);

        // Accumulate state silently
        this.applyActivitySilent(agent, activity, now, sessionInfo);
        return;
      }

      // Register named agent
      if (agentName) {
        this.namedAgentMap.set(`${sessionInfo.projectDir}:${agentName}`, sessionId);
      }

      // Visible spawn
      this.addHistory(sessionId, { timestamp: now, kind: 'spawn', zone: 'spawn' });
      const spawnEvent = { type: 'agent:spawn', agent: { ...agent }, timestamp: now } satisfies AgentEvent;
      this.recordTimeline(spawnEvent);
      this.emit('agent:spawn', spawnEvent);
    }

    this.applyActivity(agent, activity, now, sessionInfo);
  }

  /** Apply activity and emit update event (for visible agents) */
  private applyActivity(agent: AgentState, activity: ParsedActivity, now: number, sessionInfo: SessionInfo) {
    this.mutateAgentState(agent, activity, now, sessionInfo);

    // Reset idle timer
    this.resetIdleTimer(agent.id);

    const updateEvent = { type: 'agent:update', agent: { ...agent }, timestamp: now } satisfies AgentEvent;
    this.recordTimeline(updateEvent);
    this.emit('agent:update', updateEvent);
  }

  /** Apply activity silently — no events emitted (for hidden agents) */
  private applyActivitySilent(agent: AgentState, activity: ParsedActivity, now: number, sessionInfo: SessionInfo) {
    this.mutateAgentState(agent, activity, now, sessionInfo);
  }

  /** Mutate agent state based on activity (shared between silent and loud paths) */
  private mutateAgentState(agent: AgentState, activity: ParsedActivity, now: number, _sessionInfo: SessionInfo) {
    const agentId = agent.id;
    agent.lastActivityAt = now;
    agent.isIdle = false;
    agent.isDone = false;

    if (activity.model) {
      agent.model = activity.model;
    }

    switch (activity.type) {
      case 'tool_use': {
        const prevZone = agent.currentZone;
        agent.currentTool = activity.toolName ?? null;
        agent.currentActivity = this.summarizeToolInput(activity.toolInput) || null;
        agent.currentZone = getZoneForTool(activity.toolName ?? '');

        if (activity.toolName === 'EnterPlanMode') {
          agent.isPlanning = true;
        } else if (activity.toolName === 'ExitPlanMode') {
          agent.isPlanning = false;
        }

        if (activity.toolName === 'TeamCreate' && activity.toolInput) {
          agent.teamName = (activity.toolInput as Record<string, unknown>).team_name as string ?? null;
          agent.role = 'team-lead';
        }
        if (activity.toolName === 'SendMessage') {
          agent.currentZone = 'messaging';
          if (activity.toolInput) {
            const input = activity.toolInput as Record<string, unknown>;
            const recipient = input.recipient as string | undefined;
            // Set messageTarget for client-side flow visualization
            agent.messageTarget = recipient ?? null;
            // Queue recipient name so the incoming session can be identified
            const senderIdentity = agent.agentName || (agent.role === 'team-lead' ? 'team-lead' : null);
            if (recipient && senderIdentity) {
              this.queueRecipient(agent.projectPath, senderIdentity, recipient);
            }
          }
        } else {
          agent.messageTarget = null;
        }

        // Queue name + description for incoming subagent
        if (activity.toolName === 'Agent' && activity.toolInput) {
          const input = activity.toolInput as Record<string, unknown>;
          const desc = (input.description ?? input.prompt ?? '') as string;
          if (desc) {
            this.queuePendingTask(agentId, desc.length > 80 ? desc.slice(0, 77) + '...' : desc);
          }
          const name = input.name as string | undefined;
          if (name) {
            this.queuePendingName(agentId, name);
          }
        }

        this.addHistory(agentId, {
          timestamp: now,
          kind: 'tool',
          tool: activity.toolName ?? undefined,
          toolArgs: this.summarizeToolInput(activity.toolInput),
          zone: agent.currentZone,
        });

        if (prevZone !== agent.currentZone) {
          this.addHistory(agentId, {
            timestamp: now,
            kind: 'zone-change',
            zone: agent.currentZone,
            prevZone,
          });
        }
        break;
      }

      case 'text':
        if (activity.text) {
          agent.speechText = activity.text;
          agent.currentActivity = activity.text;
          if (!agent.taskDescription) {
            agent.taskDescription = activity.text;
          }
          this.addHistory(agentId, {
            timestamp: now,
            kind: 'text',
            text: activity.text,
          });
        }
        break;

      case 'token_usage':
        agent.totalInputTokens += activity.inputTokens ?? 0;
        agent.totalOutputTokens += activity.outputTokens ?? 0;
        agent.cacheReadTokens += activity.cacheReadTokens ?? 0;
        agent.cacheCreationTokens += activity.cacheCreationTokens ?? 0;
        this.addHistory(agentId, {
          timestamp: now,
          kind: 'tokens',
          inputTokens: activity.inputTokens ?? 0,
          outputTokens: activity.outputTokens ?? 0,
        });
        break;
    }
  }

  private determineRole(_activity: ParsedActivity, sessionInfo: SessionInfo): AgentState['role'] {
    if (sessionInfo.isSubagent) return 'subagent';
    return 'main';
  }

  private findParentId(projectDir: string): string | null {
    for (const [id, agent] of this.agents) {
      if (agent.projectPath === projectDir && agent.role === 'main') {
        return id;
      }
    }
    for (const [id, agent] of this.agents) {
      if (agent.projectPath === projectDir && agent.role !== 'subagent') {
        return id;
      }
    }
    return null;
  }

  private queuePendingTask(parentId: string, description: string): void {
    let queue = this.pendingSubagentTasks.get(parentId);
    if (!queue) { queue = []; this.pendingSubagentTasks.set(parentId, queue); }
    queue.push(description);
  }

  private popPendingTask(parentId: string): string | null {
    const queue = this.pendingSubagentTasks.get(parentId);
    if (!queue || queue.length === 0) return null;
    return queue.shift()!;
  }

  private queuePendingName(parentId: string, name: string): void {
    let queue = this.pendingSubagentNames.get(parentId);
    if (!queue) { queue = []; this.pendingSubagentNames.set(parentId, queue); }
    queue.push(name);
  }

  private popPendingName(parentId: string): string | null {
    const queue = this.pendingSubagentNames.get(parentId);
    if (!queue || queue.length === 0) return null;
    return queue.shift()!;
  }

  private queueRecipient(projectDir: string, sender: string, recipient: string): void {
    let queue = this.pendingRecipients.get(projectDir);
    if (!queue) { queue = []; this.pendingRecipients.set(projectDir, queue); }
    queue.push({ sender, recipient });
    // Keep queue bounded
    if (queue.length > 50) queue.shift();
  }

  /** Pop a queued recipient name matching a specific sender */
  private popRecipientBySender(projectDir: string, sender: string): string | null {
    const queue = this.pendingRecipients.get(projectDir);
    if (!queue) return null;
    const idx = queue.findIndex(e => e.sender === sender);
    if (idx === -1) return null;
    const entry = queue.splice(idx, 1)[0];
    return entry.recipient;
  }

  private resetIdleTimer(agentId: string) {
    const existing = this.idleTimers.get(agentId);
    if (existing) clearTimeout(existing);

    const existingShutdown = this.shutdownTimers.get(agentId);
    if (existingShutdown) clearTimeout(existingShutdown);

    const timer = setTimeout(() => {
      const agent = this.agents.get(agentId);
      if (agent && !this.hiddenAgents.has(agentId)) {
        agent.isIdle = true;
        agent.isPlanning = false;
        agent.currentZone = 'idle';
        agent.currentTool = null;
        agent.currentActivity = null;
        agent.speechText = null;
        const ts = Date.now();
        this.addHistory(agentId, { timestamp: ts, kind: 'idle', zone: 'idle' });
        const idleEvent = {
          type: 'agent:idle',
          agent: { ...agent },
          timestamp: ts,
        } satisfies AgentEvent;
        this.recordTimeline(idleEvent);
        this.emit('agent:idle', idleEvent);

        this.startShutdownTimer(agentId);
      }
    }, config.idleTimeoutMs);

    this.idleTimers.set(agentId, timer);
  }

  private startShutdownTimer(agentId: string) {
    const existing = this.shutdownTimers.get(agentId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      const agent = this.agents.get(agentId);
      if (agent && agent.isIdle && !agent.isDone) {
        agent.isDone = true;
        console.log(`Agent marked done: ${agentId} (idle for ${config.shutdownTimeoutMs / 1000}s)`);
        const ts = Date.now();
        const updateEvent = { type: 'agent:update', agent: { ...agent }, timestamp: ts } satisfies AgentEvent;
        this.recordTimeline(updateEvent);
        this.emit('agent:update', updateEvent);
      }
    }, config.shutdownTimeoutMs);

    this.shutdownTimers.set(agentId, timer);
  }

  removeDone(): string[] {
    const removed: string[] = [];
    for (const [id, agent] of this.agents) {
      if (agent.isDone) {
        removed.push(id);
        this.shutdown(id);
      }
    }
    return removed;
  }

  shutdown(sessionId: string) {
    const timer = this.idleTimers.get(sessionId);
    if (timer) clearTimeout(timer);
    this.idleTimers.delete(sessionId);

    const shutdownTimer = this.shutdownTimers.get(sessionId);
    if (shutdownTimer) clearTimeout(shutdownTimer);
    this.shutdownTimers.delete(sessionId);

    const idTimer = this.identityTimers.get(sessionId);
    if (idTimer) clearTimeout(idTimer);
    this.identityTimers.delete(sessionId);
    this.hiddenAgents.delete(sessionId);

    const ts = Date.now();
    this.addHistory(sessionId, { timestamp: ts, kind: 'shutdown' });

    const agent = this.agents.get(sessionId);
    if (agent?.agentName) {
      const key = `${agent.projectPath}:${agent.agentName}`;
      if (this.namedAgentMap.get(key) === sessionId) {
        this.namedAgentMap.delete(key);
      }
    }

    for (const [sid, target] of this.sessionToAgent) {
      if (target === sessionId) {
        this.sessionToAgent.delete(sid);
      }
    }

    this.agents.delete(sessionId);

    const shutdownEvent = {
      type: 'agent:shutdown',
      agent: { id: sessionId } as AgentState,
      timestamp: ts,
    } satisfies AgentEvent;
    this.recordTimeline(shutdownEvent);
    this.emit('agent:shutdown', shutdownEvent);
  }
}
