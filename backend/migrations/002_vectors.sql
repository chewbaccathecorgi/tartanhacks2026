-- 002_vectors.sql: Vector columns and indexes (pgvector)
-- Dimensions: face_embedding_dim=512, text_embedding_dim=1536 (change if config differs; re-run index creation).

-- Face embeddings: vector(512) by default
ALTER TABLE customer_face_embeddings
    ADD COLUMN IF NOT EXISTS embedding vector(512);
ALTER TABLE customer_face_embeddings
    ALTER COLUMN embedding SET NOT NULL;  -- run after backfill if column was added nullable

-- Customer memory: vector(1536) by default
ALTER TABLE customer_memory
    ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE customer_memory
    ALTER COLUMN embedding SET NOT NULL;

-- HNSW indexes for fast approximate nearest-neighbor (cosine distance typical for normalized embeddings)
-- Use vector_cosine_ops for cosine; use vector_l2_ops for L2 if your embeddings are L2-normalized differently.
-- If HNSW is not available (older pgvector), use IVFFlat instead (see comments below).

-- Face: consent gating is applied in queries (WHERE c.consent_for_biometrics = true), not in index
CREATE INDEX IF NOT EXISTS idx_customer_face_embeddings_embedding_hnsw
    ON customer_face_embeddings
    USING hnsw (embedding vector_cosine_ops);

-- Memory: semantic search by text embedding
CREATE INDEX IF NOT EXISTS idx_customer_memory_embedding_hnsw
    ON customer_memory
    USING hnsw (embedding vector_cosine_ops);

-- Fallback: if your pgvector does not support HNSW, uncomment and use IVFFlat (requires some rows for training):
-- CREATE INDEX IF NOT EXISTS idx_customer_face_embeddings_embedding_ivfflat
--     ON customer_face_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
-- CREATE INDEX IF NOT EXISTS idx_customer_memory_embedding_ivfflat
--     ON customer_memory USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
