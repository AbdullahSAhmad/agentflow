import { spawn, execSync, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import type { Project, ProjectSession, SessionStatus } from '@agent-move/shared';

const IS_WINDOWS = process.platform === 'win32';
const AGENTAPI_HOST = '127.0.0.1';

export class AgentApiManager extends EventEmitter {
  private sessions = new Map<string, ProjectSession>();
  private processes = new Map<string, ChildProcess>();
  private nextPort: number;
  private available = false;
  private version: string | null = null;
  private binary: string;

  constructor(basePort: number, binary: string) {
    super();
    this.nextPort = basePort;
    this.binary = binary;
    this.detectBinary();
  }

  private detectBinary(): void {
    try {
      const cmd = this.binary.includes(' ') ? `"${this.binary}" --version` : `${this.binary} --version`;
      const out = execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim();
      this.available = true;
      this.version = out;
      console.log(`[agentapi] Detected: ${out}`);
    } catch {
      this.available = false;
      this.version = null;
      console.log('[agentapi] Not found on PATH — project sessions disabled');
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  getVersion(): string | null {
    return this.version;
  }

  getSession(projectId: string): ProjectSession | undefined {
    return this.sessions.get(projectId);
  }

  getAllSessions(): ProjectSession[] {
    return Array.from(this.sessions.values());
  }

  /** Build the base URL for a session's AgentAPI server */
  getBaseUrl(session: ProjectSession): string {
    return `http://${AGENTAPI_HOST}:${session.agentApiPort}`;
  }

  startSession(project: Project): ProjectSession {
    if (!this.available) throw new Error('agentapi binary not found');

    const existing = this.sessions.get(project.id);
    if (existing && (existing.status === 'running' || existing.status === 'starting')) {
      return existing;
    }

    const port = this.allocatePort();
    const session: ProjectSession = {
      projectId: project.id,
      agentApiPort: port,
      agentApiPid: null,
      status: 'starting',
      startedAt: Date.now(),
    };

    this.sessions.set(project.id, session);
    this.emitStatus(session);

    // Strip ALL Claude Code env vars so Claude doesn't refuse to start inside another session
    const env: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k.toUpperCase().startsWith('CLAUDE')) continue;
      env[k] = v;
    }
    // Log stripped env vars for debugging
    const strippedKeys = Object.keys(process.env).filter(k => k.toUpperCase().startsWith('CLAUDE'));
    console.log(`[agentapi:${project.name}] Spawning on port ${port}, binary=${this.binary}, cwd=${project.path}`);
    console.log(`[agentapi:${project.name}] Stripped env vars: ${strippedKeys.join(', ') || '(none)'}`);
    console.log(`[agentapi:${project.name}] IS_WINDOWS=${IS_WINDOWS}, shell=${IS_WINDOWS}`);

    const args = [
      'server',
      'claude',
      '--port', String(port),
      '--allowed-origins', '*',
      '--allowed-hosts', '*',
    ];
    console.log(`[agentapi:${project.name}] Command: ${this.binary} ${args.join(' ')}`);

    // Use 'inherit' for stderr so agentapi logs go straight to our console
    // (piped stderr on Windows can buffer indefinitely for Go binaries)
    const child = spawn(this.binary, args, {
      stdio: ['pipe', 'pipe', 'inherit'],
      cwd: project.path,
      env,
    });

    this.processes.set(project.id, child);
    session.agentApiPid = child.pid ?? null;
    console.log(`[agentapi:${project.name}] Spawned PID=${child.pid ?? 'unknown'}`);

    const baseUrl = this.getBaseUrl(session);
    let pollCount = 0;
    let gotAnyOutput = false;

    // Poll for readiness instead of blind timeout
    const pollReady = setInterval(async () => {
      if (session.status !== 'starting') {
        clearInterval(pollReady);
        return;
      }
      pollCount++;
      const pollUrl = `${baseUrl}/status`;
      try {
        const res = await fetch(pollUrl);
        const body = await res.text();
        console.log(`[agentapi:${project.name}] Poll #${pollCount} ${pollUrl} → ${res.status} ${body.slice(0, 100)}`);
        if (res.ok) {
          clearInterval(pollReady);
          session.status = 'running';
          this.emitStatus(session);
          console.log(`[agentapi:${project.name}] Ready on port ${port}`);
        }
      } catch (err: any) {
        if (pollCount <= 5 || pollCount % 10 === 0) {
          console.log(`[agentapi:${project.name}] Poll #${pollCount} ${pollUrl} → ${err.cause?.code || err.message}`);
        }
      }
    }, 500);

    // Give up after 30s
    const giveUpTimer = setTimeout(() => {
      clearInterval(pollReady);
      if (session.status === 'starting') {
        console.log(`[agentapi:${project.name}] TIMEOUT after ${pollCount} polls. gotOutput=${gotAnyOutput}, pid=${child.pid}, killed=${child.killed}, exitCode=${child.exitCode}`);
        session.status = 'error';
        session.error = `Timed out after 30s (${pollCount} polls, output=${gotAnyOutput})`;
        this.emitStatus(session);
      }
    }, 30_000);

    child.on('error', (err) => {
      console.log(`[agentapi:${project.name}] SPAWN ERROR: ${err.message}`);
      clearInterval(pollReady);
      clearTimeout(giveUpTimer);
      session.status = 'error';
      session.error = err.message;
      this.emitStatus(session);
      this.processes.delete(project.id);
    });

    child.on('exit', (code, signal) => {
      console.log(`[agentapi:${project.name}] EXIT code=${code} signal=${signal}`);
      clearInterval(pollReady);
      clearTimeout(giveUpTimer);
      if (session.status !== 'stopping') {
        session.status = code === 0 ? 'stopped' : 'error';
        if (code !== 0) session.error = `Process exited with code ${code}`;
      } else {
        session.status = 'stopped';
      }
      session.agentApiPid = null;
      this.emitStatus(session);
      this.processes.delete(project.id);
    });

    child.stdout?.on('data', (data: Buffer) => {
      gotAnyOutput = true;
      const text = data.toString().trim();
      if (text) console.log(`[agentapi:${project.name}:stdout] ${text}`);
    });

    // stderr is inherited (prints directly to console), no listener needed

    return session;
  }

  stopSession(projectId: string): void {
    const session = this.sessions.get(projectId);
    if (!session) return;

    session.status = 'stopping';
    this.emitStatus(session);

    const child = this.processes.get(projectId);
    if (!child) {
      session.status = 'stopped';
      this.emitStatus(session);
      return;
    }

    if (IS_WINDOWS) {
      // On Windows, child.kill() sends SIGTERM which doesn't work for process trees.
      // Use taskkill to kill the process tree reliably.
      const pid = child.pid;
      if (pid) {
        try {
          execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
        } catch {
          // Process may have already exited
          child.kill();
        }
      } else {
        child.kill();
      }
    } else {
      child.kill('SIGTERM');

      // Fallback SIGKILL after 5s
      const killTimer = setTimeout(() => {
        if (this.processes.has(projectId)) {
          child.kill('SIGKILL');
        }
      }, 5000);

      child.on('exit', () => clearTimeout(killTimer));
    }
  }

  dispose(): void {
    for (const [projectId] of this.processes) {
      this.stopSession(projectId);
    }
  }

  private allocatePort(): number {
    // Find next available port not in use by any session
    const usedPorts = new Set(Array.from(this.sessions.values()).map(s => s.agentApiPort));
    while (usedPorts.has(this.nextPort)) {
      this.nextPort++;
    }
    return this.nextPort++;
  }

  private emitStatus(session: ProjectSession): void {
    this.emit('session:status', { ...session });
  }
}
