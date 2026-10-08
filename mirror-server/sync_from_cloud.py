"""
Копирует ВСЕ данные из облачной базы poehali.dev в базу зеркала:
лицензии, рабочие места, аварийные ключи, клиентские доступы, журнал,
настройки — и запись о версии программы (version.json).

Работает, пока poehali.dev доступен. Запускайте по расписанию (cron),
тогда в момент аварии на зеркале будут свежие данные.

    python sync_from_cloud.py           # полная синхронизация
    python sync_from_cloud.py --check   # только показать, что есть в облаке

Как работает: забирает таблицы через админ-функцию (действия export_tables /
export_table, пароль ADMIN_PASSWORD), затем в ОДНОЙ транзакции очищает
таблицы зеркала и заливает данные. Если облако не ответило — база зеркала
не трогается.
"""
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from server import load_env  # noqa: E402

load_env(os.path.join(HERE, ".env"))

import psycopg2  # noqa: E402
from psycopg2 import sql as psql  # noqa: E402

ADMIN_URL = os.environ.get("CLOUD_ADMIN_URL", "")
VERSION_URL = os.environ.get("CLOUD_VERSION_URL", "")
PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
STORAGE = os.environ.get("PVS_STORAGE") or os.path.join(HERE, "storage")

# Порядок заливки — родительские таблицы раньше дочерних.
ORDER = ["licenses", "offline_keys", "client_access", "app_settings"]


def call(url: str, payload: dict) -> dict:
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(), method="POST",
        headers={"Content-Type": "application/json", "X-Admin-Password": PASSWORD})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def fetch_cloud() -> dict:
    tables = call(ADMIN_URL, {"action": "export_tables", "password": PASSWORD})["tables"]
    data = {}
    for t in tables:
        name = t["table"]
        rows, cols, offset = [], [], 0
        while True:
            part = call(ADMIN_URL, {"action": "export_table", "password": PASSWORD,
                                    "table": name, "offset": offset, "limit": 2000})
            cols = part["columns"]
            rows.extend(part["rows"])
            offset += len(part["rows"])
            if part["done"]:
                break
        data[name] = (cols, rows)
        print(f"  облако: {name:28s} {len(rows):>6} строк")
    return data


def load_into_mirror(data: dict) -> None:
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    cur = conn.cursor()
    cur.execute("SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = current_schema() AND table_type='BASE TABLE'")
    local = {r[0] for r in cur.fetchall()} - {"_mirror_migrations"}
    names = [n for n in data if n in local]
    missing = [n for n in data if n not in local]
    if missing:
        print("  ВНИМАНИЕ: нет в базе зеркала (выполните init_db.py):", missing)

    try:
        cur.execute(psql.SQL("TRUNCATE {} RESTART IDENTITY CASCADE").format(
            psql.SQL(", ").join(psql.Identifier(n) for n in names)))
        ordered = [n for n in ORDER if n in names] + [n for n in names if n not in ORDER]
        for n in ordered:
            cols, rows = data[n]
            if not rows:
                continue
            q = psql.SQL("INSERT INTO {} ({}) VALUES ({})").format(
                psql.Identifier(n),
                psql.SQL(", ").join(psql.Identifier(c) for c in cols),
                psql.SQL(", ").join(psql.Placeholder() for _ in cols))
            cur.executemany(q, [[json.dumps(v) if isinstance(v, (dict, list)) else v
                                 for v in r] for r in rows])
            # Счётчики id — дальше максимального, чтобы новые записи не конфликтовали.
            if "id" in cols:
                cur.execute(psql.SQL(
                    "SELECT setval(pg_get_serial_sequence({t}, 'id'), "
                    "(SELECT COALESCE(MAX(id), 1) FROM {i}))").format(
                    t=psql.Literal(n), i=psql.Identifier(n)))
        conn.commit()
        print("  база зеркала обновлена")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def sync_version() -> None:
    if not VERSION_URL:
        return
    try:
        info = call(VERSION_URL, {"action": "export_info"})
    except Exception as ex:  # noqa: BLE001
        print("  version.json не получен:", ex)
        return
    p = os.path.join(STORAGE, "files", "updates", "version.json")
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(info, f, ensure_ascii=False)
    print("  версия программы:", info.get("version"))


def main() -> int:
    if not (ADMIN_URL and PASSWORD):
        print("Заполните CLOUD_ADMIN_URL и ADMIN_PASSWORD в .env")
        return 1
    print("Синхронизация с poehali.dev …")
    try:
        data = fetch_cloud()
    except Exception as ex:  # noqa: BLE001
        print("Облако недоступно, база зеркала НЕ изменена:", ex)
        return 2
    if "--check" in sys.argv:
        return 0
    load_into_mirror(data)
    sync_version()
    print("Готово.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
