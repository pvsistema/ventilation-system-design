"""
Создаёт в базе зеркала все таблицы ПВ-Системы — прогоняет миграции из
db_migrations/ по порядку (V0001 … V00NN).

Запуск (из папки mirror-server, с заполненным .env):
    python init_db.py

Повторный запуск безопасен: уже применённые миграции запоминаются в
таблице _mirror_migrations и пропускаются.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MIGR = os.path.join(HERE, "..", "db_migrations")
sys.path.insert(0, HERE)
from server import load_env  # noqa: E402

load_env(os.path.join(HERE, ".env"))

import psycopg2  # noqa: E402


def main():
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("Не задан DATABASE_URL в .env")
        return 1
    conn = psycopg2.connect(dsn)
    conn.autocommit = False
    cur = conn.cursor()
    cur.execute("CREATE TABLE IF NOT EXISTS _mirror_migrations "
                "(name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW())")
    conn.commit()
    cur.execute("SELECT name FROM _mirror_migrations")
    done = {r[0] for r in cur.fetchall()}

    files = sorted(f for f in os.listdir(MIGR) if re.match(r"V\d+__.*\.sql$", f))
    for f in files:
        if f in done:
            continue
        with open(os.path.join(MIGR, f), encoding="utf-8") as fh:
            sql = fh.read()
        try:
            cur.execute(sql)
            cur.execute("INSERT INTO _mirror_migrations(name) VALUES (%s)", (f,))
            conn.commit()
            print("применено:", f)
        except Exception as ex:  # noqa: BLE001
            conn.rollback()
            print(f"ОШИБКА в {f}: {ex}")
            return 1
    print("База готова. Таблиц-миграций:", len(files))
    return 0


if __name__ == "__main__":
    sys.exit(main())
