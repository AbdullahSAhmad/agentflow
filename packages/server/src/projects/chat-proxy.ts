import { randomUUID } from 'crypto';
import type { ChatMessage, ProjectSession } from '@agent-move/shared';
import type { AgentApiManager } from './agentapi-manager.js';
import type { Broadcaster } from '../ws/broadcaster.js';

export class ChatProxy {
  private chatHistory = new Map<string, ChatMessage[]>();
  private sseConnections = new Map<string, AbortController>();
  /** Track the last message ID seen per project so we know when there's new content */
  private lastMessageId = new Map<string, number>();
  /** Track the last message content to detect incremental updates */
  private lastMessageContent = new Map<string, string>();

  constructor(
    private agentApiManager: AgentApiManager,
    private broadcaster: Broadcaster
  ) {}

  getHistory(projectId: string): ChatMessage[] {
    return this.chatHistory.get(projectId) ?? [];
  }

  async sendMessage(projectId: string, content: string): Promise<void> {
    const session = this.agentApiManager.getSession(projectId);
    if (!session || session.status !== 'running') {
      throw new Error('Session not running');
    }

    // Store user message
    const userMsg: ChatMessage = {
      id: randomUUID(),
      projectId,
      role: 'user',
      content,
      timestamp: Date.now(),
    };

    this.pushMessage(projectId, userMsg);
    this.broadcaster.broadcastProjectMessage({
      type: 'chat:message',
      message: userMsg,
      timestamp: Date.now(),
    });

    // Ensure SSE is connected before sending
    this.connectSSE(projectId, session);

    // Send to AgentAPI — requires { content, type: "user" }
    try {
      const baseUrl = this.agentApiManager.getBaseUrl(session);
      const res = await fetch(`${baseUrl}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, type: 'user' }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`AgentAPI responded with ${res.status}: ${body}`);
      }
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: randomUUID(),
        projectId,
        role: 'assistant',
        content: `Error: ${err.message}`,
        timestamp: Date.now(),
      };
      this.pushMessage(projectId, errorMsg);
      this.broadcaster.broadcastProjectMessage({
        type: 'chat:message',
        message: errorMsg,
        timestamp: Date.now(),
      });
    }
  }

  connectSSE(projectId: string, session: ProjectSession): void {
    if (this.sseConnections.has(projectId)) return;

    const controller = new AbortController();
    this.sseConnections.set(projectId, controller);

    const url = `${this.agentApiManager.getBaseUrl(session)}/events`;
    console.log(`[chat-proxy] Connecting SSE for ${projectId} at ${url}`);

    this.streamSSE(projectId, url, controller.signal).catch((err) => {
      if (err.name !== 'AbortError') {
        console.log(`[chat-proxy] SSE disconnected for ${projectId}: ${err.message}`);
      }
      this.sseConnections.delete(projectId);
    });
  }

  private async streamSSE(projectId: string, url: string, signal: AbortSignal): Promise<void> {
    const res = await fetch(url, { signal });
    if (!res.ok || !res.body) {
      console.log(`[chat-proxy] SSE response not ok: ${res.status}`);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE format: "event: <type>\ndata: <json>\n\n"
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() ?? '';

        for (const block of blocks) {
          if (!block.trim()) continue;

          let eventType = '';
          let eventData = '';

          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              eventData += line.slice(6);
            } else if (line.startsWith('data:')) {
              eventData += line.slice(5);
            }
          }

          if (!eventData) continue;

          try {
            const parsed = JSON.parse(eventData);
            this.handleSSEEvent(projectId, eventType, parsed);
          } catch {
            // Skip non-JSON data
          }
        }
      }
    } finally {
      reader.releaseLock();
      this.sseConnections.delete(projectId);
    }
  }

  private handleSSEEvent(projectId: string, eventType: string, data: any): void {
    if (eventType === 'message_update') {
      const { id, message, role } = data;
      if (role !== 'agent') return; // Only relay agent messages

      const lastId = this.lastMessageId.get(projectId);
      const lastContent = this.lastMessageContent.get(projectId) ?? '';

      if (lastId === id) {
        // Same message being updated — send the new chunk
        const newContent = message || '';
        if (newContent.length > lastContent.length) {
          const chunk = newContent.slice(lastContent.length);
          this.broadcaster.broadcastProjectMessage({
            type: 'chat:stream',
            projectId,
            chunk,
            done: false,
            timestamp: Date.now(),
          });
        }
        this.lastMessageContent.set(projectId, newContent);
      } else {
        // New message — if we had a previous one, finalize it
        if (lastId !== undefined && lastContent) {
          this.broadcaster.broadcastProjectMessage({
            type: 'chat:stream',
            projectId,
            chunk: '',
            done: true,
            timestamp: Date.now(),
          });

          const finalMsg: ChatMessage = {
            id: randomUUID(),
            projectId,
            role: 'assistant',
            content: lastContent,
            timestamp: Date.now(),
          };
          this.pushMessage(projectId, finalMsg);
          this.broadcaster.broadcastProjectMessage({
            type: 'chat:message',
            message: finalMsg,
            timestamp: Date.now(),
          });
        }

        // Start tracking new message
        this.lastMessageId.set(projectId, id);
        const content = message || '';
        this.lastMessageContent.set(projectId, content);

        if (content) {
          this.broadcaster.broadcastProjectMessage({
            type: 'chat:stream',
            projectId,
            chunk: content,
            done: false,
            timestamp: Date.now(),
          });
        }
      }
    } else if (eventType === 'status_change') {
      // When agent goes stable, finalize any streaming message
      if (data.status === 'stable') {
        const lastContent = this.lastMessageContent.get(projectId);
        if (lastContent) {
          this.broadcaster.broadcastProjectMessage({
            type: 'chat:stream',
            projectId,
            chunk: '',
            done: true,
            timestamp: Date.now(),
          });

          const finalMsg: ChatMessage = {
            id: randomUUID(),
            projectId,
            role: 'assistant',
            content: lastContent,
            timestamp: Date.now(),
          };
          this.pushMessage(projectId, finalMsg);
          this.broadcaster.broadcastProjectMessage({
            type: 'chat:message',
            message: finalMsg,
            timestamp: Date.now(),
          });

          this.lastMessageId.delete(projectId);
          this.lastMessageContent.delete(projectId);
        }
      }
    }
  }

  disconnectSSE(projectId: string): void {
    const controller = this.sseConnections.get(projectId);
    if (controller) {
      controller.abort();
      this.sseConnections.delete(projectId);
    }
  }

  clearHistory(projectId: string): void {
    this.chatHistory.delete(projectId);
    this.lastMessageId.delete(projectId);
    this.lastMessageContent.delete(projectId);
  }

  dispose(): void {
    for (const [, controller] of this.sseConnections) {
      controller.abort();
    }
    this.sseConnections.clear();
    this.chatHistory.clear();
  }

  private pushMessage(projectId: string, msg: ChatMessage): void {
    let history = this.chatHistory.get(projectId);
    if (!history) {
      history = [];
      this.chatHistory.set(projectId, history);
    }
    history.push(msg);
    if (history.length > 500) history.splice(0, history.length - 500);
  }
}
