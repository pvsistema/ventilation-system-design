-- Счётчик расчётов с лицензией и без неё, по дням.
--
-- ЗАЧЕМ. Расчётные серверы переведены на проверку лицензии, но пока работают в
-- мягком режиме: считают всем, а случаи без лицензии записывают. Строгий режим
-- можно включать только тогда, когда у людей обновится программа — иначе
-- работа встанет у всех, включая честно оплативших.
--
-- Эта таблица показывает момент, когда переход безопасен: как только доля
-- расчётов без лицензии падает почти до нуля, значит все обновились.
--
-- Одна строка на день, функцию и исход — таблица не растёт, запись дешёвая.
CREATE TABLE IF NOT EXISTS compute_license_daily (
    day        DATE NOT NULL,
    func       TEXT NOT NULL,          -- airflow, aerodynamics и т.д.
    outcome    TEXT NOT NULL,          -- ok | emergency | no_license | bad_signature | expired ...
    cnt        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, func, outcome)
);

CREATE INDEX IF NOT EXISTS idx_compute_license_daily_day
    ON compute_license_daily (day);