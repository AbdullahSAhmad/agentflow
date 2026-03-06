import type { StateStore } from '../connection/state-store.js';

/**
 * AgentHoverBar — floating action buttons that appear when hovering
 * over an agent sprite on the canvas. Provides quick access to:
 * focus camera, view details, approve pending permissions, copy session ID.
 */
export class AgentHoverBar {
  private el: HTMLElement;
  private currentAgentId: string | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private store: StateStore;
  private onFocus: ((agentId: string) => void) | null = null;
  private onDetail: ((agentId: string) => void) | null = null;

  constructor(store: StateStore) {
    this.store = store;

    this.el = document.createElement('div');
    this.el.id = 'agent-hover-bar';
    this.el.innerHTML = `
      <button class="ahb-btn ahb-focus" title="Focus camera">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><circle cx="12" cy="12" r="3"/><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 18a8 8 0 110-16 8 8 0 010 16z"/></svg>
      </button>
      <button class="ahb-btn ahb-detail" title="View details">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
      </button>
      <button class="ahb-btn ahb-approve" title="Approve pending" style="display:none">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
      </button>
      <button class="ahb-btn ahb-copy" title="Copy session ID">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
      </button>
    `;
    document.body.appendChild(this.el);

    // Keep bar visible when mouse enters it
    this.el.addEventListener('mouseenter', () => {
      if (this.hideTimer) {
        clearTimeout(this.hideTimer);
        this.hideTimer = null;
      }
    });
    this.el.addEventListener('mouseleave', () => {
      this.scheduleHide();
    });

    // Button handlers
    this.el.querySelector('.ahb-focus')!.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.currentAgentId && this.onFocus) this.onFocus(this.currentAgentId);
    });
    this.el.querySelector('.ahb-detail')!.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.currentAgentId && this.onDetail) this.onDetail(this.currentAgentId);
    });
    this.el.querySelector('.ahb-approve')!.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!this.currentAgentId) return;
      // Approve all pending permissions for this agent's session
      const agent = this.store.getAgent(this.currentAgentId);
      if (!agent) return;
      const pending = this.store.getPendingPermissions();
      for (const p of pending) {
        if (p.sessionId === agent.sessionId) {
          this.store.approvePermission(p.permissionId);
        }
      }
    });
    this.el.querySelector('.ahb-copy')!.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!this.currentAgentId) return;
      const agent = this.store.getAgent(this.currentAgentId);
      if (agent) {
        navigator.clipboard.writeText(agent.sessionId).catch(() => {});
      }
    });
  }

  setFocusHandler(handler: (agentId: string) => void): void {
    this.onFocus = handler;
  }

  setDetailHandler(handler: (agentId: string) => void): void {
    this.onDetail = handler;
  }

  /** Called by AgentManager hover callback */
  show(agentId: string, screenX: number, screenY: number): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }

    this.currentAgentId = agentId;

    // Check if there are pending permissions for this agent
    const agent = this.store.getAgent(agentId);
    const approveBtn = this.el.querySelector('.ahb-approve') as HTMLElement;
    if (agent) {
      const pending = this.store.getPendingPermissions();
      const hasPending = pending.some(p => p.sessionId === agent.sessionId);
      approveBtn.style.display = hasPending ? '' : 'none';
    }

    // Position above the sprite
    this.el.style.left = `${screenX}px`;
    this.el.style.top = `${screenY - 40}px`;
    this.el.classList.add('visible');
  }

  hide(): void {
    this.scheduleHide();
  }

  private scheduleHide(): void {
    if (this.hideTimer) return;
    this.hideTimer = setTimeout(() => {
      this.el.classList.remove('visible');
      this.currentAgentId = null;
      this.hideTimer = null;
    }, 300);
  }

  dispose(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.el.remove();
  }
}
