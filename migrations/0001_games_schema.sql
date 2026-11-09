PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS game_sessions (
    session_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    game_type TEXT NOT NULL,
    state_json TEXT NOT NULL CHECK (json_valid(state_json)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_game_sessions_user
    ON game_sessions(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS game_events (
    event_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES game_sessions(session_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_game_events_session
    ON game_events(session_id, created_at DESC);
