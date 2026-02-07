-- 003_constraints.sql: Consent rules and cascades (reinforce FK behavior; no new FKs required)
-- Ensures: customer delete cascades to face_embeddings, preferences, memory; sessions get customer_id SET NULL.

-- FKs already defined in 001_init.sql with ON DELETE CASCADE / SET NULL as specified.
-- This migration adds any additional constraints or comments for consent/audit.

-- Optional: constraint that face_embedding rows only make sense when customer has consent
-- (enforced at application layer; DB cannot reference "current" customer.consent at insert time)
-- So we rely on application logic + query-time consent gating.

-- Comment for audit: consent is enforced in application and in all vector search queries
COMMENT ON COLUMN customers.consent_for_biometrics IS 'When false, face embeddings must not be stored or searched; queries must filter WHERE consent_for_biometrics = true';

-- Ensure customer_face_embeddings.embedding is required once present (no partial rows)
-- Already NOT NULL by default when adding column; if you added as nullable:
-- ALTER TABLE customer_face_embeddings ALTER COLUMN embedding SET NOT NULL;
-- ALTER TABLE customer_memory ALTER COLUMN embedding SET NOT NULL;

-- Optional: check that embedding dimensions match (handled by vector(N) in 002)
-- No additional constraints needed; opt-out behavior is implemented in service layer (hard delete + NULL customer_id).
