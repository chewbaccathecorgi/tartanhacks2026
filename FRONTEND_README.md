# Frontend Development Guide

## Where to work

All frontend code is in the `src/app/` folder:

```
src/app/
├── page.tsx              ← Main streaming page (face detection, gestures)
├── camera/page.tsx       ← Camera source page (legacy WebRTC)
├── processor/page.tsx    ← People list page
├── processor/[id]/       ← Individual profile page
├── layout.tsx            ← Root layout component
└── globals.css           ← Global styles
```

## Pages Overview

### 1. Main Streaming Page (`src/app/page.tsx`)
- **URL**: `/` (use your ngrok URL, e.g. `https://abc123.ngrok-free.app/`)
- **Purpose**: Share screen, detect faces with MediaPipe, capture with peace sign gesture
- **Used on**: Laptop/Desktop browser

### 2. People List (`src/app/processor/page.tsx`)
- **URL**: `/processor`
- **Purpose**: Grid of all captured people, merge mode
- **Used on**: Any browser

### 3. Profile Page (`src/app/processor/[id]/page.tsx`)
- **URL**: `/processor/[id]`
- **Purpose**: Individual profile with photo gallery, edit name/bio, conversations, split/move/delete photos

### 4. Camera Page (`src/app/camera/page.tsx`)
- **URL**: `/camera`
- **Purpose**: Legacy WebRTC camera streaming (not actively used)

## Running the project

```bash
npm install
npm run dev
```

Then run **ngrok** (in another terminal): `ngrok http 3001`. Open your **ngrok URL** in the browser (no localhost).

## DO NOT TOUCH

- `backend/` folder - Backend signaling code
- `server.js` - Server entry point
- `src/lib/` - Backend libraries (Azure Face API, face store)

## Tech Stack

- Next.js 15 (React framework)
- TypeScript
- MediaPipe (face detection, gesture recognition)
- Azure Face API (face identification)
