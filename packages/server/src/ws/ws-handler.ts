import type { FastifyInstance } from 'fastify';
import type { AgentStateManager } from '../state/agent-state-manager.js';
import type { Broadcaster } from './broadcaster.js';

export function registerWsHandler(
  app: FastifyInstance,
  stateManager: AgentStateManager,
  broadcaster: Broadcaster
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
