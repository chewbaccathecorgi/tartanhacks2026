# Backend - DO NOT MODIFY IF YOU'RE WORKING ON FRONTEND

**This folder contains backend infrastructure code.**

**Modular SQL + pgvector layer:** Developed on branch **`feature/sql-vector-modular`**. Switch to that branch for `app/`, `migrations/`, `scripts/`, and DB docs.

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

---

## SQL + pgvector data layer

This backend includes a minimal FastAPI + Postgres + pgvector layer for consented customer/employee interaction data (customers, employees, sessions, transcript chunks, face embeddings, preferences, semantic memory). See `DATABASE_README.md` for schema and query design. Embeddings and labels are **provided** by the caller; no ML, transcription, or face detection runs here.

### Running independently of the main app

The SQL + pgvector layer does **not** depend on the Node/Next.js app or `npm run dev`. You can run it on its own.

**1. DB pipeline test (one-off script, no server)**

From the **backend** directory:

```bash
cd backend
pip install -r requirements.txt
python scripts/test_db_pipeline.py
```

Requires Postgres (with migrations applied) and a valid `DATABASE_URL` (e.g. in `backend/.env`). The script creates test data, runs face/memory search, consent gating, and opt-out, then exits.

**2. FastAPI DB API (HTTP server only)**

To run just the DB API (endpoints like `/search/face`, `/search/memory`, `/customers/{id}/context`, `/customers/{id}/opt-out`) without the main frontend or signaling server:

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Then open `http://localhost:8000/docs` for Swagger, or call the API from another client. Again, Postgres and `DATABASE_URL` are required.

**Python dependencies** are in `requirements-base.txt`; install with `pip install -r requirements.txt`. The test script is deterministic (fixed seed); dimensions use config (default 512 / 1536)—set `FACE_EMBEDDING_DIM` and `TEXT_EMBEDDING_DIM` to match your migrated schema.

---

## Data Formats & Performance

### Endpoint payloads that use vectors

All vectors are `list[float]`. Length must match the configured dimension (defaults: face 512, text 1536).

**POST /search/face** — nearest-neighbor by face embedding (consent-gated):

```json
{
  "embedding": [0.012, -0.034, 0.056, ...]
}
```

- `embedding`: **required**. `list[float]`, length = **FACE_EMBEDDING_DIM** (default 512).

**POST /search/memory** — top-k memories by text embedding (optional `?customer_id=...`):

```json
{
  "embedding": [0.01, 0.02, -0.01, ...]
}
```

- `embedding`: **required**. `list[float]`, length = **TEXT_EMBEDDING_DIM** (default 1536).

### Best practices for performance

- **Use float32** when generating or serializing vectors (smaller payload and DB storage; pgvector stores efficiently). Avoid float64 unless required.
- **Normalization**: The layer uses **cosine distance** (`<=>` in pgvector). Indexes use `vector_cosine_ops`. For best results, **store and query with L2-normalized vectors** so cosine distance behaves as intended.
- **Batch inserts**: Insert transcript chunks and embeddings in batches (e.g. `add_all` or bulk insert) instead of one row per request where possible.
- **Avoid large blobs**: Store only vectors and short text (nuggets, preferences, chunk content). For large media, store references (URLs/keys) elsewhere; do not put raw blobs in this schema.
- **Transcript chunk size**: Recommended **200–500 tokens** per `transcript_chunks.content` (or similar character ranges). Smaller chunks give finer-grained context; larger chunks reduce row count and can improve semantic coherence. Tune for your embedding model and use case.

### Schema fields: required vs optional

| Table / usage | Required | Optional |
|---------------|----------|----------|
| **customers** | `external_id`, `display_name`, `consent_for_biometrics` | `notes` |
| **employees** | `external_id`, `display_name` | `notes` |
| **sessions** | `employee_id`, `session_key` | `customer_id`, `metadata` |
| **transcript_chunks** | `session_id`, `chunk_index`, `content` | — |
| **customer_face_embeddings** | `customer_id`, `model_name`, `embedding` (dim = face_dim) | `source_session_id`, `idempotency_hash` |
| **customer_preferences** | `customer_id`, `kind`, `value` | `category`, `source_session_id` |
| **customer_memory** | `customer_id`, `nugget`, `model_name`, `embedding` (dim = text_dim) | `source_session_id`, `idempotency_hash` |
| **coaching_notes** | `session_id`, `content` | — |

Provenance fields (`model_name`, `created_at`, `source_session_id`, `idempotency_hash`) are recommended for embeddings for audit and idempotency.
