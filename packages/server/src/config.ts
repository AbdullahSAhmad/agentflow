import { homedir } from 'os';
import { join } from 'path';

export const config = {
  port: parseInt(process.env.AGENT_MOVE_PORT || '3333', 10),
  claudeHome: join(homedir(), '.claude'),
  idleTimeoutMs: 45_000,
  /** How long after going idle before an agent is automatically shutdown/removed */
  shutdownTimeoutMs: 30 * 60 * 1000, // 30 minutes
  /** How recently a session file must be modified to be considered "active" on startup */
  activeThresholdMs: 10 * 60 * 1000, // 10 minutes
  /** Directory for agent-move persistent data (projects.json, etc.) */
  agentMoveHome: join(homedir(), '.agent-move'),
  /** Base port for AgentAPI instances */
  agentApiBasePort: 3285,
  /** AgentAPI binary name */
  agentApiBinary: process.env.AGENTAPI_BINARY || 'agentapi',
} as const;
