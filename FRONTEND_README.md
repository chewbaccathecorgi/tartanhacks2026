# Frontend Development Guide

## Where to work

All frontend code is in the `src/app/` folder:

```
src/app/
├── page.tsx          ← Main viewer page (displayed on LAPTOP)
├── camera/
│   └── page.tsx      ← Camera source page (displayed on PHONE)
├── layout.tsx        ← Root layout component
└── globals.css       ← Global styles
```

## Pages Overview

### 1. Viewer Page (`src/app/page.tsx`)
- **URL**: `http://localhost:3000` (or ngrok URL)
- **Purpose**: Displays the live video stream from the phone
- **Used on**: Laptop/Desktop browser
- **What to modify**: Video display, status indicators, future bounding box overlays

### 2. Camera Page (`src/app/camera/page.tsx`)
- **URL**: `http://[ngrok-url]/camera`
- **Purpose**: Captures camera and streams to viewer
- **Used on**: Phone browser (Safari/Chrome)
- **What to modify**: Camera controls, UI for phone

## Running the project

```bash
cd viewer-webapp
npm run dev
```

Then:
- Open `http://localhost:3000` on your laptop (viewer)
- Use ngrok: `ngrok http 3000`
- Open `https://[ngrok-url]/camera` on your phone (camera source)

## DO NOT TOUCH

- `backend/` folder - Backend signaling code
- `server.js` - Server entry point
- `next.config.ts` - Next.js configuration

## Tech Stack

- Next.js 15 (React framework)
- TypeScript
- WebRTC for video streaming
