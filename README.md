# GlassesStream -- Face Recognition Viewer

Real-time face detection and recognition from Meta Glasses video stream. Uses MediaPipe for in-browser face/gesture detection and Azure Face API for profile deduplication.

**Hosting:** Everything runs via **ngrok**. You run `npm run dev` (app listens on port 3001), then point **ngrok** at 3001 and use the ngrok URL for streaming and the app. No localhost for access. Azure is only for **Face API** (keys in `.env.local`). See **[AZURE_SETUP.md](./AZURE_SETUP.md)** for the Face API key.

## Project Structure

```
tartanhacks2026/
├── src/app/                  ← Pages and API routes
│   ├── page.tsx              ← Main streaming page (face detection, gestures)
│   ├── camera/page.tsx       ← Camera page (legacy WebRTC)
│   ├── processor/page.tsx    ← People list page
│   ├── processor/[id]/       ← Individual profile page
│   └── api/                  ← REST API routes
│       ├── faces/            ← Face capture, merge, move, split
│       └── recording/        ← Recording sessions
├── src/lib/
│   ├── azureFace.ts          ← Azure Face API client
│   └── faceStore.ts          ← In-memory profile store
├── backend/
│   └── signaling.js          ← WebSocket signaling (legacy)
├── server.js                 ← Node.js server entry point
└── package.json
```

## Run the app (ngrok)

```bash
# 1. Install dependencies
npm install

# 2. Copy environment template and fill in your Azure Face API keys (optional; for face dedup)
cp .env.example .env.local
# Edit .env.local with your Azure Face API endpoint and key (see AZURE_SETUP.md)

# 3. Start the server (listens on port 3001)
npm run dev
```

In another terminal, start **ngrok** pointing at port 3001:

```bash
ngrok http 3001
```

**First time?** Install ngrok and add your authtoken: `ngrok config add-authtoken <token>` (get the token from [dashboard.ngrok.com](https://dashboard.ngrok.com)). Then run `ngrok http 3001` again.

The terminal will show your public URL. Use that URL for everything. Example (yours may differ after restarting ngrok):

- **https://postamniotic-unstuttering-messiah.ngrok-free.dev/** — Main streaming page (share screen, detect faces, record)
- **https://postamniotic-unstuttering-messiah.ngrok-free.dev/processor** — People list (all captured profiles)
- **https://postamniotic-unstuttering-messiah.ngrok-free.dev/processor/[id]** — Individual profile (photos, conversations, edit)

No localhost for access — use the ngrok URL only.

**Port 3001 in use?** Stop the other process (e.g. close the terminal that ran `npm run dev`, or kill the process on 3001). **ngrok says "endpoint already online"?** Stop the existing ngrok tunnel (close that terminal or run `ngrok stop` in the ngrok session) or use `ngrok http 3001 --pooling-enabled` to run multiple tunnels.

**"Invariant: missing bootstrap script" when opening via ngrok?** In `.env.local` set your ngrok URL so script/asset URLs load correctly, then restart the dev server:
- `NEXT_PUBLIC_APP_URL=https://postamniotic-unstuttering-messiah.ngrok-free.dev`
- `NEXT_HOSTNAME=postamniotic-unstuttering-messiah.ngrok-free.dev`
If it still happens, delete the `.next` folder and run `npm run dev` again.

**ChunkLoadError as soon as you open the ngrok URL?** Free ngrok often serves a "Visit Site" page instead of JS chunks, which breaks loading. Quick fixes: (1) Install a browser extension (e.g. ModHeader, Requestly) and add request header `ngrok-skip-browser-warning: true` for your ngrok domain, then reload; or (2) run in production so there are fewer chunks: `npm run build && npm start`, then open the ngrok URL again.

## Smoke Test

```bash
# Set BASE to your ngrok URL
BASE=https://postamniotic-unstuttering-messiah.ngrok-free.dev

# Test API
curl -s "$BASE/api/faces" | head -c 200

# Test main page loads
curl -s -o /dev/null -w "%{http_code}" "$BASE/"

# Test processor page loads
curl -s -o /dev/null -w "%{http_code}" "$BASE/processor"
```

All should return `200`.

## Key Endpoints

| Path | Method | Description |
|------|--------|-------------|
| `/` | GET | Main streaming page |
| `/processor` | GET | People list |
| `/processor/[id]` | GET | Individual profile |
| `/api/faces` | GET | List all profiles (compact) |
| `/api/faces` | POST | Add a face capture |
| `/api/faces/[id]` | GET/PUT/DELETE | Profile CRUD |
| `/api/faces/[id]/move` | POST | Move a photo between profiles |
| `/api/faces/[id]/split` | POST | Split photos into new profile |
| `/api/faces/merge` | POST | Merge multiple profiles |
| `/api/recording` | GET/POST | Recording session management |
| `/api/signaling` | WebSocket | WebRTC signaling (legacy) |

## Architecture

- **Browser**: MediaPipe FaceLandmarker + GestureRecognizer run locally. Peace sign triggers face capture + recording toggle.
- **Server**: Next.js API routes handle face storage, profile management, and (optionally) Azure Face API calls for deduplication.
- **Azure Face API**: Used for face detection validation and profile identification. Degrades gracefully if unavailable.
- **Data**: In-memory store (profiles lost on restart -- permanent storage planned for future).
