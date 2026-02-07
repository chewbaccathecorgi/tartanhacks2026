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
const port = parseInt(process.env.PORT || '3001', 10);
// Next needs a valid host for script URLs (not 0.0.0.0). When using ngrok, set NEXT_HOSTNAME to your ngrok host.
const nextHostname = process.env.NEXT_HOSTNAME || 'localhost';
const app = next({ dev, hostname: nextHostname, port });
const listenHost = process.env.BIND_HOST || '0.0.0.0';
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
    
    if (pathname === '/api/signaling') {
      // WebRTC signaling (legacy, kept for future use)
      wss.handleUpgrade(request, socket, head, (ws) => {
        console.log('[WebSocket] Signaling connection established');
        wss.emit('connection', ws, request);
      });
    }
    // All other upgrade requests (like /_next/webpack-hmr) are
    // left alone so Next.js can handle them internally for HMR.
  });

  server.listen(port, listenHost, () => {
    console.log(`> Ready on http://${listenHost}:${port}`);
    console.log(`> WebSocket signaling server running`);
  });
});
