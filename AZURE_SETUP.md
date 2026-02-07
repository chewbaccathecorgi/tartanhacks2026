# Azure Face API Setup (Face Stuff Only)

This app uses **Azure Face API** (Cognitive Services) for face detection validation and profile deduplication. There is **no** deployment to Azure App Service — you run `npm run dev` (server on port 3001) and access the app via **ngrok** only.

---

## What you need

| Resource | Purpose |
|----------|---------|
| **Face API (Cognitive Services)** | Face detection and person grouping; keys go in `.env.local` |

You only need one Face resource. No App Service, no web app deployment.

---

## Get your Face API endpoint and key

1. Go to [Azure Portal](https://portal.azure.com) and sign in.
2. Search for **"Face"** or go to **Create a resource** → **AI + Machine Learning** → **Face**.
3. Create a new Face resource (name, region, pricing tier) or open an existing one.
4. Open the resource → **Keys and Endpoint** (under "Resource management").
5. Copy:
   - **Endpoint** — URL like `https://<your-resource-name>.cognitiveservices.azure.com`
   - **Key 1** (or Key 2)

Do **not** put these in code or commit them. Put them only in `.env.local` (see below).

---

## Configure the app

1. In the project root, copy the example env file:
   ```bash
   cp .env.example .env.local
   ```
2. Edit `.env.local` and set:
   - `AZURE_FACE_ENDPOINT` = your Face **Endpoint** URL (no trailing slash needed)
   - `AZURE_FACE_KEY` = your **Key 1** (or Key 2)

3. Restart the dev server (`npm run dev`). The app will use these for Face API calls.

If you leave them unset or invalid, the app still runs; face deduplication will fall back to local-only (you can merge/split manually).

---

## Optional: Port

Default port is **3001**. To override:

```bash
# In .env.local
PORT=3001
```

---

## Summary

| What | Where |
|------|--------|
| Hosting | `npm run dev` (port 3001) + ngrok; use the ngrok URL for all access |
| Face API | Azure Portal → Face resource → Keys and Endpoint → put in `.env.local` as `AZURE_FACE_ENDPOINT` and `AZURE_FACE_KEY` |

No Azure App Service, no deploy scripts — only Face API for face stuff.
