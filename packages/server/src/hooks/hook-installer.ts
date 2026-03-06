import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir, platform } from 'os';

const ALL_HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'Stop',
  'SubagentStart',
  'SubagentStop',
  'Notification',
  'PreCompact',
  'TaskCompleted',
  'TeammateIdle',
  'ConfigChange',
  'WorktreeCreate',
  'WorktreeRemove',
] as const;

const HOOK_DIR = join(homedir(), '.agent-move', 'hooks');
const CLAUDE_SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');

/** Generates the Node.js hook script (works on all platforms including Windows/Git Bash) */
function generateNodeScript(port: number): string {
  return `#!/usr/bin/env node
// AgentMove hook sender — auto-generated, do not edit manually
const http = require('http');

let body = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { body += chunk; });
process.stdin.on('end', () => {
  if (!body.trim()) process.exit(0);

  let event;
  try { event = JSON.parse(body); } catch { process.exit(0); }

  const isPermission = event.hook_event_name === 'PermissionRequest';

  const options = {
    hostname: 'localhost',
    port: ${port},
    path: '/hook',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  };

  const req = http.request(options, (res) => {
    let out = '';
    res.on('data', chunk => { out += chunk; });
    res.on('end', () => {
      if (isPermission) {
        if (out) process.stdout.write(out);
        process.exit(res.statusCode === 403 ? 2 : 0);
      } else {
        process.exit(0);
      }
    });
  });

  req.setTimeout(isPermission ? 300000 : 3000, () => { req.destroy(); process.exit(0); });
  req.on('error', () => process.exit(0));
  req.write(body);
  req.end();
});
`;
}

function readSettings(): Record<string, unknown> {
  if (!existsSync(CLAUDE_SETTINGS_PATH)) return {};
  try {
    const raw = readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8').trim();
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function writeSettings(settings: Record<string, unknown>): void {
  const dir = join(homedir(), '.claude');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

function buildHookEntry(scriptPath: string): object {
  return { hooks: [{ type: 'command', command: scriptPath }] };
}

export interface InstallResult {
  installed: boolean;
  scriptPath: string;
  settingsPath: string;
  message: string;
}

export function installHooks(port = 3333): InstallResult {
  // Create hook directory
  if (!existsSync(HOOK_DIR)) mkdirSync(HOOK_DIR, { recursive: true });

  const isWindows = platform() === 'win32';

  // Use Node.js for the hook script — works reliably on all platforms including
  // Windows where Claude Code runs in Git Bash (making PowerShell invocation unreliable)
  const scriptPath = join(HOOK_DIR, 'hook-sender.js');
  writeFileSync(scriptPath, generateNodeScript(port), 'utf-8');

  if (!isWindows) {
    chmodSync(scriptPath, 0o755);
  }

  // Forward slashes work in both Git Bash and Windows Node.js
  const nodePath = scriptPath.replace(/\\/g, '/');
  const hookCommand = `node "${nodePath}"`;

  // Update ~/.claude/settings.json
  const settings = readSettings();
  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;

  for (const event of ALL_HOOK_EVENTS) {
    const existing = (hooks[event] ?? []) as object[];
    // Remove any existing agent-move entries before re-adding
    const filtered = existing.filter((entry) => {
      const e = entry as Record<string, unknown>;
      const hookList = e.hooks as Array<Record<string, unknown>> | undefined;
      return !hookList?.some((h) => String(h.command ?? '').includes('.agent-move'));
    });
    filtered.push(buildHookEntry(hookCommand));
    hooks[event] = filtered;
  }

  settings.hooks = hooks;
  writeSettings(settings);

  return {
    installed: true,
    scriptPath,
    settingsPath: CLAUDE_SETTINGS_PATH,
    message: `Hooks installed. Script: ${scriptPath}`,
  };
}

export function uninstallHooks(): InstallResult {
  const settings = readSettings();
  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;

  for (const event of ALL_HOOK_EVENTS) {
    const existing = (hooks[event] ?? []) as object[];
    const filtered = existing.filter((entry) => {
      const e = entry as Record<string, unknown>;
      const hookList = e.hooks as Array<Record<string, unknown>> | undefined;
      return !hookList?.some((h) => String(h.command ?? '').includes('.agent-move'));
    });
    if (filtered.length === 0) {
      delete hooks[event];
    } else {
      hooks[event] = filtered;
    }
  }

  if (Object.keys(hooks).length === 0) {
    delete settings.hooks;
  } else {
    settings.hooks = hooks;
  }

  writeSettings(settings);

  return {
    installed: false,
    scriptPath: join(HOOK_DIR, 'hook-sender.js'),
    settingsPath: CLAUDE_SETTINGS_PATH,
    message: 'Hooks uninstalled from ~/.claude/settings.json',
  };
}

export function checkHookStatus(): { installed: boolean; events: string[]; scriptExists: boolean } {
  const settings = readSettings();
  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;

  const scriptPath = join(HOOK_DIR, 'hook-sender.js');
  const scriptExists = existsSync(scriptPath);

  const installedEvents: string[] = [];
  for (const event of ALL_HOOK_EVENTS) {
    const entries = (hooks[event] ?? []) as object[];
    const hasOurs = entries.some((entry) => {
      const e = entry as Record<string, unknown>;
      const hookList = e.hooks as Array<Record<string, unknown>> | undefined;
      return hookList?.some((h) => String(h.command ?? '').includes('.agent-move'));
    });
    if (hasOurs) installedEvents.push(event);
  }

  return {
    installed: installedEvents.length > 0,
    events: installedEvents,
    scriptExists,
  };
}
