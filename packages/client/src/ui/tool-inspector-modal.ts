import type { ActivityEntry } from '@agent-move/shared';
import { escapeHtml } from '../utils/formatting.js';

/**
 * Tool Inspector Modal — side-by-side view of tool input and output.
 * Inspired by Langfuse/Helicone trace inspection.
 * Click any tool entry in the agent detail feed to open.
 */
export class ToolInspectorModal {
  private el: HTMLElement;
  private isOpen = false;

  private globalKeydownHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.isOpen) {
      e.preventDefault();
      this.close();
    }
  };

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'tool-inspector-modal';
    this.el.innerHTML = `
      <div class="ti-backdrop"></div>
      <div class="ti-modal">
        <div class="ti-header">
          <div class="ti-header-left">
            <span class="ti-tool-icon"></span>
            <span class="ti-title"></span>
            <span class="ti-timestamp"></span>
          </div>
          <div class="ti-header-right">
            <button class="ti-copy-btn" title="Copy as JSON">Copy</button>
            <button class="ti-close">&times;</button>
          </div>
        </div>
        <div class="ti-body">
          <div class="ti-pane ti-input-pane">
            <div class="ti-pane-header">
              <span class="ti-pane-label">Input</span>
              <span class="ti-pane-meta ti-input-meta"></span>
            </div>
            <div class="ti-pane-content ti-input-content"></div>
          </div>
          <div class="ti-divider"></div>
          <div class="ti-pane ti-output-pane">
            <div class="ti-pane-header">
              <span class="ti-pane-label">Output</span>
              <span class="ti-pane-meta ti-output-meta"></span>
            </div>
            <div class="ti-pane-content ti-output-content"></div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(this.el);

    this.el.querySelector('.ti-backdrop')!.addEventListener('click', () => this.close());
    this.el.querySelector('.ti-close')!.addEventListener('click', () => this.close());
    this.el.querySelector('.ti-copy-btn')!.addEventListener('click', () => this.copyToClipboard());
    document.addEventListener('keydown', this.globalKeydownHandler);
  }

  private currentEntry: ActivityEntry | null = null;

  open(entry: ActivityEntry): void {
    this.currentEntry = entry;
    const toolName = entry.tool ?? 'Unknown';

    // Header
    this.el.querySelector('.ti-tool-icon')!.textContent = this.getToolIcon(toolName);
    this.el.querySelector('.ti-title')!.textContent = toolName;
    this.el.querySelector('.ti-timestamp')!.textContent = new Date(entry.timestamp)
      .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // Input pane
    const inputContent = this.el.querySelector('.ti-input-content')!;
    const inputMeta = this.el.querySelector('.ti-input-meta')!;
    if (entry.toolInputFull) {
      const formatted = this.formatInput(entry.toolInputFull);
      inputContent.innerHTML = formatted;
      const keys = Object.keys(entry.toolInputFull);
      inputMeta.textContent = `${keys.length} field${keys.length !== 1 ? 's' : ''}`;
    } else if (entry.toolArgs) {
      inputContent.innerHTML = `<div class="ti-fallback">${escapeHtml(entry.toolArgs)}</div>`;
      inputMeta.textContent = 'summary only';
    } else {
      inputContent.innerHTML = '<div class="ti-empty">No input data</div>';
      inputMeta.textContent = '';
    }

    // Output pane
    const outputContent = this.el.querySelector('.ti-output-content')!;
    const outputMeta = this.el.querySelector('.ti-output-meta')!;
    if (entry.toolResult) {
      const lines = entry.toolResult.split('\n');
      outputMeta.textContent = `${lines.length} line${lines.length !== 1 ? 's' : ''}`;

      // For diff-like results (Edit tool), highlight additions/removals
      if (entry.tool === 'Edit' && entry.diff) {
        outputContent.innerHTML = this.formatDiff(entry.diff);
      } else {
        outputContent.innerHTML = this.formatOutput(entry.toolResult, toolName);
      }
    } else {
      outputContent.innerHTML = '<div class="ti-empty">No output captured yet</div>';
      outputMeta.textContent = 'pending';
    }

    this.isOpen = true;
    this.el.classList.add('open');
  }

  close(): void {
    this.isOpen = false;
    this.el.classList.remove('open');
    this.currentEntry = null;
  }

  private formatInput(input: Record<string, unknown>): string {
    const rows: string[] = [];
    for (const [key, value] of Object.entries(input)) {
      const valStr = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      const isLong = valStr.length > 200;
      const isCode = key === 'command' || key === 'content' || key === 'old_string' || key === 'new_string' || key === 'pattern';

      rows.push(`
        <div class="ti-field${isLong ? ' ti-field-long' : ''}">
          <div class="ti-field-key">${escapeHtml(key)}</div>
          <div class="ti-field-value${isCode ? ' ti-code' : ''}${isLong ? ' ti-collapsible' : ''}">${this.highlightValue(key, valStr)}</div>
        </div>
      `);
    }
    return rows.join('');
  }

  private formatOutput(text: string, toolName: string): string {
    // Detect if output looks like code/file content
    const isCode = toolName === 'Read' || toolName === 'Bash' || toolName === 'Grep' || toolName === 'Glob';
    if (isCode) {
      return `<pre class="ti-output-pre">${escapeHtml(text)}</pre>`;
    }
    // For general outputs, preserve newlines
    return `<div class="ti-output-text">${escapeHtml(text)}</div>`;
  }

  private formatDiff(diff: { filePath: string; oldText: string; newText: string }): string {
    const oldLines = diff.oldText.split('\n');
    const newLines = diff.newText.split('\n');
    let html = `<div class="ti-diff-file">${escapeHtml(diff.filePath)}</div>`;

    if (oldLines.some(l => l.trim())) {
      html += '<div class="ti-diff-section">';
      for (const line of oldLines) {
        html += `<div class="ti-diff-removed">- ${escapeHtml(line)}</div>`;
      }
      html += '</div>';
    }
    if (newLines.some(l => l.trim())) {
      html += '<div class="ti-diff-section">';
      for (const line of newLines) {
        html += `<div class="ti-diff-added">+ ${escapeHtml(line)}</div>`;
      }
      html += '</div>';
    }
    return html;
  }

  private highlightValue(key: string, value: string): string {
    const escaped = escapeHtml(value);
    // Highlight file paths
    if (key === 'file_path' || key === 'path') {
      return `<span class="ti-val-path">${escaped}</span>`;
    }
    // Highlight commands
    if (key === 'command') {
      return `<span class="ti-val-command">${escaped}</span>`;
    }
    return escaped;
  }

  private getToolIcon(toolName: string): string {
    const icons: Record<string, string> = {
      Read: '\u{1F4C4}', Write: '\u{1F4DD}', Edit: '\u{270F}\uFE0F', Bash: '\u{1F4BB}',
      Grep: '\u{1F50D}', Glob: '\u{1F4C2}', Agent: '\u{1F916}', WebFetch: '\u{1F310}',
      WebSearch: '\u{1F50E}', AskUserQuestion: '\u{2753}', SendMessage: '\u{1F4E8}',
    };
    return icons[toolName] ?? '\u{1F527}';
  }

  private copyToClipboard(): void {
    if (!this.currentEntry) return;
    const data = {
      tool: this.currentEntry.tool,
      timestamp: new Date(this.currentEntry.timestamp).toISOString(),
      input: this.currentEntry.toolInputFull ?? this.currentEntry.toolArgs,
      output: this.currentEntry.toolResult ?? null,
    };
    navigator.clipboard.writeText(JSON.stringify(data, null, 2)).catch(() => {});
    const btn = this.el.querySelector('.ti-copy-btn') as HTMLElement;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
  }

  dispose(): void {
    document.removeEventListener('keydown', this.globalKeydownHandler);
    this.el.remove();
  }
}
