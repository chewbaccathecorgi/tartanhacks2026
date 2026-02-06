/**
 * Main Server Entry Point
 * 
 * This file combines:
 * - Next.js frontend serving
 * - WebSocket signaling server (from backend/)
 * 
 * DO NOT MODIFY unless you know what you're doing.
 */

const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { WebSocketServer } = require('ws');

// Import signaling logic from backend
const { handleConnection } = require('./backend/signaling');

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error handling request', err);
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });

  const wss = new WebSocketServer({ noServer: true });

  // Use signaling handler from backend
  wss.on('connection', handleConnection);

  server.on('upgrade', (request, socket, head) => {
    const { pathname } = parse(request.url || '', true);
    console.log(`[WebSocket] Upgrade request to: ${pathname}`);
    
    if (pathname === '/api/signaling') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        console.log('[WebSocket] Connection established');
        wss.emit('connection', ws, request);
      });
    } else {
      console.log(`[WebSocket] Rejected upgrade to: ${pathname}`);
      socket.destroy();
    }
  });

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> WebSocket signaling server running`);
  });
});
