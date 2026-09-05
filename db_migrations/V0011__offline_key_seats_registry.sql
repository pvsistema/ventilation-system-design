-- Учёт рабочих мест, на которых используется аварийный оффлайн-ключ.
--
-- ЗАЧЕМ. Аварийный ключ проверяется на компьютере локально, по подписи, без
-- связи с сервером. Из-за этого до сих пор было невозможно ни отозвать уже
-- выданный ключ, ни узнать, на скольких ПК он реально работает: число мест
-- (seats) записывалось в реестр, но никем не проверялось.
--
-- Теперь программа раз в квартал, ЕСЛИ есть интернет, отмечается на сервере.
-- Каждое рабочее место записывается сюда — это даёт и учёт мест, и работающий
-- отзыв ключа. Нет связи — программа продолжает работать по подписи (режим
-- мягкий, рудник без интернета не должен вставать).
CREATE TABLE IF NOT EXISTS offline_key_seats (
    id             SERIAL PRIMARY KEY,
    offline_key_id INTEGER NOT NULL REFERENCES offline_keys(id),
    fingerprint    TEXT NOT NULL,
    hostname       TEXT,
    platform       TEXT,
    app_version    TEXT,
    last_ip        TEXT,
    is_blocked     BOOLEAN NOT NULL DEFAULT FALSE,
    first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (offline_key_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_offline_key_seats_key
    ON offline_key_seats (offline_key_id, first_seen_at);

CREATE INDEX IF NOT EXISTS idx_offline_keys_key
    ON offline_keys (key);

ALTER TABLE offline_keys
    ADD COLUMN IF NOT EXISTS bound_fp TEXT;