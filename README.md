# GlassesStream -- Face Recognition Viewer

Real-time face detection and recognition from Meta Glasses video stream. Uses MediaPipe for in-browser face/gesture detection and Azure Face API for profile deduplication.

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

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Copy environment template and fill in your Azure keys
cp .env.example .env.local
# Edit .env.local with your Azure Face API endpoint and key

# 3. Start development server
npm run dev
```

The app runs at **http://localhost:3001**.

- `/` -- Main streaming page (share screen, detect faces, record)
- `/processor` -- People list (all captured profiles)
- `/processor/[id]` -- Individual profile (photos, conversations, edit)

## Deploy to Azure App Service

The app is deployed at:
**https://glasses-demo-api-penispenis-b9h5eyd9gwehc3cx.canadacentral-01.azurewebsites.net**

### Azure Portal Settings

1. **Configuration > General settings**
   - Stack: **Node**
   - Major version: **Node 20 LTS**
   - Startup Command: **`node server.js`**

2. **Configuration > Application settings** (Environment variables)
   | Name | Value |
   |------|-------|
   | `NODE_ENV` | `production` |
   | `AZURE_FACE_ENDPOINT` | `https://faceingstuff.cognitiveservices.azure.com` |
   | `AZURE_FACE_KEY` | *(your Face API key)* |

3. **Configuration > General settings**
   - Web sockets: **On**

4. **Monitoring > Log stream** -- view live logs for debugging startup issues

### Method A: GitHub Deployment Center (recommended)

1. Push this repo to GitHub
2. In Azure Portal, go to your App Service > **Deployment Center**
3. Source: **GitHub**, select your repo and branch
4. Azure auto-detects Node.js and runs:
   - `npm install`
   - `npm run build` (runs `next build`)
   - Starts with `node server.js`
5. Every push to the branch auto-deploys

### Method B: Zip Deploy (manual)

```bash
# Build locally
npm install
npm run build

# Zip everything (exclude node_modules and cache)
# On Linux/Mac:
zip -r app.zip . -x "node_modules/*" ".next/cache/*" ".env.local"

# On Windows PowerShell:
Compress-Archive -Path * -DestinationPath app.zip -Force

# Deploy
az webapp deploy \
  --resource-group <your-resource-group> \
  --name glasses-demo-api-penispenis \
  --src-path app.zip \
  --type zip
```

After zip deploy, Azure runs `npm install` automatically via Oryx build.

## Smoke Test

```bash
# Replace BASE with your deployment URL or http://localhost:3001
BASE=https://glasses-demo-api-penispenis-b9h5eyd9gwehc3cx.canadacentral-01.azurewebsites.net

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
