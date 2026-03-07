import type { AgentState, ServerMessage, ActivityEntry, TimelineEvent, AnomalyEvent, ToolChainData, TaskGraphData, PendingPermission, TaskCompletedNotification, Project, ProjectSession, ChatMessage, DirectoryEntry } from '@agent-move/shared';
import type { WsClient } from './ws-client.js';

export type ConnectionStatus = 'connected' | 'disconnected';

export type StoreEventType =
  | 'agent:spawn'
  | 'agent:update'
  | 'agent:idle'
  | 'agent:shutdown'
  | 'agent:history'
  | 'state:reset'
  | 'connection:status'
  | 'timeline:snapshot'
  | 'anomaly:alert'
  | 'toolchain:snapshot'
  | 'taskgraph:snapshot'
  | 'permission:request'
  | 'permission:resolved'
  | 'hooks:status'
  | 'task:completed'
  | 'project:list'
  | 'project:added'
  | 'project:removed'
  | 'session:status'
  | 'chat:message'
  | 'chat:stream'
  | 'directory:list';

type StoreEventData = {
  'agent:spawn': AgentState;
  'agent:update': AgentState;
  'agent:idle': AgentState;
  'agent:shutdown': string; // agentId
  'agent:history': { agentId: string; entries: ActivityEntry[] };
  'state:reset': Map<string, AgentState>;
  'connection:status': ConnectionStatus;
  'timeline:snapshot': TimelineEvent[];
  'anomaly:alert': AnomalyEvent;
  'toolchain:snapshot': ToolChainData;
  'taskgraph:snapshot': TaskGraphData;
  'permission:request': PendingPermission;
  'permission:resolved': { permissionId: string; decision: 'allow' | 'deny' };
  'hooks:status': void;
  'task:completed': { taskId: string; taskSubject: string; agentId: string };
  'project:list': { projects: Project[]; sessions: ProjectSession[]; agentApiAvailable: boolean; agentApiVersion: string | null };
  'project:added': Project;
  'project:removed': string;
  'session:status': ProjectSession;
  'chat:message': ChatMessage;
  'chat:stream': { projectId: string; chunk: string; done: boolean };
  'directory:list': { path: string; entries: DirectoryEntry[] };
};

type Listener<T extends StoreEventType> = (data: StoreEventData[T]) => void;

export class StateStore {
  private agents = new Map<string, AgentState>();
  private listeners = new Map<StoreEventType, Set<Listener<any>>>();
  private _connectionStatus: ConnectionStatus = 'disconnected';
  private wsClient: WsClient | null = null;
  private _timeline: TimelineEvent[] = [];
  private _pendingPermissions = new Map<string, PendingPermission>();
  private _lastHookActivityAt: number | null = null;
  private _projects = new Map<string, Project>();
  private _sessions = new Map<string, ProjectSession>();
  private _chatHistory = new Map<string, ChatMessage[]>();
  private _agentApiAvailable = false;
  private _agentApiVersion: string | null = null;
  private _activeProjectId: string | null = null;

  get connectionStatus(): ConnectionStatus {
    return this._connectionStatus;
  }

  setWsClient(client: WsClient): void {
    this.wsClient = client;
  }

  getAgents(): Map<string, AgentState> {
    return this.agents;
  }

  getAgent(id: string): AgentState | undefined {
    return this.agents.get(id);
  }

  requestHistory(agentId: string): void {
    this.wsClient?.send({ type: 'request:history', agentId });
  }

  requestToolChain(): void {
    this.wsClient?.send({ type: 'request:toolchain' });
  }

  requestTaskGraph(): void {
    this.wsClient?.send({ type: 'request:taskgraph' });
  }

  getPendingPermissions(): PendingPermission[] {
    return Array.from(this._pendingPermissions.values());
  }

  /** Returns true if hook activity was seen in the last 60 seconds */
  isHooksActive(): boolean {
    return this._lastHookActivityAt !== null && Date.now() - this._lastHookActivityAt < 60_000;
  }

  private markHookActivity(): void {
    this._lastHookActivityAt = Date.now();
  }

  // ── Project methods ──

  getProjects(): Project[] { return Array.from(this._projects.values()); }
  getProject(id: string): Project | undefined { return this._projects.get(id); }
  getSessions(): ProjectSession[] { return Array.from(this._sessions.values()); }
  getSession(projectId: string): ProjectSession | undefined { return this._sessions.get(projectId); }
  getChatHistory(projectId: string): ChatMessage[] { return this._chatHistory.get(projectId) ?? []; }
  get agentApiAvailable(): boolean { return this._agentApiAvailable; }
  get agentApiVersion(): string | null { return this._agentApiVersion; }
  get activeProjectId(): string | null { return this._activeProjectId; }
  set activeProjectId(id: string | null) { this._activeProjectId = id; }

  requestProjects(): void {
    this.wsClient?.send({ type: 'request:projects' });
  }

  requestDirectory(path?: string): void {
    this.wsClient?.send({ type: 'request:directory', path: path || '' });
  }

  addProject(path: string): void {
    this.wsClient?.send({ type: 'project:add', path });
  }

  removeProject(projectId: string): void {
    this.wsClient?.send({ type: 'project:remove', projectId });
  }

  startSession(projectId: string): void {
    this.wsClient?.send({ type: 'session:start', projectId });
  }

  stopSession(projectId: string): void {
    this.wsClient?.send({ type: 'session:stop', projectId });
  }

  sendChat(projectId: string, content: string): void {
    this.wsClient?.send({ type: 'chat:send', projectId, content });
  }

  approvePermission(permissionId: string, updatedInput?: unknown): void {
    this.wsClient?.send({ type: 'permission:approve', permissionId, updatedInput });
  }

  denyPermission(permissionId: string): void {
    this.wsClient?.send({ type: 'permission:deny', permissionId });
  }

  approvePermissionAlways(permissionId: string, rules: unknown[]): void {
    this.wsClient?.send({ type: 'permission:approve-always', permissionId, rules });
  }

  getTimeline(): TimelineEvent[] {
    return this._timeline;
  }

  private static readonly MAX_TIMELINE = 5000;

  private pushTimelineEvent(type: TimelineEvent['type'], agent: AgentState, timestamp: number): void {
    this._timeline.push({ type, agent: { ...agent }, timestamp });
    // Trim to 30 min or hard cap
    const cutoff = Date.now() - 30 * 60 * 1000;
    let trimCount = 0;
    while (trimCount < this._timeline.length && this._timeline[trimCount].timestamp < cutoff) {
      trimCount++;
    }
    // Also enforce hard cap
    const overCap = this._timeline.length - StateStore.MAX_TIMELINE;
    if (overCap > 0) trimCount = Math.max(trimCount, overCap);
    if (trimCount > 0) {
      this._timeline.splice(0, trimCount);
    }
  }

  on<T extends StoreEventType>(event: T, listener: Listener<T>): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
  }

  off<T extends StoreEventType>(event: T, listener: Listener<T>): void {
    const set = this.listeners.get(event);
    if (set) set.delete(listener);
  }

  private emit<T extends StoreEventType>(event: T, data: StoreEventData[T]): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const fn of set) fn(data);
    }
  }

  dispose(): void {
    this.listeners.clear();
    this.agents.clear();
    this._timeline = [];
    this._pendingPermissions.clear();
  }

  setConnectionStatus(status: ConnectionStatus): void {
    this._connectionStatus = status;
    this.emit('connection:status', status);
  }

  handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'full_state': {
        this.agents.clear();
        for (const agent of msg.agents) {
          this.agents.set(agent.id, agent);
        }
        this.emit('state:reset', this.agents);
        break;
      }

      case 'agent:spawn': {
        this.agents.set(msg.agent.id, msg.agent);
        this.pushTimelineEvent('agent:spawn', msg.agent, msg.timestamp);
        this.emit('agent:spawn', msg.agent);
        break;
      }

      case 'agent:update': {
        this.agents.set(msg.agent.id, msg.agent);
        this.pushTimelineEvent('agent:update', msg.agent, msg.timestamp);
        this.emit('agent:update', msg.agent);
        break;
      }

      case 'agent:idle': {
        this.agents.set(msg.agent.id, msg.agent);
        this.pushTimelineEvent('agent:idle', msg.agent, msg.timestamp);
        this.emit('agent:idle', msg.agent);
        break;
      }

      case 'agent:shutdown': {
        const agent = this.agents.get(msg.agentId);
        if (agent) {
          this.pushTimelineEvent('agent:shutdown', agent, msg.timestamp);
        }
        this.emit('agent:shutdown', msg.agentId);
        this.agents.delete(msg.agentId);
        break;
      }

      case 'agent:history': {
        this.emit('agent:history', { agentId: msg.agentId, entries: msg.entries });
        break;
      }

      case 'timeline:snapshot': {
        this._timeline = msg.events;
        this.emit('timeline:snapshot', msg.events);
        break;
      }

      case 'anomaly:alert': {
        this.emit('anomaly:alert', msg.anomaly);
        break;
      }

      case 'toolchain:snapshot': {
        this.emit('toolchain:snapshot', msg.data);
        break;
      }

      case 'taskgraph:snapshot': {
        this.emit('taskgraph:snapshot', msg.data);
        break;
      }

      case 'permission:request': {
        this._pendingPermissions.set(msg.permission.permissionId, msg.permission);
        this.markHookActivity();
        this.emit('permission:request', msg.permission);
        break;
      }

      case 'permission:resolved': {
        this._pendingPermissions.delete(msg.permissionId);
        this.emit('permission:resolved', { permissionId: msg.permissionId, decision: msg.decision });
        break;
      }

      case 'hooks:status': {
        this.markHookActivity();
        this.emit('hooks:status', undefined);
        break;
      }

      case 'task:completed': {
        const n = msg as TaskCompletedNotification;
        this.emit('task:completed', { taskId: n.taskId, taskSubject: n.taskSubject, agentId: n.agentId });
        break;
      }

      case 'session:phase':
        // Phase changes are reflected via agent:update events; no separate handling needed.
        break;

      case 'project:list': {
        this._projects.clear();
        for (const p of msg.projects) this._projects.set(p.id, p);
        this._sessions.clear();
        for (const s of msg.sessions) this._sessions.set(s.projectId, s);
        this._agentApiAvailable = msg.agentApiAvailable;
        this._agentApiVersion = msg.agentApiVersion;
        this.emit('project:list', {
          projects: msg.projects,
          sessions: msg.sessions,
          agentApiAvailable: msg.agentApiAvailable,
          agentApiVersion: msg.agentApiVersion,
        });
        break;
      }

      case 'project:added': {
        this._projects.set(msg.project.id, msg.project);
        this.emit('project:added', msg.project);
        break;
      }

      case 'project:removed': {
        this._projects.delete(msg.projectId);
        this._sessions.delete(msg.projectId);
        this._chatHistory.delete(msg.projectId);
        this.emit('project:removed', msg.projectId);
        break;
      }

      case 'session:status': {
        this._sessions.set(msg.session.projectId, msg.session);
        this.emit('session:status', msg.session);
        break;
      }

      case 'chat:message': {
        const hist = this._chatHistory.get(msg.message.projectId) ?? [];
        hist.push(msg.message);
        this._chatHistory.set(msg.message.projectId, hist);
        this.emit('chat:message', msg.message);
        break;
      }

      case 'chat:stream': {
        this.emit('chat:stream', { projectId: msg.projectId, chunk: msg.chunk, done: msg.done });
        break;
      }

      case 'directory:list': {
        this.emit('directory:list', { path: msg.path, entries: msg.entries });
        break;
      }
    }
  }
}
