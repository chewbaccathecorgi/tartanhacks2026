"""
Exact SQL for required operations: consent-gated vector search, context fetch, opt-out.
Use with parameter binding; embedding dimensions match config (512 face, 1536 text).
"""

# ---------------------------------------------------------------------------
# 1) Nearest-neighbor customer match by face embedding (CONSENT GATED)
#    Excludes customers where consent_for_biometrics = false.
#    :embedding must be a list of 512 floats (or string representation).
# ---------------------------------------------------------------------------
SQL_FACE_NEAREST_NEIGHBOR = """
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
"""

# ---------------------------------------------------------------------------
# 2) Top-k customer memories by text embedding similarity (per customer or global)
#    Consent: memory is derived data; we filter by customer. Consent for
#    semantic memory can follow same consent or separate; here we allow
#    retrieval for any customer (no biometric). If you need consent gating
#    for memory, add JOIN customers c ON c.id = m.customer_id AND c.consent_*.
# ---------------------------------------------------------------------------
SQL_MEMORY_NEAREST_NEIGHBOR = """
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
"""

# Global top-k memories across all customers (e.g. for search):
SQL_MEMORY_NEAREST_NEIGHBOR_GLOBAL = """
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
"""

# ---------------------------------------------------------------------------
# 3) Full customer context: profile + preferences + recent sessions
# ---------------------------------------------------------------------------
SQL_CUSTOMER_CONTEXT = """
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
"""

# ---------------------------------------------------------------------------
# 4) Hard-delete / opt-out: guarantees biometric and derived data erasure
#    Order matters: FKs require children deleted or nulled first where needed.
#    Sessions: set customer_id to NULL (sessions remain for analytics).
#    Then delete: face_embeddings (CASCADE from customer), preferences,
#    customer_memory (CASCADE), finally customer.
#    Implementation: run in a transaction; session UPDATE then customer DELETE
#    (CASCADE handles face_embeddings, preferences, memories).
# ---------------------------------------------------------------------------
SQL_OPT_OUT_NULL_SESSIONS = """
UPDATE sessions SET customer_id = NULL WHERE customer_id = :customer_id;
"""

SQL_OPT_OUT_DELETE_CUSTOMER = """
DELETE FROM customers WHERE id = :customer_id;
"""

# Single-statement opt-out (relies on FK ON DELETE CASCADE and ON DELETE SET NULL):
# 1) UPDATE sessions SET customer_id = NULL WHERE customer_id = :customer_id;
# 2) DELETE FROM customers WHERE id = :customer_id;
# Cascades: customer_face_embeddings, customer_preferences, customer_memory deleted.
# Sessions keep rows with customer_id = NULL.
