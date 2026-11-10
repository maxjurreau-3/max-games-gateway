-- Replay protection and vector stake history for the authenticated game gateway.
CREATE TABLE IF NOT EXISTS processed_nonces (
    nonce TEXT PRIMARY KEY,
    timestamp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_processed_nonces_timestamp ON processed_nonces(timestamp);

CREATE TABLE IF NOT EXISTS vector_stakes (
    stake_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    pos_x REAL NOT NULL,
    pos_y REAL NOT NULL,
    pos_z REAL NOT NULL,
    vel_x REAL NOT NULL,
    vel_y REAL NOT NULL,
    vel_z REAL NOT NULL,
    stake_amount REAL NOT NULL DEFAULT 0 CHECK (stake_amount >= 0),
    timestamp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vector_stakes_session_timestamp
    ON vector_stakes(session_id, timestamp DESC);
