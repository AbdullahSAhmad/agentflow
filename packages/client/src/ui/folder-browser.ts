import type { StateStore } from '../connection/state-store.js';
import type { DirectoryEntry } from '@agent-move/shared';

export class FolderBrowser {
  private overlay: HTMLDivElement;
  private modal: HTMLDivElement;
  private pathInput: HTMLInputElement;
  private listEl: HTMLDivElement;
  private selectedDisplay: HTMLDivElement;
  private confirmBtn: HTMLButtonElement;
  private currentPath = '';
  private selectedPath = '';
  private onConfirm: ((path: string) => void) | null = null;
  private boundDirList: (data: { path: string; entries: DirectoryEntry[] }) => void;

  constructor(private store: StateStore) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'fb-overlay';
    this.overlay.style.display = 'none';

    this.modal = document.createElement('div');
    this.modal.className = 'fb-modal';
    this.modal.innerHTML = `
      <div class="fb-header">
        <span class="fb-title">Select Project Folder</span>
        <button class="fb-close">&times;</button>
      </div>
      <div class="fb-path-row">
        <input class="fb-path-input" type="text" placeholder="Enter path..." />
        <button class="fb-go">Go</button>
      </div>
      <div class="fb-list"></div>
      <div class="fb-selected">No folder selected</div>
      <div class="fb-actions">
        <button class="fb-cancel">Cancel</button>
        <button class="fb-confirm" disabled>Add Project</button>
      </div>
    `;

    this.overlay.appendChild(this.modal);
    document.body.appendChild(this.overlay);

    this.pathInput = this.modal.querySelector('.fb-path-input')!;
    this.listEl = this.modal.querySelector('.fb-list')!;
    this.selectedDisplay = this.modal.querySelector('.fb-selected')!;
    this.confirmBtn = this.modal.querySelector('.fb-confirm')!;

    // Events
    this.modal.querySelector('.fb-close')!.addEventListener('click', () => this.close());
    this.modal.querySelector('.fb-cancel')!.addEventListener('click', () => this.close());
    this.confirmBtn.addEventListener('click', () => this.confirm());
    this.modal.querySelector('.fb-go')!.addEventListener('click', () => this.navigateTo(this.pathInput.value));
    this.pathInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.navigateTo(this.pathInput.value);
    });
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });

    this.boundDirList = (data) => this.handleDirList(data);
    this.store.on('directory:list', this.boundDirList);
  }

  open(callback: (path: string) => void): void {
    this.onConfirm = callback;
    this.selectedPath = '';
    this.selectedDisplay.textContent = 'No folder selected';
    this.confirmBtn.disabled = true;
    this.overlay.style.display = 'flex';
    this.store.requestDirectory();
  }

  close(): void {
    this.overlay.style.display = 'none';
    this.onConfirm = null;
  }

  dispose(): void {
    this.store.off('directory:list', this.boundDirList);
    this.overlay.remove();
  }

  private navigateTo(path: string): void {
    this.store.requestDirectory(path);
  }

  private handleDirList(data: { path: string; entries: DirectoryEntry[] }): void {
    if (this.overlay.style.display === 'none') return;

    this.currentPath = data.path;
    this.pathInput.value = data.path;
    this.listEl.innerHTML = '';

    for (const entry of data.entries) {
      const row = document.createElement('div');
      row.className = 'fb-entry';
      row.innerHTML = `<span class="fb-entry-icon">\u{1F4C1}</span> <span class="fb-entry-name">${this.escapeHtml(entry.name)}</span>`;

      row.addEventListener('click', () => {
        this.navigateTo(entry.path);
      });

      row.addEventListener('dblclick', () => {
        // Double-click selects this folder
        this.selectPath(entry.path, entry.name);
      });

      this.listEl.appendChild(row);
    }

    // Select current directory by default
    if (data.path) {
      this.selectPath(data.path, '');
    }
  }

  private selectPath(path: string, _name: string): void {
    this.selectedPath = path;
    this.selectedDisplay.textContent = `Selected: ${path}`;
    this.confirmBtn.disabled = false;
  }

  private confirm(): void {
    if (this.selectedPath && this.onConfirm) {
      this.onConfirm(this.selectedPath);
    }
    this.close();
  }

  private escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}
