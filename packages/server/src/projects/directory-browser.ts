import { readdirSync, statSync } from 'fs';
import { join, resolve, parse as pathParse } from 'path';
import { homedir } from 'os';
import type { DirectoryEntry } from '@agent-move/shared';

export function listDirectory(requestedPath?: string): { path: string; entries: DirectoryEntry[] } {
  const targetPath = resolve(requestedPath || homedir());

  const entries: DirectoryEntry[] = [];

  // On Windows, if at a drive root like C:\, list drive letters
  if (process.platform === 'win32' && !requestedPath) {
    // List available drives
    for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      const drivePath = `${letter}:\\`;
      try {
        statSync(drivePath);
        entries.push({ name: drivePath, path: drivePath, isDirectory: true });
      } catch {
        // Drive doesn't exist
      }
    }
    return { path: '', entries };
  }

  try {
    const items = readdirSync(targetPath, { withFileTypes: true });
    for (const item of items) {
      if (item.name.startsWith('.')) continue; // skip hidden
      if (item.isDirectory()) {
        entries.push({
          name: item.name,
          path: join(targetPath, item.name),
          isDirectory: true,
        });
      }
    }
  } catch {
    // Permission denied or not found — return empty
  }

  // Sort alphabetically
  entries.sort((a, b) => a.name.localeCompare(b.name));

  // Add parent directory entry (if not at root)
  const parsed = pathParse(targetPath);
  if (parsed.dir !== targetPath && parsed.root !== targetPath) {
    entries.unshift({
      name: '..',
      path: resolve(targetPath, '..'),
      isDirectory: true,
    });
  }

  return { path: targetPath, entries };
}
