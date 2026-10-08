"""
ПВ-Система — ПОЛНОЕ РЕЗЕРВНОЕ ЗЕРКАЛО (сайт + все функции + админ-панель).

Запускается на собственном сервере (VPS Beget или любой Linux) и работает
независимо от poehali.dev:

  • раздаёт собранный сайт (папка dist/) — программа, /admin, /client, /download;
  • выполняет ВСЕ backend-функции из папки backend/ без изменений кода:
      /api/license, /api/admin-licenses, /api/client-licenses,
      /api/compute-config, /api/app-version,
      /api/airflow, /api/aerodynamics, /api/rescue-calculator,
      /api/explosion-calculator, /api/water-hydraulics;
  • вместо облачной базы использует свой PostgreSQL (DATABASE_URL);
  • вместо облачного S3 — папку storage/ на диске (подмена boto3).

Настройки читаются из файла .env рядом с этим файлом (см. env.example).

Запуск:
    python server.py               # 127.0.0.1:8900 (за nginx)
    python server.py --port 9000 --host 0.0.0.0
"""
import argparse
import importlib.util
import io
import json
import os
import sys
import traceback
import types

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
BACKEND = os.path.join(ROOT, "backend")
DIST = os.environ.get("PVS_DIST") or os.path.join(ROOT, "dist")

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


# ─── .env ────────────────────────────────────────────────────────────────────
def load_env(path: str) -> None:
    if not os.path.isfile(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            v = v.strip().strip('"').strip("'")
            os.environ.setdefault(k.strip(), v)


load_env(os.path.join(HERE, ".env"))
os.environ.setdefault("MAIN_DB_SCHEMA", "public")
# Ключи S3 функциям нужны только формально — хранилище локальное.
os.environ.setdefault("AWS_ACCESS_KEY_ID", "mirror")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "mirror")

STORAGE = os.environ.get("PVS_STORAGE") or os.path.join(HERE, "storage")


# ─── Подмена boto3: S3 → папка storage/ ──────────────────────────────────────
class _NoSuchKey(Exception):
    pass


class _LocalS3:
    class exceptions:  # noqa: N801 — имитация boto3
        NoSuchKey = _NoSuchKey

    def _path(self, bucket: str, key: str) -> str:
        p = os.path.abspath(os.path.join(STORAGE, bucket, key))
        if not p.startswith(os.path.abspath(STORAGE)):
            raise ValueError("bad key")
        return p

    def get_object(self, Bucket, Key, **_):
        p = self._path(Bucket, Key)
        if not os.path.isfile(p):
            raise _NoSuchKey(Key)
        with open(p, "rb") as f:
            data = f.read()
        return {"Body": io.BytesIO(data), "ContentLength": len(data)}

    def put_object(self, Bucket, Key, Body=b"", **_):
        p = self._path(Bucket, Key)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        if isinstance(Body, str):
            Body = Body.encode()
        if hasattr(Body, "read"):
            Body = Body.read()
        with open(p, "wb") as f:
            f.write(Body)
        return {}


_fake_boto3 = types.ModuleType("boto3")
_fake_boto3.client = lambda *a, **k: _LocalS3()
sys.modules["boto3"] = _fake_boto3


# ─── Загрузка функций ────────────────────────────────────────────────────────
FUNCTIONS = [
    "license", "admin-licenses", "client-licenses", "compute-config", "app-version",
    "airflow", "aerodynamics", "rescue-calculator", "explosion-calculator",
    "water-hydraulics",
]
_HANDLERS = {}


def load_handler(name: str):
    if name in _HANDLERS:
        return _HANDLERS[name]
    fdir = os.path.join(BACKEND, name)
    path = os.path.join(fdir, "index.py")
    if not os.path.isfile(path):
        _HANDLERS[name] = None
        return None
    # Свои вспомогательные модули функции (license_guard, solver, vgsch…)
    # должны находиться первыми.
    if fdir in sys.path:
        sys.path.remove(fdir)
    sys.path.insert(0, fdir)
    for helper in ("solver", "vgsch", "fnp494"):
        if os.path.isfile(os.path.join(fdir, helper + ".py")):
            sys.modules.pop(helper, None)
    spec = importlib.util.spec_from_file_location("pvs_" + name.replace("-", "_"), path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    _HANDLERS[name] = getattr(mod, "handler", None)
    return _HANDLERS[name]


class CIDict(dict):
    """Заголовки без учёта регистра — как в облаке."""

    def __init__(self, src):
        super().__init__()
        self._low = {}
        for k, v in src.items():
            super().__setitem__(k, v)
            self._low[k.lower()] = v

    def get(self, key, default=None):
        if dict.__contains__(self, key):
            return dict.__getitem__(self, key)
        return self._low.get(str(key).lower(), default)

    def __getitem__(self, key):
        v = self.get(key, _MISSING)
        if v is _MISSING:
            raise KeyError(key)
        return v

    def __contains__(self, key):
        return dict.__contains__(self, key) or str(key).lower() in self._low


_MISSING = object()

from flask import Flask, Response, request, send_from_directory  # noqa: E402

app = Flask(__name__, static_folder=None)


def _client_ip() -> str:
    xff = request.headers.get("X-Forwarded-For", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.headers.get("X-Real-IP") or request.remote_addr or ""


@app.route("/api/<name>", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])
def api(name: str):
    if name not in FUNCTIONS:
        return Response(json.dumps({"error": "unknown_function"}), 404,
                        content_type="application/json")
    try:
        handler = load_handler(name)
    except BaseException as ex:  # noqa: BLE001
        traceback.print_exc()
        return Response(json.dumps({"error": f"load_failed: {ex}"}), 500,
                        content_type="application/json",
                        headers={"Access-Control-Allow-Origin": "*"})
    if handler is None:
        return Response(json.dumps({"error": "function_not_found"}), 404,
                        content_type="application/json")

    event = {
        "httpMethod": request.method,
        "body": request.get_data(as_text=True) or "",
        "headers": CIDict(dict(request.headers)),
        "queryStringParameters": dict(request.args),
        "isBase64Encoded": False,
        "requestContext": {"identity": {"sourceIp": _client_ip()}},
    }
    try:
        result = handler(event, None) or {}
    except BaseException as ex:  # noqa: BLE001
        print(f"[mirror] {name} failed: {ex}")
        traceback.print_exc()
        return Response(json.dumps({"error": str(ex)[:300]}), 500,
                        content_type="application/json",
                        headers={"Access-Control-Allow-Origin": "*"})

    status = int(result.get("statusCode", 200))
    headers = dict(result.get("headers") or {})
    body = result.get("body", "")
    if result.get("isBase64Encoded"):
        import base64
        body = base64.b64decode(body or "")
    elif not isinstance(body, (str, bytes)):
        body = json.dumps(body, ensure_ascii=False, default=str)
        headers.setdefault("Content-Type", "application/json")
    headers.setdefault("Access-Control-Allow-Origin", "*")
    return Response(body, status, headers=headers)


@app.route("/health")
def health():
    state = {}
    for n in FUNCTIONS:
        try:
            state[n] = load_handler(n) is not None
        except BaseException as ex:  # noqa: BLE001
            state[n] = f"error: {ex}"
    db = "not_configured"
    if os.environ.get("DATABASE_URL"):
        try:
            import psycopg2
            c = psycopg2.connect(os.environ["DATABASE_URL"], connect_timeout=3)
            cur = c.cursor()
            cur.execute("SELECT COUNT(*) FROM licenses")
            db = f"ok, licenses={cur.fetchone()[0]}"
            c.close()
        except Exception as ex:  # noqa: BLE001
            db = f"error: {ex}"
    ok = all(v is True for v in state.values()) and db.startswith("ok")
    return Response(json.dumps({
        "ok": ok, "role": "mirror", "service": "pvs-full",
        "site": os.path.isfile(os.path.join(DIST, "index.html")),
        "database": db, "functions": state,
    }, ensure_ascii=False), 200 if ok else 503, content_type="application/json",
        headers={"Access-Control-Allow-Origin": "*"})


# ─── Сайт (если nginx не настроен — раздаём сами) ────────────────────────────
@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def site(path: str):
    if not os.path.isfile(os.path.join(DIST, "index.html")):
        return Response("Сайт не собран: выполните mirror-server/build_site.sh", 503,
                        content_type="text/plain; charset=utf-8")
    full = os.path.join(DIST, path)
    if path and os.path.isfile(full):
        return send_from_directory(DIST, path)
    resp = send_from_directory(DIST, "index.html")
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return resp


def main():
    p = argparse.ArgumentParser(description="ПВ-Система — резервное зеркало")
    p.add_argument("--host", default=os.environ.get("PVS_HOST", "127.0.0.1"))
    p.add_argument("--port", type=int, default=int(os.environ.get("PVS_PORT", "8900")))
    a = p.parse_args()
    print(f"ПВ-Система зеркало: http://{a.host}:{a.port}/  (проверка: /health)")
    try:
        from waitress import serve
        serve(app, host=a.host, port=a.port, threads=16)
    except ImportError:
        app.run(host=a.host, port=a.port, threaded=True)


if __name__ == "__main__":
    main()
