import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { getAgent, sendAgentMessage } from '../manager';
import { StreamChunk } from '../agents/claudeCode';

export function setupWebSocket(wss: WebSocketServer) {
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = req.url || '';
    // Expected path: /ws/agents/:id
    const match = url.match(/\/ws\/agents\/([a-f0-9-]+)/);
    if (!match) {
      ws.close(4000, 'Invalid path. Use /ws/agents/:id');
      return;
    }

    const agentId = match[1];
    console.log(`[WS] Client connected for agent ${agentId}`);

    ws.on('message', async (data) => {
      const message = data.toString().trim();
      if (!message) return;

      try {
        const agent = await getAgent(agentId);
        if (!agent) {
          ws.send(JSON.stringify({ type: 'error', content: 'Agent not found' }));
          return;
        }

        ws.send(JSON.stringify({ type: 'status', content: 'processing' }));

        await sendAgentMessage(agent, message, (chunk: StreamChunk) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(chunk));
          }
        });
      } catch (err: any) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'error', content: err.message }));
        }
      }
    });

    ws.on('close', () => {
      console.log(`[WS] Client disconnected for agent ${agentId}`);
    });
  });
}
