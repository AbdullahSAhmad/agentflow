import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, statSync } from 'fs';
import { join, dirname, basename } from 'path';
import { randomUUID } from 'crypto';
import type { Project } from '@agent-move/shared';

export class ProjectRegistry {
  private projects = new Map<string, Project>();
  private filePath: string;

  constructor(agentMoveHome: string) {
    mkdirSync(agentMoveHome, { recursive: true });
    this.filePath = join(agentMoveHome, 'projects.json');
    this.load();
  }

  getAll(): Project[] {
    return Array.from(this.projects.values());
  }

  getById(id: string): Project | undefined {
    return this.projects.get(id);
  }

  add(path: string): Project {
    // Check if already registered
    for (const p of this.projects.values()) {
      if (p.path === path) return p;
    }

    // Validate directory exists
    if (!existsSync(path) || !statSync(path).isDirectory()) {
      throw new Error(`Directory does not exist: ${path}`);
    }

    const project: Project = {
      id: randomUUID(),
      name: basename(path),
      path,
      addedAt: Date.now(),
    };

    this.projects.set(project.id, project);
    this.save();
    return project;
  }

  remove(id: string): boolean {
    const removed = this.projects.delete(id);
    if (removed) this.save();
    return removed;
  }

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const data = JSON.parse(readFileSync(this.filePath, 'utf-8')) as Project[];
        for (const p of data) {
          this.projects.set(p.id, p);
        }
      }
    } catch {
      console.warn('[project-registry] Failed to load projects.json, starting fresh');
    }
  }

  private save(): void {
    const data = JSON.stringify(Array.from(this.projects.values()), null, 2);
    const tmp = this.filePath + '.tmp';
    writeFileSync(tmp, data, 'utf-8');
    renameSync(tmp, this.filePath);
  }
}
