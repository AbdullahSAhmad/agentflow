import type { AgentState, ActivityEntry } from './agent.js';

/** Server → Client messages */
export type ServerMessage =
  | FullStateMessage
  | AgentSpawnMessage
  | AgentUpdateMessage
  | AgentIdleMessage
  | AgentShutdownMessage
  | AgentHistoryMessage
  | TimelineSnapshotMessage;

export interface FullStateMessage {
  type: 'full_state';
  agents: AgentState[];
  timestamp: number;
}

export interface AgentSpawnMessage {
  type: 'agent:spawn';
  agent: AgentState;
  timestamp: number;
}

export interface AgentUpdateMessage {
  type: 'agent:update';
  agent: AgentState;
  timestamp: number;
}

export interface AgentIdleMessage {
  type: 'agent:idle';
  agent: AgentState;
  timestamp: number;
}

export interface AgentShutdownMessage {
  type: 'agent:shutdown';
  agentId: string;
  timestamp: number;
}

export interface AgentHistoryMessage {
  type: 'agent:history';
  agentId: string;
  entries: ActivityEntry[];
  timestamp: number;
}

/** Timeline event as stored in the global buffer */
export interface TimelineEvent {
  type: 'agent:spawn' | 'agent:update' | 'agent:idle' | 'agent:shutdown';
  agent: AgentState;
  timestamp: number;
}

export interface TimelineSnapshotMessage {
  type: 'timeline:snapshot';
  events: TimelineEvent[];
  timestamp: number;
}

/** Client → Server messages */
export type ClientMessage = PingMessage | RequestHistoryMessage;

export interface PingMessage {
  type: 'ping';
}

export interface RequestHistoryMessage {
  type: 'request:history';
  agentId: string;
}
