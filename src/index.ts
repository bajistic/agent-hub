import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { config } from './config';
import { initSchema } from './db/schema';
import { setupWebSocket } from './api/ws';
import apiRoutes from './api/routes';
import { startTelegramBot } from './telegram/bot';
import { startAllBots } from './telegram/botManager';

async function main() {
  // Initialize database schema
  await initSchema();

  // Express app
  const app = express();
  app.use(express.json());

  // Simple API key auth middleware (skip for static files)
  if (config.apiKey) {
    app.use('/api', (req, res, next) => {
      const key = req.headers['x-api-key'] || req.query.apiKey;
      if (key !== config.apiKey) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      next();
    });
  }

  // API routes
  app.use('/api', apiRoutes);

  // Static web UI
  app.use('/', express.static(path.join(__dirname, '..', 'web')));

  // SPA fallback
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'web', 'index.html'));
  });

  // HTTP + WebSocket server
  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });
  setupWebSocket(wss);

  server.listen(config.port, () => {
    console.log(`[Agent Hub] Server running on port ${config.port}`);
  });

  // Start Telegram bot
  startTelegramBot();

  // Start registered sub-bots
  await startAllBots();
}

process.on('uncaughtException', (err) => {
  console.error('[Agent Hub] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Agent Hub] Unhandled rejection:', reason);
});

main().catch((err) => {
  console.error('[Agent Hub] Fatal error:', err);
  process.exit(1);
});
