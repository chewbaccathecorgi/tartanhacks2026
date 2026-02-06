# Backend - DO NOT MODIFY IF YOU'RE WORKING ON FRONTEND

**This folder contains backend infrastructure code.**

## What's here?

- `signaling.js` - WebSocket signaling server for WebRTC connections

## Architecture

```
Phone (Safari)                    Laptop (Chrome)
  /camera page                      / page (viewer)
       |                                |
       |── register as streamer ──>     |── register as viewer ──>
       |                                |
       |         signaling.js (WebSocket relay)
       |              /api/signaling
       |                                |
       |── offer ──> relay ──> viewer   |
       |   viewer ──> relay ──> answer ─|
       |── ICE candidates ←──→ ────────|
       |                                |
       └── WebRTC peer-to-peer video ──>┘
```

## How it works

1. Both clients (phone + laptop) connect via WebSocket to `/api/signaling`
2. The signaling server relays WebRTC handshake messages (offer, answer, ICE candidates)
3. Once connected, video streams **directly** between phone and laptop (peer-to-peer)
4. The server does NOT touch the video stream itself

## Face Detection

Face detection runs **entirely in the browser** on the viewer page using MediaPipe FaceLandmarker (478 3D landmarks per face). This is frontend code in `src/app/page.tsx`, not backend.

## If something breaks

Contact the backend developer (Harrison) before making any changes here.
