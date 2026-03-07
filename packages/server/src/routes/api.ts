import type { FastifyInstance } from 'fastify';
import type { AgentStateManager } from '../state/agent-state-manager.js';
import type { ProjectRegistry } from '../projects/project-registry.js';
import type { AgentApiManager } from '../projects/agentapi-manager.js';
import { listDirectory } from '../projects/directory-browser.js';

export interface ApiRouteDeps {
  projectRegistry?: ProjectRegistry;
  agentApiManager?: AgentApiManager;
}

export function registerApiRoutes(app: FastifyInstance, stateManager: AgentStateManager, deps?: ApiRouteDeps) {
  const projectRegistry = deps?.projectRegistry;
  const agentApiManager = deps?.agentApiManager;

  app.get('/api/health', async () => {
    return { status: 'ok', timestamp: Date.now() };
  });

  app.get('/api/state', async () => {
    return {
      agents: stateManager.getAll(),
      timestamp: Date.now(),
    };
  });

  /** POST /api/agents/clean-done – Remove all agents marked as done */
  app.post('/api/agents/clean-done', async () => {
    const removed = stateManager.removeDone();
    return { removed, count: removed.length };
  });

  /** POST /api/agents/:id/shutdown – Remove a single agent by id */
  app.post<{ Params: { id: string } }>('/api/agents/:id/shutdown', async (req, reply) => {
    const agent = stateManager.getAll().find(a => a.id === req.params.id);
    if (!agent) {
      return reply.status(404).send({ error: 'Agent not found' });
    }
    stateManager.shutdown(req.params.id);
    return { removed: req.params.id };
  });

  // ── Project API routes ──

  app.get('/api/projects', async () => {
    return {
      projects: projectRegistry?.getAll() ?? [],
      sessions: agentApiManager?.getAllSessions() ?? [],
      agentApiAvailable: agentApiManager?.isAvailable() ?? false,
      agentApiVersion: agentApiManager?.getVersion() ?? null,
    };
  });

  app.post<{ Body: { path: string } }>('/api/projects', async (req, reply) => {
    if (!projectRegistry) return reply.status(503).send({ error: 'Project registry not available' });
    try {
      const project = projectRegistry.add(req.body.path);
      return { project };
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    if (!projectRegistry) return reply.status(503).send({ error: 'Project registry not available' });
    const removed = projectRegistry.remove(req.params.id);
    if (!removed) return reply.status(404).send({ error: 'Project not found' });
    agentApiManager?.stopSession(req.params.id);
    return { removed: true };
  });

  app.post<{ Params: { id: string } }>('/api/projects/:id/start', async (req, reply) => {
    if (!projectRegistry || !agentApiManager) return reply.status(503).send({ error: 'Not available' });
    const project = projectRegistry.getById(req.params.id);
    if (!project) return reply.status(404).send({ error: 'Project not found' });
    try {
      const session = agentApiManager.startSession(project);
      return { session };
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  app.post<{ Params: { id: string } }>('/api/projects/:id/stop', async (req, reply) => {
    if (!agentApiManager) return reply.status(503).send({ error: 'Not available' });
    agentApiManager.stopSession(req.params.id);
    return { stopped: true };
  });

  app.get<{ Querystring: { path?: string } }>('/api/directory', async (req) => {
    const result = listDirectory(req.query.path || undefined);
    return result;
  });
}
