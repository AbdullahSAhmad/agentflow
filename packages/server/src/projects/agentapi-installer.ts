import { existsSync, mkdirSync, chmodSync, createWriteStream, renameSync, unlinkSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

const GITHUB_REPO = 'coder/agentapi';
const RELEASE_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

export interface InstallResult {
  installed: boolean;
  path: string;
  version: string;
  alreadyInstalled?: boolean;
  error?: string;
}

function getAssetName(): string {
  const platform = process.platform;
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';

  if (platform === 'win32') return `agentapi-windows-${arch}.exe`;
  if (platform === 'darwin') return `agentapi-darwin-${arch}`;
  return `agentapi-linux-${arch}`;
}

function getBinaryName(): string {
  return process.platform === 'win32' ? 'agentapi.exe' : 'agentapi';
}

export function getAgentApiBinDir(agentMoveHome: string): string {
  return join(agentMoveHome, 'bin');
}

export function getAgentApiBinaryPath(agentMoveHome: string): string {
  return join(getAgentApiBinDir(agentMoveHome), getBinaryName());
}

/** Check if agentapi is already available (either our managed install or system PATH) */
export function detectAgentApi(agentMoveHome: string): { found: boolean; path: string; version: string | null } {
  // Check our managed install first
  const managedPath = getAgentApiBinaryPath(agentMoveHome);
  if (existsSync(managedPath)) {
    try {
      const version = execSync(`"${managedPath}" --version`, { encoding: 'utf-8', timeout: 5000 }).trim();
      return { found: true, path: managedPath, version };
    } catch {
      // Binary exists but broken — will re-download
    }
  }

  // Check system PATH
  try {
    const version = execSync('agentapi --version', { encoding: 'utf-8', timeout: 5000 }).trim();
    return { found: true, path: 'agentapi', version };
  } catch {
    return { found: false, path: '', version: null };
  }
}

/** Download and install the latest agentapi binary */
export async function installAgentApi(agentMoveHome: string): Promise<InstallResult> {
  const binDir = getAgentApiBinDir(agentMoveHome);
  const binaryPath = getAgentApiBinaryPath(agentMoveHome);

  // Check if already installed and working
  const existing = detectAgentApi(agentMoveHome);
  if (existing.found) {
    return {
      installed: true,
      path: existing.path,
      version: existing.version || 'unknown',
      alreadyInstalled: true,
    };
  }

  mkdirSync(binDir, { recursive: true });

  // Fetch latest release info
  let releaseData: any;
  try {
    const res = await fetch(RELEASE_API, {
      headers: { 'User-Agent': 'agent-move' },
    });
    if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
    releaseData = await res.json();
  } catch (err: any) {
    return { installed: false, path: '', version: '', error: `Failed to fetch release info: ${err.message}` };
  }

  const version = releaseData.tag_name || 'unknown';
  const assetName = getAssetName();
  const asset = releaseData.assets?.find((a: any) => a.name === assetName);

  if (!asset) {
    return {
      installed: false,
      path: '',
      version,
      error: `No binary found for ${process.platform}/${process.arch} (looked for ${assetName})`,
    };
  }

  // Download binary
  const tmpPath = binaryPath + '.download';
  try {
    const res = await fetch(asset.browser_download_url, {
      headers: { 'User-Agent': 'agent-move' },
    });
    if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status}`);

    const writeStream = createWriteStream(tmpPath);
    await pipeline(Readable.fromWeb(res.body as any), writeStream);

    // Atomic move
    if (existsSync(binaryPath)) unlinkSync(binaryPath);
    renameSync(tmpPath, binaryPath);

    // Make executable on Unix
    if (process.platform !== 'win32') {
      chmodSync(binaryPath, 0o755);
    }
  } catch (err: any) {
    // Clean up partial download
    try { unlinkSync(tmpPath); } catch {}
    return { installed: false, path: '', version, error: `Download failed: ${err.message}` };
  }

  // Verify it works
  try {
    const verOutput = execSync(`"${binaryPath}" --version`, { encoding: 'utf-8', timeout: 5000 }).trim();
    return { installed: true, path: binaryPath, version: verOutput };
  } catch (err: any) {
    return { installed: false, path: binaryPath, version, error: `Binary downloaded but failed to run: ${err.message}` };
  }
}

/** Uninstall the managed agentapi binary */
export function uninstallAgentApi(agentMoveHome: string): boolean {
  const binaryPath = getAgentApiBinaryPath(agentMoveHome);
  if (existsSync(binaryPath)) {
    unlinkSync(binaryPath);
    return true;
  }
  return false;
}
