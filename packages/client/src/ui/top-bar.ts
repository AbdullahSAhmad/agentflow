import type { AgentState } from '@agent-move/shared';
import { computeAgentCost } from '@agent-move/shared';
import type { StateStore } from '../connection/state-store.js';
import { formatTokens } from '../utils/formatting.js';

/**
 * TopBar — enterprise-grade top navigation bar.
 * Absorbs: StatsHud, connection status, nav tabs, action icons.
 */

interface TokenSample {
  timestamp: number;
  total: number;
}

const VELOCITY_WINDOW = 60_000;
const SAMPLE_INTERVAL = 2_000;

export type NavTab = 'monitor' | 'analytics' | 'leaderboard' | 'toolchain' | 'taskgraph' | 'activity' | 'waterfall' | 'graph';

export class TopBar {
  private store: StateStore;
  private refreshTimer: ReturnType<typeof setInterval>;
  private sampleTimer: ReturnType<typeof setInterval>;
  private samples: TokenSample[] = [];
  private activeTab: NavTab = 'monitor';
  private onTabChange: ((tab: NavTab) => void) | null = null;

  private connectionDot: HTMLElement;
  private hooksDot: HTMLElement;
  private focusBar: HTMLElement;
  private hookEventCount = 0;

  constructor(store: StateStore) {
    this.store = store;

    this.connectionDot = document.getElementById('connection-dot')!;
    this.hooksDot = document.getElementById('hooks-dot')!;
    this.focusBar = document.getElementById('focus-sub-bar')!;

    // Track hook event count
    store.on('hooks:status', () => { this.hookEventCount++; });
    store.on('permission:request', () => { this.hookEventCount++; });
    store.on('permission:resolved', () => { this.hookEventCount++; });

    // Nav tabs
    document.querySelectorAll('.tb-nav-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = (tab as HTMLElement).dataset.tab as NavTab;
        this.setActiveTab(tabName);
      });
    });

    // Connection status
    this.store.on('connection:status', (status) => {
      const isConnected = status === 'connected';
      this.connectionDot.classList.toggle('connected', isConnected);
      this.connectionDot.classList.toggle('disconnected', !isConnected);
      this.connectionDot.title = isConnected ? 'Connected' : 'Disconnected';

      const bar = document.getElementById('disconnected-bar')!;
      bar.classList.toggle('visible', !isConnected);
    });

    // Stats updates
    this.refreshTimer = setInterval(() => this.updateStats(), 1000);
    this.sampleTimer = setInterval(() => this.takeSample(), SAMPLE_INTERVAL);
  }

  setTabChangeHandler(handler: (tab: NavTab) => void): void {
    this.onTabChange = handler;
  }

  getActiveTab(): NavTab {
    return this.activeTab;
  }

  setActiveTab(tab: NavTab): void {
    if (tab === this.activeTab) {
      // Clicking active non-monitor tab closes the panel
      if (tab !== 'monitor') {
        this.activeTab = 'monitor';
        this.updateTabUI();
        this.onTabChange?.('monitor');
      }
      return;
    }
    this.activeTab = tab;
    this.updateTabUI();
    this.onTabChange?.(tab);
  }

  private updateTabUI(): void {
    document.querySelectorAll('.tb-nav-tab').forEach(el => {
      const t = (el as HTMLElement).dataset.tab;
      el.classList.toggle('active', t === this.activeTab);
      el.setAttribute('aria-selected', String(t === this.activeTab));
    });
  }

  showFocus(name: string): void {
    this.focusBar.querySelector('.fi-name')!.textContent = name;
    this.focusBar.classList.add('visible');
  }

  hideFocus(): void {
    this.focusBar.classList.remove('visible');
  }

  private takeSample(): void {
    const agents = Array.from(this.store.getAgents().values());
    let total = 0;
    for (const a of agents) {
      total += a.totalInputTokens + a.totalOutputTokens;
    }
    this.samples.push({ timestamp: Date.now(), total });
    if (this.samples.length > 90) this.samples.shift();
  }

  private getVelocity(): number {
    if (this.samples.length < 2) return 0;
    const now = Date.now();
    const cutoff = now - VELOCITY_WINDOW;
    const recent = this.samples.filter(s => s.timestamp >= cutoff);
    if (recent.length < 2) return 0;
    const first = recent[0];
    const last = recent[recent.length - 1];
    const elapsed = (last.timestamp - first.timestamp) / 60_000;
    if (elapsed < 0.01) return 0;
    return (last.total - first.total) / elapsed;
  }

  private updateStats(): void {
    const agents = Array.from(this.store.getAgents().values());
    const active = agents.filter(a => !a.isIdle && !a.isDone).length;
    const idle = agents.filter(a => a.isIdle || a.isDone).length;

    let totalCost = 0;
    for (const a of agents) {
      totalCost += computeAgentCost(a);
    }

    const velocity = this.getVelocity();

    const setVal = (id: string, text: string) => {
      const val = document.querySelector(`#${id} .tb-stat-val`);
      if (val) val.textContent = text;
    };

    setVal('tb-active', String(active));
    setVal('tb-idle', String(idle));
    setVal('tb-cost', totalCost < 0.01 ? totalCost.toFixed(4) : totalCost.toFixed(2));
    setVal('tb-velocity', formatTokens(Math.round(velocity)));

    const activeDot = document.querySelector('#tb-active .tb-stat-dot') as HTMLElement;
    if (activeDot) activeDot.classList.toggle('pulse', active > 0);

    // Hooks status dot
    const pendingCount = this.store.getPendingPermissions().length;
    const hooksActive = this.store.isHooksActive();
    this.hooksDot.classList.toggle('hooks-pending', pendingCount > 0);
    this.hooksDot.classList.toggle('hooks-active', hooksActive && pendingCount === 0);
    if (pendingCount > 0) {
      this.hooksDot.title = `Hooks: ${pendingCount} permission${pendingCount > 1 ? 's' : ''} pending | ${this.hookEventCount} events received`;
    } else if (hooksActive) {
      this.hooksDot.title = `Hooks: active | ${this.hookEventCount} events received`;
    } else {
      this.hooksDot.title = 'Hooks: not detected (run `agent-move hooks install`)';
    }
  }

  dispose(): void {
    clearInterval(this.refreshTimer);
    clearInterval(this.sampleTimer);
  }
}
