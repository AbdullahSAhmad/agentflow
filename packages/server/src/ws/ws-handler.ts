import type { FastifyInstance } from 'fastify';
import type { AgentStateManager } from '../state/agent-state-manager.js';
import type { Broadcaster } from './broadcaster.js';
import type { HookEventManager } from '../hooks/hook-event-manager.js';
import type { ProjectRegistry } from '../projects/project-registry.js';
import type { AgentApiManager } from '../projects/agentapi-manager.js';
import type { ChatProxy } from '../projects/chat-proxy.js';
import { listDirectory } from '../projects/directory-browser.js';

export interface WsHandlerDeps {
  stateManager: AgentStateManager;
  broadcaster: Broadcaster;
  hookManager?: HookEventManager;
  projectRegistry?: ProjectRegistry;
  agentApiManager?: AgentApiManager;
  chatProxy?: ChatProxy;
}

export function registerWsHandler(
  app: FastifyInstance,
  stateManager: AgentStateManager,
  broadcaster: Broadcaster,
  hookManager?: HookEventManager,
  deps?: { projectRegistry?: ProjectRegistry; agentApiManager?: AgentApiManager; chatProxy?: ChatProxy }
) {
  const projectRegistry = deps?.projectRegistry;
  const agentApiManager = deps?.agentApiManager;
  const chatProxy = deps?.chatProxy;

  function sendProjectList(socket: import('ws').WebSocket): void {
    if (!projectRegistry || !agentApiManager) return;
    const msg = {
      type: 'project:list' as const,
      projects: projectRegistry.getAll(),
      sessions: agentApiManager.getAllSessions(),
      agentApiAvailable: agentApiManager.isAvailable(),
      agentApiVersion: agentApiManager.getVersion(),
      timestamp: Date.now(),
    };
    try { socket.send(JSON.stringify(msg)); } catch {}
  }

  app.get('/ws', { websocket: true }, (socket, _req) => {
    console.log('WebSocket client connected');
    broadcaster.addClient(socket);

    // Send project list on connect
    sendProjectList(socket);

    socket.on('message', (data: any) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong' }));
        } else if (msg.type === 'request:history') {
          const agentId = msg.agentId as string;
          const entries = stateManager.getHistory(agentId);
          socket.send(JSON.stringify({
            type: 'agent:history',
            agentId,
            entries,
            timestamp: Date.now(),
          }));
        } else if (msg.type === 'request:toolchain') {
          broadcaster.sendToClient(socket, {
            type: 'toolchain:snapshot',
            data: stateManager.getToolChainSnapshot(),
            timestamp: Date.now(),
          });
        } else if (msg.type === 'request:taskgraph') {
          broadcaster.sendToClient(socket, {
            type: 'taskgraph:snapshot',
            data: stateManager.getTaskGraphSnapshot(),
            timestamp: Date.now(),
          });
        } else if (hookManager && msg.type === 'permission:approve') {
          hookManager.resolvePermission(msg.permissionId, {
            behavior: 'allow',
            updatedInput: msg.updatedInput,
          });
        } else if (hookManager && msg.type === 'permission:deny') {
          hookManager.resolvePermission(msg.permissionId, { behavior: 'deny' });
        } else if (hookManager && msg.type === 'permission:approve-always') {
          hookManager.resolvePermission(msg.permissionId, {
            behavior: 'allow',
            updatedPermissions: msg.rules,
          });
        } else if (msg.type === 'request:projects') {
          sendProjectList(socket);
        } else if (msg.type === 'request:directory') {
          const result = listDirectory(msg.path || undefined);
          socket.send(JSON.stringify({
            type: 'directory:list',
            path: result.path,
            entries: result.entries,
            timestamp: Date.now(),
          }));
        } else if (msg.type === 'project:add' && projectRegistry) {
          try {
            const project = projectRegistry.add(msg.path);
            broadcaster.broadcastProjectMessage({
              type: 'project:added',
              project,
              timestamp: Date.now(),
            });
          } catch (err: any) {
            console.warn(`[ws] Failed to add project: ${err.message}`);
          }
        } else if (msg.type === 'project:remove' && projectRegistry) {
          const removed = projectRegistry.remove(msg.projectId);
          if (removed) {
            // Stop session if running
            agentApiManager?.stopSession(msg.projectId);
            chatProxy?.clearHistory(msg.projectId);
            chatProxy?.disconnectSSE(msg.projectId);
            broadcaster.broadcastProjectMessage({
              type: 'project:removed',
              projectId: msg.projectId,
              timestamp: Date.now(),
            });
          }
        } else if (msg.type === 'session:start' && projectRegistry && agentApiManager) {
          const project = projectRegistry.getById(msg.projectId);
          if (project) {
            try {
              const session = agentApiManager.startSession(project);
              broadcaster.broadcastProjectMessage({
                type: 'session:status',
                session,
                timestamp: Date.now(),
              });
            } catch (err: any) {
              console.warn(`[ws] Failed to start session: ${err.message}`);
            }
          }
        } else if (msg.type === 'session:stop' && agentApiManager) {
          agentApiManager.stopSession(msg.projectId);
          chatProxy?.disconnectSSE(msg.projectId);
          chatProxy?.clearHistory(msg.projectId);
        } else if (msg.type === 'chat:send' && chatProxy) {
          chatProxy.sendMessage(msg.projectId, msg.content).catch((err: any) => {
            console.warn(`[ws] Chat send error: ${err.message}`);
          });
        }
      } catch {
        // Ignore malformed messages
      }
    });

    socket.on('close', () => {
      console.log('WebSocket client disconnected');
    });
  });
}
