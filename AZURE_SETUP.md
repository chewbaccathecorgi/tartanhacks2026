# Full Azure Setup — Replace ngrok (Streaming + Processor)

This app runs on **Azure App Service** so you get a public HTTPS URL. No ngrok or tunnel needed. Streaming (share screen, face detection, recording) and the processor (people list, profiles) work the same as before.

---

## 1. Azure resources you need

| Resource | Purpose | You already have? |
|----------|---------|--------------------|
| **App Service (Web App)** | Hosts the Node.js app and serves the site over HTTPS | Yes — `glasses-demo-api-penispenis` |
| **Face API (Cognitive Services)** | Face detection and person grouping for the processor | Need endpoint + key in App Service settings |

You only need **one** App Service and **one** Face API resource. No extra “resource packs” unless you want a separate staging slot or more regions.

---

## 2. Get your Face API endpoint and key (required for processor)

The app needs two values in the environment. They come from **Azure Portal**, not from this repo.

### Step A: Create or open your Face API resource

1. Go to [Azure Portal](https://portal.azure.com) and sign in.
2. Search for **“Face”** or go to **Create a resource** → **AI + Machine Learning** → **Face**.
3. Either **create** a new Face resource (pick a name, region, pricing tier) or **open** the one you already use (e.g. `faceingstuff` from the README).
4. After create/open, go to the resource’s **Overview** page.

### Step B: Copy Endpoint and Key

1. In the left menu, click **Keys and Endpoint** (under “Resource management”).
2. You will see:
   - **Endpoint** — URL like `https://<your-resource-name>.cognitiveservices.azure.com`
   - **Key 1** and **Key 2** — either key works; use one and keep it secret.
3. Copy:
   - The **Endpoint** value (full URL, no trailing slash is fine).
   - **Key 1** (or Key 2) — the long string.

Do **not** put these in code or in the repo. You will put them only in App Service configuration (next section).

---

## 3. Configure the App Service (where to put the key)

1. In Azure Portal, open your **App Service**: `glasses-demo-api-penispenis`.
2. Go to **Configuration** (under “Settings”).
3. Open the **Application settings** tab.
4. Add or edit these **Application settings** (name = exactly this, value = your value):

| Name | Value | Notes |
|------|--------|--------|
| `NODE_ENV` | `production` | Required so the app runs in production mode. |
| `AZURE_FACE_ENDPOINT` | Paste the **Endpoint** URL from Keys and Endpoint (e.g. `https://faceingstuff.cognitiveservices.azure.com`) | No placeholder — use your real endpoint. |
| `AZURE_FACE_KEY` | Paste **Key 1** (or Key 2) from Keys and Endpoint | No placeholder — use your real key. |

5. Click **Save** at the top. The app will restart and pick up the new settings.

You do **not** need to set `PORT` or `WEBSITES_PORT` — Azure sets `PORT` for you. You do **not** need to set `BIND_HOST` — the app binds to `0.0.0.0` by default for Azure.

---

## 4. General settings and WebSockets

In the same App Service:

1. **Configuration** → **General settings**:
   - **Stack**: Node.
   - **Major version**: 20 (LTS).
   - **Startup Command**: `node server.js`
   - **Web sockets**: **On** (needed for `/api/signaling` if you use the camera/WebRTC page).

2. Save if you changed anything.

---

## 5. Deploy the code (choose one)

### Option A: GitHub Deployment Center (recommended)

1. Push this repo to GitHub (e.g. `chewbaccathecorgi/tartanhacks2026`).
2. In Azure Portal → your App Service → **Deployment Center**.
3. Source: **GitHub** → authorize and select repo + branch (e.g. `main` or `brandon`).
4. Azure will run `npm install` and `npm run build`, then start with `node server.js`. Every push to that branch deploys.

### Option B: Zip deploy (manual)

1. **Windows (PowerShell from project root):**
   ```powershell
   .\deploy-azure.ps1
   ```
   This creates `app.zip` with the right files (no `node_modules` or `.next`). Azure will run `npm install` and `npm run build` when you deploy.

2. **Or** create the zip manually: include `src`, `backend`, `server.js`, `package.json`, `package-lock.json`, `next.config.ts`, `tsconfig.json`, `.env.example`, and `public` if present. Exclude `node_modules`, `.next`, and `.env.local`.

3. Upload and deploy:
   - **Azure CLI:** `az webapp deploy --resource-group <your-resource-group> --name glasses-demo-api-penispenis --src-path app.zip --type zip`
   - **Portal:** App Service → **Deployment Center** → use the **Zip Deploy** option, or **Advanced Tools** → **Go** (Kudu) and use the zip deploy API / drag-and-drop.

After zip deploy, Oryx runs `npm install` and `npm run build` on the server; the app starts with **Startup Command** `node server.js`.

---

## 6. Your live URL (replaces ngrok)

Once deployed, the app is available at:

**https://glasses-demo-api-penispenis-b9h5eyd9gwehc3cx.canadacentral-01.azurewebsites.net**

Use this URL for everything. No ngrok, no tunnel.

- **Streaming**: Open the URL → `/` → share screen, use gestures, face capture and recording work as before.
- **Processor**: Open the same URL → `/processor` for the people list, click a profile for `/processor/[id]`.
- **APIs**: Same base URL: `/api/faces`, `/api/recording`, etc. The frontend uses relative paths, so it always talks to this host.

---

## 7. Verify streaming and processor

1. **Homepage / streaming**
   - Open: `https://glasses-demo-api-penispenis-b9h5eyd9gwehc3cx.canadacentral-01.azurewebsites.net/`
   - Share screen or use camera; you should see face detection and peace-sign capture/recording as before.

2. **Processor**
   - Open: `https://glasses-demo-api-penispenis-b9h5eyd9gwehc3cx.canadacentral-01.azurewebsites.net/processor`
   - You should see the list of people; clicking one opens the profile page.

3. **API**
   - In a browser or terminal:
     ```bash
     curl -s "https://glasses-demo-api-penispenis-b9h5eyd9gwehc3cx.canadacentral-01.azurewebsites.net/api/faces"
     ```
   - You should get JSON (e.g. `[]` or a list of profiles).

If something fails, check **Monitoring** → **Log stream** in the App Service to see startup and runtime errors.

**Quick checklist:** Same as with ngrok — open the Azure URL → stream on `/`, manage people on `/processor`. No tunnel; everything goes over HTTPS to your App Service.

---

## 8. If you need an API or service key

- **Face API**: The only external key the app uses is the **Azure Face API** key above. There is no separate “app API key” or “service key” — only `AZURE_FACE_ENDPOINT` and `AZURE_FACE_KEY` in App Service settings.
- **Other Azure resources**: You don’t need Storage, Key Vault, or extra “resource packs” for basic streaming and processor. If we add a feature later that needs another key (e.g. Speech, storage), we’ll document it here with the exact setting name and where to get the value (no “your-api-key” placeholders).

---

## Summary

| What | Where |
|------|--------|
| Hosting | Azure App Service — same as ngrok but with your own HTTPS URL |
| Face API key | Azure Portal → Face resource → Keys and Endpoint → Key 1 (or Key 2) → put in App Service as `AZURE_FACE_KEY` |
| Face API endpoint | Same blade → Endpoint URL → put in App Service as `AZURE_FACE_ENDPOINT` |
| Streaming + processor | Open the App Service URL; behavior matches what you had with ngrok |
