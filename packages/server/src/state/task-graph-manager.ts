import type { TaskNode, TaskGraphData } from '@agent-move/shared';

export class TaskGraphManager {
  private tasks = new Map<string, TaskNode>();
  /** Per-agent-root counters to match Claude's sequential task IDs per team */
  private counters = new Map<string, number>();

  /**
   * Build a scoped key from rootSessionId + short task ID.
   * This prevents cross-team ID collisions in the global map.
   */
  private scopedKey(root: string, shortId: string): string {
    return `${root}::${shortId}`;
  }

  /**
   * Process a tool use that may affect the task graph.
   * Returns true if the graph changed.
   */
  processToolUse(agentId: string, agentName: string, toolName: string, toolInput: unknown, projectName?: string, rootSessionId?: string): boolean {
    const root = rootSessionId ?? agentId;
    if (toolName === 'TaskCreate') {
      return this.handleCreate(agentId, agentName, toolInput, projectName, root);
    }
    if (toolName === 'TaskUpdate') {
      return this.handleUpdate(agentId, agentName, toolInput, projectName, root);
    }
    return false;
  }

  private handleCreate(agentId: string, agentName: string, toolInput: unknown, projectName: string | undefined, root: string): boolean {
    const input = toolInput as Record<string, unknown> | undefined;
    if (!input) return false;

    // Each root session (team) has its own counter matching Claude's sequential IDs
    const count = (this.counters.get(root) ?? 0) + 1;
    this.counters.set(root, count);
    const shortId = String(count);
    const key = this.scopedKey(root, shortId);
    const subject = (input.subject as string) ?? `Task ${shortId}`;
    const description = input.description as string | undefined;

    const node: TaskNode = {
      id: shortId,
      subject,
      description,
      status: 'pending',
      owner: undefined,
      agentId,
      agentName,
      projectName,
      blocks: [],
      blockedBy: [],
      timestamp: Date.now(),
      _rootKey: key,
    };
    this.tasks.set(key, node);
    return true;
  }

  private handleUpdate(agentId: string, agentName: string, toolInput: unknown, projectName: string | undefined, root: string): boolean {
    const input = toolInput as Record<string, unknown> | undefined;
    if (!input) return false;

    const taskId = input.taskId as string | undefined;
    if (!taskId) return false;

    const key = this.scopedKey(root, taskId);
    let task = this.tasks.get(key);
    if (!task) {
      // Create stub node for missed TaskCreate
      task = {
        id: taskId,
        subject: `Task ${taskId}`,
        status: 'pending',
        agentId,
        agentName,
        projectName,
        blocks: [],
        blockedBy: [],
        timestamp: Date.now(),
        _rootKey: key,
      };
      this.tasks.set(key, task);
    }

    let changed = false;

    if (input.status !== undefined) {
      const newStatus = input.status as string;
      if (['pending', 'in_progress', 'completed', 'deleted'].includes(newStatus)) {
        task.status = newStatus as TaskNode['status'];
        changed = true;
      }
    }

    if (input.owner !== undefined) {
      task.owner = input.owner as string;
      changed = true;
    }

    if (input.subject !== undefined) {
      task.subject = input.subject as string;
      changed = true;
    }

    if (input.description !== undefined) {
      task.description = input.description as string;
      changed = true;
    }

    if (input.addBlocks) {
      const blocks = input.addBlocks as string[];
      for (const id of blocks) {
        if (!task.blocks.includes(id)) {
          task.blocks.push(id);
          changed = true;
        }
        // Mirror: add this task to the other's blockedBy
        const otherKey = this.scopedKey(root, id);
        const other = this.tasks.get(otherKey);
        if (other && !other.blockedBy.includes(taskId)) {
          other.blockedBy.push(taskId);
          changed = true;
        }
      }
    }

    if (input.addBlockedBy) {
      const blockedBy = input.addBlockedBy as string[];
      for (const id of blockedBy) {
        if (!task.blockedBy.includes(id)) {
          task.blockedBy.push(id);
          changed = true;
        }
        // Mirror: add this task to the other's blocks
        const otherKey = this.scopedKey(root, id);
        const other = this.tasks.get(otherKey);
        if (other && !other.blocks.includes(taskId)) {
          other.blocks.push(taskId);
          changed = true;
        }
      }
    }

    return changed;
  }

  /**
   * Mark a task as completed (hook-sourced — TaskCompleted event).
   * Returns true if the status actually changed.
   */
  processTaskCompleted(taskId: string, root: string): boolean {
    const key = this.scopedKey(root, taskId);
    const task = this.tasks.get(key);
    if (!task || task.status === 'completed') return false;
    task.status = 'completed';
    return true;
  }

  /**
   * Remove all tasks created by a given agent.
   * Cleans up dependency references from remaining tasks.
   * Returns true if any tasks were removed.
   */
  removeAgentTasks(agentId: string): boolean {
    const toRemove = new Set<string>();
    for (const [key, task] of this.tasks) {
      if (task.agentId === agentId) toRemove.add(key);
    }
    if (toRemove.size === 0) return false;

    // Collect scoped keys being removed (for cleaning up blockedBy/blocks references)
    const removedKeys = new Set<string>();
    for (const key of toRemove) {
      removedKeys.add(key);
      this.tasks.delete(key);
    }

    // Clean up references using scoped keys to avoid cross-root collisions
    // After getSnapshot(), blocks/blockedBy are converted to scoped keys for client
    // but internally they're still short IDs — so match by scoped key of same root
    for (const [taskKey, task] of this.tasks) {
      const root = taskKey.split('::')[0];
      task.blocks = task.blocks.filter(id => !removedKeys.has(`${root}::${id}`));
      task.blockedBy = task.blockedBy.filter(id => !removedKeys.has(`${root}::${id}`));
    }
    return true;
  }

  getSnapshot(): TaskGraphData {
    const live = Array.from(this.tasks.values()).filter(t => t.status !== 'deleted');

    // Build short-id → rootKey lookup per root session
    const rootOf = (key: string) => key.split('::')[0];
    const shortToRoot = new Map<string, Map<string, string>>();
    for (const t of live) {
      const root = rootOf(t._rootKey!);
      if (!shortToRoot.has(root)) shortToRoot.set(root, new Map());
      shortToRoot.get(root)!.set(t.id, t._rootKey!);
    }

    // Convert blocks/blockedBy from short IDs to root keys for client-side uniqueness
    return {
      tasks: live.map(t => {
        const lookup = shortToRoot.get(rootOf(t._rootKey!));
        return {
          ...t,
          blocks: t.blocks.map(id => lookup?.get(id) ?? id),
          blockedBy: t.blockedBy.map(id => lookup?.get(id) ?? id),
        };
      }),
    };
  }
}
