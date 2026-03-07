export interface Project {
  id: string;
  name: string;
  path: string;
  addedAt: number;
}

export type SessionStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

export interface ProjectSession {
  projectId: string;
  agentApiPort: number;
  agentApiPid: number | null;
  status: SessionStatus;
  startedAt: number;
  error?: string;
}

export interface ChatMessage {
  id: string;
  projectId: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}
