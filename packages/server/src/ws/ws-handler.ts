import type { FastifyInstance } from 'fastify';
import type { AgentStateManager } from '../state/agent-state-manager.js';
import type { Broadcaster } from './broadcaster.js';
import type { HookEventManager } from '../hooks/hook-event-manager.js';

export function registerWsHandler(
  app: FastifyInstance,
  stateManager: AgentStateManager,
  broadcaster: Broadcaster,
  hookManager?: HookEventManager
) {
  app.get('/ws', { websocket: true }, (socket, _req) => {
    console.log('WebSocket client connected');
    broadcaster.addClient(socket);

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
