CREATE TABLE IF NOT EXISTS client_access (
    id SERIAL PRIMARY KEY,
    org_group VARCHAR(255) NOT NULL UNIQUE,
    login VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    password_salt VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS client_sessions (
    token VARCHAR(80) PRIMARY KEY,
    client_access_id INTEGER NOT NULL REFERENCES client_access(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);