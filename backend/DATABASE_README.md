# Schema & Query Design — Postgres + pgvector Data Layer

This document describes the database schema, indexing strategy, and required query patterns for the consented employee–customer interaction system. It is **SQL + vector only**; no ML, transcription, or embedding generation is implemented here.

---

## Directory Tree

```
backend/
├── app/
│   ├── core/
│   │   ├── __init__.py
│   │   └── config.py           # Embedding dims (face 512, text 1536), DB URL
│   ├── db/
│   │   ├── __init__.py
│   │   └── session.py         # Engine + session factory
│   ├── models/                # SQLAlchemy models only
│   │   ├── __init__.py
│   │   ├── base.py
│   │   ├── coaching_note.py
│   │   ├── customer.py
│   │   ├── customer_face_embedding.py
│   │   ├── customer_memory.py
│   │   ├── customer_preference.py
│   │   ├── employee.py
│   │   ├── session.py
│   │   └── transcript.py
│   ├── repositories/          # Raw DB access + exact SQL
│   │   ├── __init__.py
│   │   ├── queries.py         # All required SQL strings
│   │   ├── customer_repo.py
│   │   ├── face_repo.py
│   │   ├── memory_repo.py
│   │   └── opt_out_repo.py
│   ├── services/
│   │   ├── __init__.py
│   │   └── consent_service.py # Opt-out / hard-delete logic
│   ├── routers/               # Thin API layer
│   │   ├── __init__.py
│   │   ├── customers.py
│   │   └── search.py
│   ├── __init__.py
│   └── main.py
├── migrations/
│   ├── 001_init.sql           # Extensions, base tables
│   ├── 002_vectors.sql       # Vector columns + HNSW indexes
│   └── 003_constraints.sql   # Consent comments, no new FKs
├── requirements.txt          # pip install -r this (includes requirements-base.txt)
├── requirements-base.txt     # Python dependency list
├── README.md
└── DATABASE_README.md        # This file
```

---

## Data Model (Mandatory Tables)

| Table | Purpose |
|-------|--------|
| **customers** | Customer profile; `consent_for_biometrics` gates face storage/search |
| **employees** | Employee profile |
| **sessions** | Interaction session; `employee_id` required, `customer_id` nullable (set to NULL on opt-out) |
| **transcript_chunks** | Text-only chunks per session |
| **customer_face_embeddings** | Face vectors + provenance (model_name, created_at, source_session_id, idempotency_hash) |
| **customer_preferences** | Structured likes/dislikes (kind, category, value) |
| **customer_memory** | Short nuggets + text embedding for semantic retrieval; provenance as above |
| **coaching_notes** | Optional text per session |

Vector dimensions (enforced in schema):

- **face_embedding_dim**: 512 (configurable in `app/core/config.py`)
- **text_embedding_dim**: 1536 (configurable)

---

## Indexing Strategy

- **Vector indexes**: HNSW with `vector_cosine_ops` for both `customer_face_embeddings.embedding` and `customer_memory.embedding`. See `migrations/002_vectors.sql`. If HNSW is unavailable (older pgvector), use IVFFlat (commented in 002).
- **Consent**: No index on `consent_for_biometrics` required for the current query pattern; we JOIN customers and filter `WHERE c.consent_for_biometrics = true` so a small index on that column is present (001_init.sql).
- **Lookups**: Indexes on `external_id`, `session_key`, `customer_id`, `session_id`, and idempotency hashes where used.

---

## Consent & Opt-Out Rules

1. **Consent gating**: All face-embedding search queries **MUST** exclude customers where `consent_for_biometrics = false` (implemented in `SQL_FACE_NEAREST_NEIGHBOR`).
2. **Opt-out (hard delete)**:
   - NULL out `customer_id` on all **sessions** (sessions remain for analytics).
   - DELETE **customers** row; FKs with ON DELETE CASCADE remove:
     - **customer_face_embeddings**
     - **customer_preferences**
     - **customer_memory**
   - Order in code: `UPDATE sessions SET customer_id = NULL` then `DELETE FROM customers` (see `app/repositories/queries.py` and `opt_out_repo.py`).

---

## Required Queries (Exact SQL)

### 1) Nearest-neighbor customer match by face embedding (consent gated)

```sql
SELECT
    c.id AS customer_id,
    c.external_id,
    c.display_name,
    f.id AS embedding_id,
    f.embedding <=> (:embedding::vector) AS distance
FROM customer_face_embeddings f
JOIN customers c ON c.id = f.customer_id
WHERE c.consent_for_biometrics = true
ORDER BY f.embedding <=> (:embedding::vector)
LIMIT :limit;
```

- `:embedding`: string representation of 512-dim vector, e.g. `[0.1,0.2,...]`.
- **Consent**: Only customers with `consent_for_biometrics = true` are included.

### 2) Top-k customer memories by text embedding similarity

Per-customer:

```sql
SELECT
    m.id,
    m.customer_id,
    m.nugget,
    m.model_name,
    m.source_session_id,
    m.created_at,
    m.embedding <=> (:embedding::vector) AS distance
FROM customer_memory m
WHERE m.customer_id = :customer_id
ORDER BY m.embedding <=> (:embedding::vector)
LIMIT :limit;
```

Global (all customers):

```sql
SELECT
    m.id,
    m.customer_id,
    m.nugget,
    m.model_name,
    m.source_session_id,
    m.created_at,
    m.embedding <=> (:embedding::vector) AS distance
FROM customer_memory m
ORDER BY m.embedding <=> (:embedding::vector)
LIMIT :limit;
```

- `:embedding`: 1536-dim vector string.

### 3) Full customer context (profile + preferences + recent sessions)

```sql
WITH prof AS (
    SELECT id, external_id, display_name, notes, consent_for_biometrics, created_at, updated_at
    FROM customers WHERE id = :customer_id
),
prefs AS (
    SELECT id, kind, category, value, source_session_id, created_at
    FROM customer_preferences WHERE customer_id = :customer_id
),
recent_sessions AS (
    SELECT s.id, s.session_key, s.employee_id, s.customer_id, s.metadata, s.created_at
    FROM sessions s
    WHERE s.customer_id = :customer_id
    ORDER BY s.created_at DESC
    LIMIT :sessions_limit
)
SELECT
    (SELECT row_to_json(prof.*) FROM prof) AS profile,
    (SELECT COALESCE(json_agg(row_to_json(prefs.*)), '[]'::json) FROM prefs) AS preferences,
    (SELECT COALESCE(json_agg(row_to_json(rs.*)), '[]'::json) FROM recent_sessions rs) AS recent_sessions;
```

### 4) Hard-delete / opt-out sequence

Run in a single transaction:

```sql
UPDATE sessions SET customer_id = NULL WHERE customer_id = :customer_id;
DELETE FROM customers WHERE id = :customer_id;
```

Cascades (from FK definitions) remove all rows in `customer_face_embeddings`, `customer_preferences`, and `customer_memory` for that customer. Sessions remain with `customer_id = NULL`.

---

## Running Migrations

From the project root (with Postgres 16 + pgvector installed):

```bash
cd backend
psql $DATABASE_URL -f migrations/001_init.sql
psql $DATABASE_URL -f migrations/002_vectors.sql
psql $DATABASE_URL -f migrations/003_constraints.sql
```

Set `DATABASE_URL` to your Postgres connection string (e.g. `postgresql://user:pass@host:5432/dbname` or a cloud URI with `?sslmode=require`).

---

## API (Thin Layer)

- **GET /customers/{customer_id}/context** — Full customer context (uses query 3).
- **DELETE /customers/{customer_id}/opt-out** — Hard-delete / opt-out (uses query 4).
- **POST /search/face** — Body: `{"embedding": [ ... ]}`. Consent-gated face nearest-neighbor (query 1).
- **POST /search/memory** — Body: `{"embedding": [ ... ]}`; optional `customer_id` query param. Top-k memories (query 2).

Embeddings and all extracted attributes are assumed to be computed elsewhere and passed in as arrays/strings.
