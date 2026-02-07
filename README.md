# Facial Recognition Viewer WebApp

WebRTC-based video streaming from phone camera to laptop display.

## Branches

- **`main`** — Default app (Next.js viewer + signaling server).
- **`feature/sql-vector-modular`** — Modular Postgres + pgvector data layer (FastAPI, migrations, test script). All DB-layer code lives in `backend/` on this branch. See `backend/README.md` and `backend/DATABASE_README.md`.

## Project Structure

```
viewer-webapp/
├── src/app/              ← FRONTEND (UI components)
│   ├── page.tsx          ← Viewer page (laptop)
│   ├── camera/page.tsx   ← Camera page (phone)
│   ├── layout.tsx        
│   └── globals.css       
├── backend/               ← BACKEND
│   ├── signaling.js      ← WebSocket signaling (all branches)
│   ├── app/, migrations/, scripts/  ← SQL+pgvector layer (feature/sql-vector-modular)
│   └── README.md
├── server.js              ← Server entry point
├── FRONTEND_README.md     ← Guide for frontend devs
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
