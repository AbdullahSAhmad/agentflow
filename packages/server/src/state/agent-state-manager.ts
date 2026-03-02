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
  private colorCounter = 0;
  private activityHistory = new Map<string, ActivityEntry[]>();
  private timelineBuffer: TimelineEvent[] = [];

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
      agent = {
        id: sessionId,
        sessionId,
        projectPath: sessionInfo.projectPath,
        projectName: sessionInfo.projectName,
        role: this.determineRole(activity, sessionInfo),
        parentId: null,
        teamName: null,
        currentZone: 'spawn',
        currentTool: null,
        speechText: null,
        lastActivityAt: now,
        spawnedAt: now,
        isIdle: false,
        totalInputTokens: 0,
        totalOutputTokens: 0,
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

    if (activity.model) {
      agent.model = activity.model;
    }

    switch (activity.type) {
      case 'tool_use': {
        const prevZone = agent.currentZone;
        agent.currentTool = activity.toolName ?? null;
        agent.currentZone = getZoneForTool(activity.toolName ?? '');

        // Detect team-related tools
        if (activity.toolName === 'TeamCreate' && activity.toolInput) {
          agent.teamName = (activity.toolInput as Record<string, unknown>).team_name as string ?? null;
          agent.role = 'team-lead';
        }
        if (activity.toolName === 'SendMessage') {
          agent.currentZone = 'messaging';
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

  private resetIdleTimer(sessionId: string) {
    const existing = this.idleTimers.get(sessionId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      const agent = this.agents.get(sessionId);
      if (agent) {
        agent.isIdle = true;
        agent.currentZone = 'idle';
        agent.currentTool = null;
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
      }
    }, config.idleTimeoutMs);

    this.idleTimers.set(sessionId, timer);
  }

  shutdown(sessionId: string) {
    const timer = this.idleTimers.get(sessionId);
    if (timer) clearTimeout(timer);
    this.idleTimers.delete(sessionId);

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
