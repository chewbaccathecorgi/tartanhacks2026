-- 001_init.sql: Extensions and base tables (no vector columns yet)
-- Run against Postgres 16. Dimension placeholders: face_embedding_dim=512, text_embedding_dim=1536 (applied in 002).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ---------------------------------------------------------------------------
-- Core entities
-- ---------------------------------------------------------------------------
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    external_id VARCHAR(255) NOT NULL UNIQUE,
    display_name VARCHAR(255) NOT NULL,
    notes TEXT,
    consent_for_biometrics BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX idx_customers_external_id ON customers(external_id);
CREATE INDEX idx_customers_consent_for_biometrics ON customers(consent_for_biometrics);

CREATE TABLE employees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    external_id VARCHAR(255) NOT NULL UNIQUE,
    display_name VARCHAR(255) NOT NULL,
    notes TEXT
);
CREATE INDEX idx_employees_external_id ON employees(external_id);

CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    session_key VARCHAR(255) NOT NULL UNIQUE,
    metadata JSONB
);
CREATE INDEX idx_sessions_employee_id ON sessions(employee_id);
CREATE INDEX idx_sessions_customer_id ON sessions(customer_id);
CREATE INDEX idx_sessions_session_key ON sessions(session_key);
CREATE INDEX idx_sessions_created_at ON sessions(created_at DESC);

-- ---------------------------------------------------------------------------
-- Transcript (text only)
-- ---------------------------------------------------------------------------
CREATE TABLE transcript_chunks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL
);
CREATE INDEX idx_transcript_chunks_session_id ON transcript_chunks(session_id);

-- ---------------------------------------------------------------------------
-- Face embeddings table (embedding column added in 002_vectors.sql)
-- ---------------------------------------------------------------------------
CREATE TABLE customer_face_embeddings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    source_session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    model_name VARCHAR(255) NOT NULL,
    idempotency_hash VARCHAR(64) UNIQUE
);
CREATE INDEX idx_customer_face_embeddings_customer_id ON customer_face_embeddings(customer_id);
CREATE INDEX idx_customer_face_embeddings_source_session_id ON customer_face_embeddings(source_session_id);
CREATE UNIQUE INDEX idx_customer_face_embeddings_idempotency ON customer_face_embeddings(idempotency_hash) WHERE idempotency_hash IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Preferences (likes/dislikes)
-- ---------------------------------------------------------------------------
CREATE TABLE customer_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    kind VARCHAR(32) NOT NULL,
    category VARCHAR(64),
    value TEXT NOT NULL,
    source_session_id UUID REFERENCES sessions(id) ON DELETE SET NULL
);
CREATE INDEX idx_customer_preferences_customer_id ON customer_preferences(customer_id);

-- ---------------------------------------------------------------------------
-- Customer memory (embedding column added in 002_vectors.sql)
-- ---------------------------------------------------------------------------
CREATE TABLE customer_memory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    nugget TEXT NOT NULL,
    model_name VARCHAR(255) NOT NULL,
    source_session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    idempotency_hash VARCHAR(64) UNIQUE
);
CREATE INDEX idx_customer_memory_customer_id ON customer_memory(customer_id);
CREATE INDEX idx_customer_memory_source_session_id ON customer_memory(source_session_id);
CREATE UNIQUE INDEX idx_customer_memory_idempotency ON customer_memory(idempotency_hash) WHERE idempotency_hash IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Optional: coaching notes (text only)
-- ---------------------------------------------------------------------------
CREATE TABLE coaching_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    content TEXT NOT NULL
);
CREATE INDEX idx_coaching_notes_session_id ON coaching_notes(session_id);

-- Trigger to refresh updated_at (optional; application can do it too)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Updated_at triggers (Postgres 15+ uses EXECUTE FUNCTION)
CREATE TRIGGER tr_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tr_updated_at BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tr_updated_at BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tr_updated_at BEFORE UPDATE ON transcript_chunks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tr_updated_at BEFORE UPDATE ON customer_face_embeddings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tr_updated_at BEFORE UPDATE ON customer_preferences FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tr_updated_at BEFORE UPDATE ON customer_memory FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tr_updated_at BEFORE UPDATE ON coaching_notes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
