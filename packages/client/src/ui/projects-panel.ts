import type { StateStore } from '../connection/state-store.js';
import type { Project, ProjectSession } from '@agent-move/shared';
import type { FolderBrowser } from './folder-browser.js';

export class ProjectsPanel {
  private container: HTMLDivElement;
  private listEl: HTMLDivElement;
  private statusEl: HTMLDivElement;
  private visible = false;
  private folderBrowser: FolderBrowser | null = null;

  private boundRender: () => void;

  constructor(private store: StateStore, private parentEl: HTMLElement) {
    this.container = document.createElement('div');
    this.container.className = 'projects-panel';
    this.container.style.display = 'none';

    this.container.innerHTML = `
      <div class="pp-header">
        <button class="pp-add-btn">+ Add Project</button>
      </div>
      <div class="pp-status"></div>
      <div class="pp-list"></div>
    `;

    this.parentEl.appendChild(this.container);
    this.listEl = this.container.querySelector('.pp-list')!;
    this.statusEl = this.container.querySelector('.pp-status')!;

    this.container.querySelector('.pp-add-btn')!.addEventListener('click', () => {
      this.folderBrowser?.open((path) => {
        this.store.addProject(path);
      });
    });

    this.boundRender = () => this.render();
    this.store.on('project:list', this.boundRender);
    this.store.on('project:added', this.boundRender);
    this.store.on('project:removed', this.boundRender);
    this.store.on('session:status', this.boundRender);
  }

  setFolderBrowser(fb: FolderBrowser): void {
    this.folderBrowser = fb;
  }

  show(): void {
    this.visible = true;
    this.container.style.display = '';
    this.store.requestProjects();
    this.render();
  }

  hide(): void {
    this.visible = false;
    this.container.style.display = 'none';
  }

  dispose(): void {
    this.store.off('project:list', this.boundRender);
    this.store.off('project:added', this.boundRender);
    this.store.off('project:removed', this.boundRender);
    this.store.off('session:status', this.boundRender);
    this.container.remove();
  }

  private render(): void {
    if (!this.visible) return;

    // Status bar
    const available = this.store.agentApiAvailable;
    const version = this.store.agentApiVersion;
    this.statusEl.innerHTML = available
      ? `<span class="pp-dot pp-dot-ok"></span> AgentAPI: ${this.esc(version || 'available')}`
      : `<span class="pp-dot pp-dot-off"></span> AgentAPI: not found`;

    // Project cards
    const projects = this.store.getProjects();
    this.listEl.innerHTML = '';

    if (projects.length === 0) {
      this.listEl.innerHTML = '<div class="pp-empty">No projects added yet. Click "+ Add Project" to get started.</div>';
      return;
    }

    for (const project of projects) {
      const session = this.store.getSession(project.id);
      this.listEl.appendChild(this.createCard(project, session));
    }
  }

  private createCard(project: Project, session?: ProjectSession): HTMLDivElement {
    const card = document.createElement('div');
    card.className = 'pp-card';

    const status = session?.status ?? 'stopped';
    const isRunning = status === 'running';
    const isStarting = status === 'starting';
    const hasError = status === 'error';

    const statusDot = isRunning ? 'pp-dot-ok' : hasError ? 'pp-dot-err' : isStarting ? 'pp-dot-starting' : 'pp-dot-off';
    const statusText = hasError ? `Error: ${session?.error || 'unknown'}` : isRunning ? `Running (port ${session?.agentApiPort})` : isStarting ? 'Starting...' : 'Stopped';

    card.innerHTML = `
      <div class="pp-card-header">
        <span class="pp-card-name">${this.esc(project.name)}</span>
      </div>
      <div class="pp-card-path">${this.esc(project.path)}</div>
      <div class="pp-card-status">
        <span class="pp-dot ${statusDot}"></span>
        <span>${statusText}</span>
      </div>
      <div class="pp-card-actions"></div>
    `;

    const actions = card.querySelector('.pp-card-actions')!;

    if (isRunning || isStarting) {
      const stopBtn = document.createElement('button');
      stopBtn.className = 'pp-btn pp-btn-stop';
      stopBtn.textContent = 'Stop';
      stopBtn.addEventListener('click', () => this.store.stopSession(project.id));
      actions.appendChild(stopBtn);

      if (isRunning) {
        const chatBtn = document.createElement('button');
        chatBtn.className = 'pp-btn pp-btn-chat';
        chatBtn.textContent = 'Chat';
        chatBtn.addEventListener('click', () => {
          this.store.activeProjectId = project.id;
          // Switch to chat tab via sidebar
          const chatTabBtn = document.querySelector('[data-tab="chat"]') as HTMLElement;
          chatTabBtn?.click();
        });
        actions.appendChild(chatBtn);
      }
    } else {
      if (this.store.agentApiAvailable) {
        const startBtn = document.createElement('button');
        startBtn.className = 'pp-btn pp-btn-start';
        startBtn.textContent = 'Start';
        startBtn.addEventListener('click', () => this.store.startSession(project.id));
        actions.appendChild(startBtn);
      }
    }

    const removeBtn = document.createElement('button');
    removeBtn.className = 'pp-btn pp-btn-remove';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => this.store.removeProject(project.id));
    actions.appendChild(removeBtn);

    return card;
  }

  private esc(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}
