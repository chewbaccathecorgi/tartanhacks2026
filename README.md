# Facial Recognition Viewer WebApp

WebRTC-based video streaming from phone camera to laptop display.

## Project Structure

```
viewer-webapp/
├── src/app/              ← FRONTEND (UI components)
│   ├── page.tsx          ← Viewer page (laptop)
│   ├── camera/page.tsx   ← Camera page (phone)
│   ├── layout.tsx        
│   └── globals.css       
├── backend/              ← BACKEND (do not modify)
│   ├── signaling.js      ← WebSocket signaling logic
│   └── README.md
├── server.js             ← Server entry point
├── FRONTEND_README.md    ← Guide for frontend devs
└── package.json
```

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# In another terminal, start ngrok
ngrok http 3000
```

## Usage

1. **Laptop**: Open `http://localhost:3000` - this is the viewer
2. **Phone**: Open `https://[ngrok-url]/camera` - this captures camera

## For Frontend Developers

See `FRONTEND_README.md` for details on where to make UI changes.

**Only modify files in `src/app/`** - backend code is in `backend/` and should not be touched.
