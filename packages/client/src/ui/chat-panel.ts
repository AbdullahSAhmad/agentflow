import type { StateStore } from '../connection/state-store.js';
import type { ChatMessage, ProjectSession } from '@agent-move/shared';

export class ChatPanel {
  private container: HTMLDivElement;
  private messagesEl: HTMLDivElement;
  private inputEl: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private projectSelect: HTMLSelectElement;
  private statusEl: HTMLSpanElement;
  private streamBuffer = '';
  private streamEl: HTMLDivElement | null = null;
  private visible = false;
  private autoScroll = true;

  constructor(private store: StateStore, private parentEl: HTMLElement) {
    this.container = document.createElement('div');
    this.container.className = 'chat-panel';
    this.container.style.display = 'none';

    this.container.innerHTML = `
      <div class="cp-header">
        <label class="cp-label">Project:</label>
        <select class="cp-project-select"></select>
        <span class="cp-status"></span>
      </div>
      <div class="cp-messages"></div>
      <div class="cp-input-row">
        <textarea class="cp-input" placeholder="Type a message..." rows="1"></textarea>
        <button class="cp-send" disabled>&#x23CE;</button>
      </div>
    `;

    this.parentEl.appendChild(this.container);

    this.messagesEl = this.container.querySelector('.cp-messages')!;
    this.inputEl = this.container.querySelector('.cp-input')!;
    this.sendBtn = this.container.querySelector('.cp-send')!;
    this.projectSelect = this.container.querySelector('.cp-project-select')!;
    this.statusEl = this.container.querySelector('.cp-status')!;

    this.sendBtn.addEventListener('click', () => this.send());
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.send();
      }
    });
    this.inputEl.addEventListener('input', () => this.updateSendState());

    this.projectSelect.addEventListener('change', () => {
      this.store.activeProjectId = this.projectSelect.value || null;
      this.renderMessages();
      this.updateStatus();
    });

    this.messagesEl.addEventListener('scroll', () => {
      const el = this.messagesEl;
      this.autoScroll = el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
    });

    // Wire events
    this.store.on('project:list', () => this.updateProjectList());
    this.store.on('project:added', () => this.updateProjectList());
    this.store.on('project:removed', () => this.updateProjectList());
    this.store.on('session:status', () => { this.updateProjectList(); this.updateStatus(); });
    this.store.on('chat:message', (msg: ChatMessage) => {
      if (msg.projectId === this.store.activeProjectId) this.renderMessages();
    });
    this.store.on('chat:stream', (data) => {
      if (data.projectId !== this.store.activeProjectId) return;
      if (data.done) {
        this.streamBuffer = '';
        this.streamEl = null;
        this.renderMessages();
      } else {
        this.appendStreamChunk(data.chunk);
      }
    });
  }

  show(): void {
    this.visible = true;
    this.container.style.display = '';
    this.updateProjectList();
    this.renderMessages();
    this.updateStatus();
  }

  hide(): void {
    this.visible = false;
    this.container.style.display = 'none';
  }

  dispose(): void {
    this.container.remove();
  }

  private send(): void {
    const content = this.inputEl.value.trim();
    const projectId = this.store.activeProjectId;
    if (!content || !projectId) return;

    const session = this.store.getSession(projectId);
    if (!session || session.status !== 'running') return;

    this.store.sendChat(projectId, content);
    this.inputEl.value = '';
    this.updateSendState();
  }

  private updateSendState(): void {
    const projectId = this.store.activeProjectId;
    const session = projectId ? this.store.getSession(projectId) : undefined;
    const canSend = !!this.inputEl.value.trim() && session?.status === 'running';
    this.sendBtn.disabled = !canSend;
  }

  private updateProjectList(): void {
    if (!this.visible) return;
    const current = this.store.activeProjectId;
    const projects = this.store.getProjects();

    this.projectSelect.innerHTML = '<option value="">Select project...</option>';
    for (const p of projects) {
      const session = this.store.getSession(p.id);
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.name}${session?.status === 'running' ? ' \u25CF' : ''}`;
      if (p.id === current) opt.selected = true;
      this.projectSelect.appendChild(opt);
    }

    this.updateSendState();
  }

  private updateStatus(): void {
    const projectId = this.store.activeProjectId;
    if (!projectId) {
      this.statusEl.textContent = '';
      return;
    }
    const session = this.store.getSession(projectId);
    if (!session) {
      this.statusEl.innerHTML = '<span class="cp-dot cp-dot-off"></span> No session';
      return;
    }
    const dotClass = session.status === 'running' ? 'cp-dot-ok' : session.status === 'error' ? 'cp-dot-err' : 'cp-dot-off';
    this.statusEl.innerHTML = `<span class="cp-dot ${dotClass}"></span> ${session.status}`;
  }

  private renderMessages(): void {
    if (!this.visible) return;
    const projectId = this.store.activeProjectId;
    const messages = projectId ? this.store.getChatHistory(projectId) : [];

    this.messagesEl.innerHTML = '';

    if (!projectId) {
      this.messagesEl.innerHTML = '<div class="cp-empty">Select a project to start chatting.</div>';
      return;
    }

    if (messages.length === 0) {
      this.messagesEl.innerHTML = '<div class="cp-empty">No messages yet. Send a message to get started.</div>';
      return;
    }

    for (const msg of messages) {
      this.messagesEl.appendChild(this.createMessageEl(msg));
    }

    if (this.autoScroll) {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }
  }

  private createMessageEl(msg: ChatMessage): HTMLDivElement {
    const el = document.createElement('div');
    el.className = `cp-msg cp-msg-${msg.role}`;
    el.innerHTML = `
      <div class="cp-msg-role">${msg.role === 'user' ? 'You' : 'Claude'}</div>
      <div class="cp-msg-content">${this.renderContent(msg.content)}</div>
    `;
    return el;
  }

  private appendStreamChunk(chunk: string): void {
    this.streamBuffer += chunk;

    if (!this.streamEl) {
      this.streamEl = document.createElement('div');
      this.streamEl.className = 'cp-msg cp-msg-assistant cp-msg-streaming';
      this.streamEl.innerHTML = `
        <div class="cp-msg-role">Claude</div>
        <div class="cp-msg-content"></div>
      `;
      this.messagesEl.appendChild(this.streamEl);
    }

    this.streamEl.querySelector('.cp-msg-content')!.innerHTML = this.renderContent(this.streamBuffer);

    if (this.autoScroll) {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }
  }

  private renderContent(text: string): string {
    // Basic markdown: code blocks and inline code
    let html = this.escapeHtml(text);
    // Code blocks
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="cp-code"><code>$2</code></pre>');
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code class="cp-inline-code">$1</code>');
    // Newlines
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
