"""
Копирует ВСЕ данные из облачной базы poehali.dev в базу зеркала:
лицензии, рабочие места, аварийные ключи, клиентские доступы, журнал,
настройки — и запись о версии программы (version.json).

Работает, пока poehali.dev доступен. Запускайте по расписанию (cron),
тогда в момент аварии на зеркале будут свежие данные.

    python sync_from_cloud.py           # синхронизация (только изменения)
    python sync_from_cloud.py --full    # принудительно всё целиком
    python sync_from_cloud.py --check   # только показать, что изменилось в облаке

Как работает (экономный режим): ОДИН вызов админ-функции export_sync.
Зеркало отправляет отпечатки своих таблиц, облако возвращает только
изменившиеся таблицы (журнал событий — только новые строки), версию
программы и при необходимости ключ подписи. Отпечатки хранятся в
storage/sync_state.json. Если облако не ответило — база зеркала не трогается.

Старое облако без export_sync — скрипт сам переходит на постраничную
выгрузку (export_tables / export_table).
"""
import base64
import gzip
import json
import os
import sys
import urllib.error
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


STATE_FILE = os.path.join(STORAGE, "sync_state.json")


def load_state() -> dict:
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return {}


def save_state(st: dict) -> None:
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(st, f, ensure_ascii=False)


def mirror_max_ids(names) -> dict:
    """Последний id журнальных таблиц в базе зеркала (для догрузки новых строк)."""
    out = {}
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        cur = conn.cursor()
        for n in names:
            try:
                cur.execute(psql.SQL("SELECT COALESCE(MAX(id), 0) FROM {}").format(psql.Identifier(n)))
                out[n] = cur.fetchone()[0]
            except Exception:  # noqa: BLE001
                conn.rollback()
    finally:
        conn.close()
    return out


def fetch_sync(state: dict, full: bool) -> dict:
    """Один вызов export_sync. Возвращает распакованный ответ облака."""
    known = {} if full else state.get("hashes", {})
    since = {} if full else mirror_max_ids(["license_events"])
    want_key = not os.environ.get("OFFLINE_KEY_PRIVATE", "").strip()
    r = call(ADMIN_URL, {"action": "export_sync", "password": PASSWORD,
                         "known": known, "since": since, "full": full,
                         "want_signing_key": want_key})
    if "gzip_b64" not in r:
        raise RuntimeError(r.get("error") or "export_sync не поддерживается")
    return json.loads(gzip.decompress(base64.b64decode(r["gzip_b64"])).decode())


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


def load_into_mirror(data: dict, append: set = frozenset()) -> None:
    """data: {table: (cols, rows)}. Таблицы из append — только добавить строки,
    остальные — заменить целиком."""
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
        replace = [n for n in names if n not in append]
        if replace:
            # Родительские и дочерние таблицы облако присылает вместе,
            # поэтому очищаем их одной командой без CASCADE.
            cur.execute(psql.SQL("TRUNCATE {} RESTART IDENTITY").format(
                psql.SQL(", ").join(psql.Identifier(n) for n in replace)))
        ordered = [n for n in ORDER if n in names] + [n for n in names if n not in ORDER]
        for n in ordered:
            cols, rows = data[n]
            if not rows:
                continue
            q = psql.SQL("INSERT INTO {} ({}) VALUES ({})").format(
                psql.Identifier(n),
                psql.SQL(", ").join(psql.Identifier(c) for c in cols),
                psql.SQL(", ").join(psql.Placeholder() for _ in cols))
            if n in append and "id" in cols:
                q = psql.SQL("{} ON CONFLICT (id) DO NOTHING").format(q)
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


def write_signing_key(key: str) -> None:
    env = os.path.join(HERE, ".env")
    lines = open(env, encoding="utf-8").read().splitlines() if os.path.isfile(env) else []
    lines = [ln for ln in lines if not ln.startswith("OFFLINE_KEY_PRIVATE=")]
    lines.append(f"OFFLINE_KEY_PRIVATE={key}")
    with open(env, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    os.environ["OFFLINE_KEY_PRIVATE"] = key
    print("  ключ подписи OFFLINE_KEY_PRIVATE записан в .env")


def write_version(info: dict) -> None:
    p = os.path.join(STORAGE, "files", "updates", "version.json")
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(info, f, ensure_ascii=False)
    print("  версия программы:", info.get("version"))


def sync_signing_key() -> None:
    """Если в .env пуст OFFLINE_KEY_PRIVATE — забирает его из облака и вписывает."""
    if os.environ.get("OFFLINE_KEY_PRIVATE", "").strip():
        return
    try:
        key = call(ADMIN_URL, {"action": "export_signing_key",
                               "password": PASSWORD})["offline_key_private"]
    except Exception as ex:  # noqa: BLE001
        print("  ключ подписи не получен:", ex)
        return
    env = os.path.join(HERE, ".env")
    lines = open(env, encoding="utf-8").read().splitlines() if os.path.isfile(env) else []
    lines = [ln for ln in lines if not ln.startswith("OFFLINE_KEY_PRIVATE=")]
    lines.append(f"OFFLINE_KEY_PRIVATE={key}")
    with open(env, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    os.environ["OFFLINE_KEY_PRIVATE"] = key
    print("  ключ подписи OFFLINE_KEY_PRIVATE записан в .env")


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


def main_sync() -> int:
    """Экономный режим: один вызов облака. 3 — облако не знает export_sync."""
    full = "--full" in sys.argv
    state = load_state()
    if not state.get("hashes"):
        full = True  # первый запуск — забрать всё
    try:
        res = fetch_sync(state, full)
    except urllib.error.HTTPError as ex:
        if ex.code in (400, 404):
            return 3
        print("Облако недоступно, база зеркала НЕ изменена:", ex)
        return 2
    except RuntimeError as ex:
        print("  ", ex, "— перехожу на постраничную выгрузку")
        return 3
    except Exception as ex:  # noqa: BLE001
        print("Облако недоступно, база зеркала НЕ изменена:", ex)
        return 2

    tables = res.get("tables", {})
    if not tables:
        print("  изменений нет")
    for name, t in tables.items():
        print(f"  облако: {name:28s} {len(t['rows']):>6} строк ({'новые' if t['mode'] == 'append' else 'целиком'})")
    if "--check" in sys.argv:
        return 0

    if tables:
        data = {n: (t["columns"], t["rows"]) for n, t in tables.items()}
        append = {n for n, t in tables.items() if t["mode"] == "append"}
        load_into_mirror(data, append)
    if res.get("version"):
        write_version(res["version"])
    if res.get("offline_key_private"):
        write_signing_key(res["offline_key_private"])
    save_state({"hashes": res.get("hashes", {})})
    print("Готово.")
    return 0


def main() -> int:
    if not (ADMIN_URL and PASSWORD):
        print("Заполните CLOUD_ADMIN_URL и ADMIN_PASSWORD в .env")
        return 1
    print("Синхронизация с poehali.dev …")
    rc = main_sync()
    if rc != 3:
        return rc
    try:
        data = fetch_cloud()
    except Exception as ex:  # noqa: BLE001
        print("Облако недоступно, база зеркала НЕ изменена:", ex)
        return 2
    if "--check" in sys.argv:
        return 0
    load_into_mirror(data)
    sync_version()
    sync_signing_key()
    print("Готово.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
