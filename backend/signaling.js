/**
 * WebSocket Signaling Server for WebRTC
 * 
 * DO NOT MODIFY - This is backend infrastructure code
 * 
 * This module handles WebRTC signaling between:
 * - Streamer (phone camera source)
 * - Viewer (laptop display)
 */

let streamerSocket = null;
let viewerSocket = null;

function handleMessage(socket, raw, role) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    socket.send(JSON.stringify({ type: 'error', message: 'Invalid JSON payload' }));
    return;
  }

  console.log(`[${role}] Received message:`, parsed.type);

  switch (parsed.type) {
    case 'register':
      if (parsed.role === 'streamer') {
        if (streamerSocket && streamerSocket !== socket) {
          socket.send(
            JSON.stringify({
              type: 'error',
              message: 'A streamer is already connected.',
            })
          );
          socket.close(1008, 'Streamer already connected');
          return;
        }
        streamerSocket = socket;
        console.log('[Streamer] Registered');
        socket.send(JSON.stringify({ type: 'registered', role: 'streamer' }));
        
        // Notify viewer that streamer is ready
        if (viewerSocket && viewerSocket.readyState === 1) {
          viewerSocket.send(JSON.stringify({ type: 'streamer-ready' }));
        }
      } else if (parsed.role === 'viewer') {
        if (viewerSocket && viewerSocket !== socket) {
          socket.send(
            JSON.stringify({
              type: 'error',
              message: 'A viewer is already connected.',
            })
          );
          socket.close(1008, 'Viewer already connected');
          return;
        }
        viewerSocket = socket;
        console.log('[Viewer] Registered');
        socket.send(
          JSON.stringify({
            type: 'registered',
            role: 'viewer',
            streamerReady: Boolean(streamerSocket),
          })
        );
        
        // Notify streamer that viewer is ready
        if (streamerSocket && streamerSocket.readyState === 1) {
          streamerSocket.send(JSON.stringify({ type: 'viewer-ready' }));
        }
      }
      break;

    case 'offer':
      // Streamer sends offer to viewer
      if (role === 'streamer' && viewerSocket && viewerSocket.readyState === 1) {
        console.log('[Signaling] Forwarding offer to viewer');
        viewerSocket.send(JSON.stringify({ type: 'offer', offer: parsed.offer }));
      }
      break;

    case 'answer':
      // Viewer sends answer to streamer
      if (role === 'viewer' && streamerSocket && streamerSocket.readyState === 1) {
        console.log('[Signaling] Forwarding answer to streamer');
        streamerSocket.send(JSON.stringify({ type: 'answer', answer: parsed.answer }));
      }
      break;

    case 'candidate':
      // ICE candidates can flow both ways
      if (role === 'streamer' && viewerSocket && viewerSocket.readyState === 1) {
        viewerSocket.send(JSON.stringify({ type: 'candidate', candidate: parsed.candidate }));
      } else if (role === 'viewer' && streamerSocket && streamerSocket.readyState === 1) {
        streamerSocket.send(JSON.stringify({ type: 'candidate', candidate: parsed.candidate }));
      }
      break;

    default:
      console.log(`[${role}] Unknown message type:`, parsed.type);
      break;
  }
}

function cleanup(socket, role) {
  console.log(`[${role}] Disconnected`);
  
  if (role === 'streamer' && streamerSocket === socket) {
    streamerSocket = null;
    if (viewerSocket && viewerSocket.readyState === 1) {
      viewerSocket.send(JSON.stringify({ type: 'streamer-disconnected' }));
    }
  } else if (role === 'viewer' && viewerSocket === socket) {
    viewerSocket = null;
    if (streamerSocket && streamerSocket.readyState === 1) {
      streamerSocket.send(JSON.stringify({ type: 'viewer-disconnected' }));
    }
  }
}

function handleConnection(ws) {
  let role = null;
  console.log('[WebSocket] Client connected, waiting for register message...');

  ws.on('message', (data) => {
    try {
      const message = data.toString();
      console.log('[WebSocket] Received raw message:', message);
      const parsed = JSON.parse(message);
      
      // Determine role on first message
      if (!role && parsed.type === 'register') {
        role = parsed.role;
        console.log(`[WebSocket] Role set to: ${role}`);
      }
      
      handleMessage(ws, message, role);
    } catch (error) {
      console.error('[WebSocket] Message parsing error:', error);
    }
  });

  ws.on('close', () => {
    console.log(`[${role || 'unknown'}] Connection closed`);
    cleanup(ws, role);
  });

  ws.on('error', (error) => {
    console.error(`[${role || 'unknown'}] WebSocket error:`, error);
    cleanup(ws, role);
  });
}

module.exports = {
  handleConnection,
  handleMessage,
  cleanup,
};
