import { EventEmitter } from 'events';
import type { AgentState, AgentEvent, ZoneId, ActivityEntry, TimelineEvent } from '@agentflow/shared';
import { getZoneForTool } from '@agentflow/shared';
import { config } from '../config.js';
import type { ParsedActivity } from '../watcher/jsonl-parser.js';
import type { SessionInfo } from '../watcher/claude-paths.js';

const MAX_HISTORY_PER_AGENT = 500;
const MAX_HISTORY_AGE_MS = 30 * 60 * 1000; // 30 minutes
const MAX_TIMELINE_EVENTS = 5000;

export class AgentStateManager extends EventEmitter {
  private agents = new Map<string, AgentState>();
  private idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private shutdownTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private colorCounter = 0;
  private activityHistory = new Map<string, ActivityEntry[]>();
  private timelineBuffer: TimelineEvent[] = [];
  /** Queue of task descriptions from Agent tool calls, keyed by parent agent ID */
  private pendingSubagentTasks = new Map<string, string[]>();

  getAll(): AgentState[] {
    return Array.from(this.agents.values());
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

  private recordTimeline(event: AgentEvent): void {
    this.timelineBuffer.push({
      type: event.type,
      agent: { ...event.agent },
      timestamp: event.timestamp,
    });

    // Trim old events
    const cutoff = Date.now() - MAX_HISTORY_AGE_MS;
    while (this.timelineBuffer.length > 0 && this.timelineBuffer[0].timestamp < cutoff) {
      this.timelineBuffer.shift();
    }
    // Cap at max
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

    // Trim old entries
    const cutoff = Date.now() - MAX_HISTORY_AGE_MS;
    while (entries.length > 0 && entries[0].timestamp < cutoff) {
      entries.shift();
    }
    // Cap at max
    if (entries.length > MAX_HISTORY_PER_AGENT) {
      entries.splice(0, entries.length - MAX_HISTORY_PER_AGENT);
    }
  }

  private summarizeToolInput(input: unknown): string {
    if (!input) return '';
    try {
      const obj = input as Record<string, unknown>;
      // Pick the most useful field for a summary
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

  processMessage(sessionId: string, activity: ParsedActivity, sessionInfo: SessionInfo) {
    let agent = this.agents.get(sessionId);
    const now = Date.now();

    if (!agent) {
      // Spawn new agent
      const parentId = sessionInfo.isSubagent ? this.findParentId(sessionInfo.projectDir) : null;
      const taskDescription = parentId ? this.popPendingTask(parentId) : null;
      agent = {
        id: sessionId,
        sessionId,
        projectPath: sessionInfo.projectPath,
        projectName: sessionInfo.projectName,
        role: this.determineRole(activity, sessionInfo),
        parentId,
        teamName: null,
        currentZone: 'spawn',
        currentTool: null,
        currentActivity: null,
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
      this.addHistory(sessionId, { timestamp: now, kind: 'spawn', zone: 'spawn' });
      const spawnEvent = { type: 'agent:spawn', agent: { ...agent }, timestamp: now } satisfies AgentEvent;
      this.recordTimeline(spawnEvent);
      this.emit('agent:spawn', spawnEvent);
    }

    // Update agent based on activity
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

        // Detect planning mode transitions
        if (activity.toolName === 'EnterPlanMode') {
          agent.isPlanning = true;
        } else if (activity.toolName === 'ExitPlanMode') {
          agent.isPlanning = false;
        }

        // Detect team-related tools
        if (activity.toolName === 'TeamCreate' && activity.toolInput) {
          agent.teamName = (activity.toolInput as Record<string, unknown>).team_name as string ?? null;
          agent.role = 'team-lead';
        }
        if (activity.toolName === 'SendMessage') {
          agent.currentZone = 'messaging';
        }

        // When Agent tool is called, queue the description for the incoming subagent
        if (activity.toolName === 'Agent' && activity.toolInput) {
          const input = activity.toolInput as Record<string, unknown>;
          const desc = (input.description ?? input.prompt ?? '') as string;
          if (desc) {
            this.queuePendingTask(sessionId, desc.length > 80 ? desc.slice(0, 77) + '...' : desc);
          }
        }

        // Record tool activity
        this.addHistory(sessionId, {
          timestamp: now,
          kind: 'tool',
          tool: activity.toolName ?? undefined,
          toolArgs: this.summarizeToolInput(activity.toolInput),
          zone: agent.currentZone,
        });

        // Record zone change if different
        if (prevZone !== agent.currentZone) {
          this.addHistory(sessionId, {
            timestamp: now,
            kind: 'zone-change',
            zone: agent.currentZone,
            prevZone,
          });
        }
        break;
      }

      case 'text':
        agent.speechText = activity.text ?? null;
        agent.currentActivity = activity.text ?? null;
        // Use first text as task description if not already set
        if (!agent.taskDescription && activity.text) {
          agent.taskDescription = activity.text;
        }
        if (activity.text) {
          this.addHistory(sessionId, {
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
        this.addHistory(sessionId, {
          timestamp: now,
          kind: 'tokens',
          inputTokens: activity.inputTokens ?? 0,
          outputTokens: activity.outputTokens ?? 0,
        });
        break;
    }

    // Reset idle timer
    this.resetIdleTimer(sessionId);

    const updateEvent = { type: 'agent:update', agent: { ...agent }, timestamp: now } satisfies AgentEvent;
    this.recordTimeline(updateEvent);
    this.emit('agent:update', updateEvent);
  }

  private determineRole(_activity: ParsedActivity, sessionInfo: SessionInfo): AgentState['role'] {
    if (sessionInfo.isSubagent) return 'subagent';
    return 'main';
  }

  /** Find the most likely parent (main agent in same project) for a subagent */
  private findParentId(projectDir: string): string | null {
    for (const [id, agent] of this.agents) {
      if (agent.projectPath === projectDir && agent.role === 'main') {
        return id;
      }
    }
    // Fallback: first agent with same project path regardless of role
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

  private resetIdleTimer(sessionId: string) {
    const existing = this.idleTimers.get(sessionId);
    if (existing) clearTimeout(existing);

    // Clear any pending shutdown timer since the agent is active again
    const existingShutdown = this.shutdownTimers.get(sessionId);
    if (existingShutdown) clearTimeout(existingShutdown);

    const timer = setTimeout(() => {
      const agent = this.agents.get(sessionId);
      if (agent) {
        agent.isIdle = true;
        agent.isPlanning = false;
        agent.currentZone = 'idle';
        agent.currentTool = null;
        agent.currentActivity = null;
        agent.speechText = null;
        const ts = Date.now();
        this.addHistory(sessionId, { timestamp: ts, kind: 'idle', zone: 'idle' });
        const idleEvent = {
          type: 'agent:idle',
          agent: { ...agent },
          timestamp: ts,
        } satisfies AgentEvent;
        this.recordTimeline(idleEvent);
        this.emit('agent:idle', idleEvent);

        // Start shutdown timer — remove the agent after extended idleness
        this.startShutdownTimer(sessionId);
      }
    }, config.idleTimeoutMs);

    this.idleTimers.set(sessionId, timer);
  }

  private startShutdownTimer(sessionId: string) {
    const existing = this.shutdownTimers.get(sessionId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      const agent = this.agents.get(sessionId);
      if (agent && agent.isIdle && !agent.isDone) {
        agent.isDone = true;
        console.log(`Agent marked done: ${sessionId} (idle for ${config.shutdownTimeoutMs / 1000}s)`);
        const ts = Date.now();
        const updateEvent = { type: 'agent:update', agent: { ...agent }, timestamp: ts } satisfies AgentEvent;
        this.recordTimeline(updateEvent);
        this.emit('agent:update', updateEvent);
      }
    }, config.shutdownTimeoutMs);

    this.shutdownTimers.set(sessionId, timer);
  }

  /** Remove all agents marked as done */
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

    const ts = Date.now();
    this.addHistory(sessionId, { timestamp: ts, kind: 'shutdown' });
    this.agents.delete(sessionId);

    // Keep history for a bit after shutdown (it will age out naturally)
    const shutdownEvent = {
      type: 'agent:shutdown',
      agent: { id: sessionId } as AgentState,
      timestamp: ts,
    } satisfies AgentEvent;
    this.recordTimeline(shutdownEvent);
    this.emit('agent:shutdown', shutdownEvent);
  }
}
