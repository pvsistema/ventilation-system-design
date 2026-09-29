"""
ПВС-Система — локальный Flask-сервер.
Раздаёт React-билд и обрабатывает все расчётные API-запросы локально.
Лицензия проверяется через облачный сервер (один раз при запуске).
"""
import gzip
import json
import os
import sys
import importlib.util

from flask import Flask, jsonify, request, send_from_directory

# Расчётные функции запускаются здесь, на компьютере пользователя: включаем
# в license_guard режим локального ядра (строгая проверка без базы, привязка
# пропуска к ЭТОМУ компьютеру, локальный список отозванных аварийных ключей).
os.environ["PVS_LOCAL_CORE"] = "1"

import calc_aerodynamics
import calc_explosion

def resource(path):
    """Путь к ресурсам внутри .exe (PyInstaller _MEIPASS) или рядом с файлом."""
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, path)


def get_core_version():
    """Версия ядра (server.exe). Читается из server_version.txt рядом с exe —
    этот же файл сборщик проставляет, а C# сравнивает при обновлении."""
    try:
        exe_dir = os.path.dirname(os.path.abspath(sys.executable))
        vfile = os.path.join(exe_dir, "server_version.txt")
        if os.path.exists(vfile):
            with open(vfile, "r", encoding="utf-8") as f:
                v = f.read().strip()
                if v:
                    return v
    except Exception:
        pass
    return "1.0.0"


# ─── Настоящий аппаратный идентификатор машины ───────────────────────────────
# В десктопе (в отличие от браузера) есть доступ к реальному «железу» ОС.
# Собираем стабильные системные идентификаторы, которые НЕ зависят от браузера
# и переустановки программы. Кэшируем — читается один раз.
_MACHINE_ID = None


def _win_machine_id():
    """Windows: MachineGuid из реестра — единственный стабильный якорь.

    ВАЖНО: раньше сюда добавлялся UUID материнской платы через WMIC. Это и было
    причиной «съедания» лишних рабочих мест: wmic отсутствует в Windows 11 24H2
    и новее (компонент удалён), а при загруженной системе не укладывался в
    таймаут. Когда wmic отрабатывал — ID был «guid||uuid||имя», когда нет —
    «guid||имя». Один и тот же ПК давал РАЗНЫЕ отпечатки, сервер не находил
    существующее место и создавал новое, пока лимит не исчерпывался и
    активация не падала с ошибкой «места кончились».
    Поэтому берём только MachineGuid — он стабилен и не требует внешних утилит.
    """
    parts = []
    try:
        import winreg
        key = winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE,
            r"SOFTWARE\Microsoft\Cryptography",
            0,
            winreg.KEY_READ | winreg.KEY_WOW64_64KEY,
        )
        guid, _ = winreg.QueryValueEx(key, "MachineGuid")
        winreg.CloseKey(key)
        if guid:
            parts.append(str(guid).strip())
    except Exception:
        pass
    return parts


def _unix_machine_id():
    """Linux/macOS: /etc/machine-id или IOPlatformUUID (mac)."""
    parts = []
    for p in ("/etc/machine-id", "/var/lib/dbus/machine-id"):
        try:
            if os.path.exists(p):
                with open(p, "r", encoding="utf-8") as f:
                    v = f.read().strip()
                    if v:
                        parts.append(v)
                        break
        except Exception:
            pass
    if not parts and sys.platform == "darwin":
        try:
            import subprocess
            out = subprocess.check_output(
                ["ioreg", "-rd1", "-c", "IOPlatformExpertDevice"],
                stderr=subprocess.DEVNULL, timeout=5,
            ).decode(errors="ignore")
            import re as _re
            m = _re.search(r'"IOPlatformUUID"\s*=\s*"([^"]+)"', out)
            if m:
                parts.append(m.group(1))
        except Exception:
            pass
    return parts


def get_machine_id():
    """Стабильный аппаратный ID машины (или '' если не удалось получить)."""
    global _MACHINE_ID
    if _MACHINE_ID is not None:
        return _MACHINE_ID
    try:
        import platform
        parts = _win_machine_id() if sys.platform.startswith("win") else _unix_machine_id()
        # Имя компьютера в отпечаток НЕ добавляем: его меняет системный
        # администратор (ввод в домен, переименование), и место «терялось» —
        # программа требовала активацию заново и занимала ещё одно место.
        # Имя компьютера по-прежнему передаётся отдельно, для отображения.
        if not parts:
            # Аппаратный ID недоступен — как запасной якорь используем имя ПК,
            # иначе отпечаток стал бы пустым и одинаковым у всех машин.
            parts = [f"node:{platform.node()}"]
        raw = "||".join([p for p in parts if p])
        _MACHINE_ID = raw
    except Exception:
        _MACHINE_ID = ""
    return _MACHINE_ID


def get_hostname():
    """Имя компьютера в сети (для отображения рабочего места)."""
    try:
        import platform
        return platform.node() or ""
    except Exception:
        return ""


# ─── Файловое хранилище лицензии (переживает чистку кэша WebView2) ───────────
def _license_store_path():
    """Путь к файлу лицензии в профиле пользователя (не в кэше браузера)."""
    if sys.platform.startswith("win"):
        base = os.environ.get("APPDATA") or os.path.expanduser("~")
        d = os.path.join(base, "PVS-System")
    elif sys.platform == "darwin":
        d = os.path.join(os.path.expanduser("~"), "Library", "Application Support", "PVS-System")
    else:
        d = os.path.join(os.path.expanduser("~"), ".config", "pvs-system")
    try:
        os.makedirs(d, exist_ok=True)
    except Exception:
        pass
    return os.path.join(d, "license_store.json")


def _load_store():
    try:
        p = _license_store_path()
        if os.path.exists(p):
            with open(p, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return {}


def _save_store(data: dict):
    try:
        with open(_license_store_path(), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        return True
    except Exception:
        return False


# ─── Динамическая загрузка backend-функций (airflow, rescue, hydraulics) ──
# Реальные функции лежат рядом в папке backend_functions/<name>/index.py и содержат
# handler(event, context) -> {statusCode, body}. Загружаем handler один раз и кэшируем.
_HANDLER_CACHE = {}


def _load_backend_handler(name: str):
    """Загружает handler(event, context) из backend_functions/<name>/index.py."""
    if name in _HANDLER_CACHE:
        return _HANDLER_CACHE[name]

    script_dir = os.path.dirname(os.path.abspath(__file__))
    meipass = getattr(sys, "_MEIPASS", None)
    # Ищем backend_functions рядом с server.py и во всех вероятных местах bundle.
    # ВАЖНО: в защищённой сборке исходники .py компилируются в .pyc и удаляются,
    # поэтому ищем оба варианта — сперва index.py, затем index.pyc.
    base_dirs = [os.path.join(script_dir, "backend_functions", name)]
    if meipass:
        base_dirs.append(os.path.join(meipass, "pvs-core", "backend_functions", name))
        base_dirs.append(os.path.join(meipass, "backend_functions", name))

    candidates = []
    for d in base_dirs:
        candidates.append(os.path.join(d, "index.py"))
        candidates.append(os.path.join(d, "index.pyc"))

    path = next((c for c in candidates if os.path.exists(c)), None)
    if not path:
        _HANDLER_CACHE[name] = None
        return None

    # Папка модуля должна быть в путях импорта: index.py делает
    # `from license_guard import license_gate`, а license_guard.py лежит РЯДОМ,
    # а не в общих библиотеках. При обычном запуске из исходников это работало
    # случайно (интерпретатор искал по текущей папке), но в собранном server.exe
    # модуль грузится по абсолютному пути — и соседний файл переставал
    # находиться. Расчёт падал с 500, а сборка — на дымовом тесте.
    mod_dir = os.path.dirname(path)
    if mod_dir not in sys.path:
        sys.path.insert(0, mod_dir)

    # Для .pyc нужен SourcelessFileLoader (иначе spec может не подобрать loader).
    if path.endswith(".pyc"):
        from importlib.machinery import SourcelessFileLoader
        loader = SourcelessFileLoader(f"bf_{name}", path)
        spec = importlib.util.spec_from_loader(f"bf_{name}", loader)
    else:
        spec = importlib.util.spec_from_file_location(f"bf_{name}", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    handler = getattr(mod, "handler", None)
    _HANDLER_CACHE[name] = handler
    return handler


def call_backend(name: str):
    """Вызывает backend-функцию как в облаке и возвращает Flask-ответ.

    Оборачивает тело запроса в event {httpMethod, body}, вызывает handler,
    распаковывает {statusCode, body} в «сырой» JSON — именно его ждёт фронт.
    """
    handler = _load_backend_handler(name)
    if handler is None:
        return cors_response({"error": f"{name} модуль не найден"}, 500)
    # Строгая проверка в самой функции — с отпечатком этого ПК и списком отзыва.
    _prepare_guard()

    event = {
        "httpMethod": request.method,
        "body": request.get_data(as_text=True) or "",
        "headers": dict(request.headers),
        "queryStringParameters": dict(request.args),
        "isBase64Encoded": False,
    }
    try:
        result = handler(event, None)
    except Exception as e:
        import traceback
        return cors_response({"error": str(e), "trace": traceback.format_exc()}, 500)

    status = result.get("statusCode", 200)
    raw_body = result.get("body", "")
    try:
        data = json.loads(raw_body) if isinstance(raw_body, str) else raw_body
    except Exception:
        data = {"raw": raw_body}
    return cors_response(data, status)


# ─── Проверка лицензии в локальном ядре ──────────────────────────────────────
# Раньше расчёты в настольной версии не проверяли лицензию вовсе: облачная
# проверка без базы уходила в мягкий режим, а взрыв и аэродинамика считались
# встроенными модулями в обход неё. Теперь каждый расчёт проходит тот же
# license_gate, что и в облаке, но в строгом режиме и с привязкой к железу.

def _sha256hex(text: str) -> str:
    import hashlib
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _machine_fingerprints():
    """(fingerprint, fp_hash, код места) — ровно так, как их считает программа
    (src/lib/license.ts: fingerprint = sha256("mid:"+machineId))."""
    mid = get_machine_id()
    if not mid:
        return "", "", ""
    fp = _sha256hex(f"mid:{mid}")
    return fp, _sha256hex(fp), fp[:8].upper()


# Отозванные аварийные ключи. Отдельный файл в профиле: переживает чистку
# данных WebView2, поэтому отзыв нельзя сбросить очисткой браузера и повторным
# вводом ключа без интернета. Пополняется, когда сервер при квартальной сверке
# (action=offline_check) отвечает «ключ не действует».
def _revoked_path():
    return os.path.join(os.path.dirname(_license_store_path()), "offline_revoked.json")


def _load_revoked() -> dict:
    try:
        p = _revoked_path()
        if os.path.exists(p):
            with open(p, "r", encoding="utf-8") as f:
                d = json.load(f)
                return {"kids": [int(k) for k in d.get("kids", []) if str(k).isdigit()],
                        "keys": [str(k) for k in d.get("keys", []) if k]}
    except Exception:
        pass
    return {"kids": [], "keys": []}


def _save_revoked(d: dict) -> None:
    try:
        with open(_revoked_path(), "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False)
    except Exception:
        pass


def _offline_key_kid(key_text: str):
    """Номер ключа из подписанного payload (без проверки подписи — только для учёта)."""
    try:
        import base64
        part = key_text.split(".")[1]
        part += "=" * (-len(part) % 4)
        payload = json.loads(base64.urlsafe_b64decode(part).decode("utf-8"))
        k = payload.get("kid")
        return int(k) if str(k).isdigit() else None
    except Exception:
        return None


def _note_offline_verdict(req_body: dict, resp_data: dict) -> None:
    """Запомнить ответ сервера об аварийном ключе (отзыв / восстановление)."""
    if not isinstance(resp_data, dict) or not resp_data.get("ok"):
        return
    kid = req_body.get("kid")
    kid = int(kid) if str(kid).isdigit() else None
    key_text = str(req_body.get("offline_key") or "").strip()
    if kid is None and key_text:
        kid = _offline_key_kid(key_text)
    d = _load_revoked()
    kids, keys = set(d["kids"]), set(d["keys"])
    if resp_data.get("valid") is False:
        if kid is not None:
            kids.add(kid)
        if key_text:
            keys.add(key_text)
    else:
        # Администратор вернул ключ — снимаем отметку.
        if kid is not None:
            kids.discard(kid)
        if key_text:
            keys.discard(key_text)
    _save_revoked({"kids": sorted(kids), "keys": sorted(keys)})


_GUARD = None


def _guard():
    """license_guard, общий для всех расчётных модулей ядра."""
    global _GUARD
    if _GUARD is not None:
        return _GUARD
    # Модуль лежит рядом с index.py каждой функции — берём первый найденный.
    for name in ("airflow", "explosion-calculator", "aerodynamics", "water-hydraulics", "rescue-calculator"):
        _load_backend_handler(name)
    try:
        import license_guard  # noqa: E402 — путь добавлен загрузчиком функций
        _GUARD = license_guard
    except Exception as e:
        print(f"[core] license_guard не найден: {e}")
        _GUARD = None
    return _GUARD


def _prepare_guard():
    """Передать в проверку отпечаток этого ПК и список отозванных ключей."""
    g = _guard()
    if g is None:
        return None
    _, fph, seat = _machine_fingerprints()
    rv = _load_revoked()
    g.set_local_context(machine_fph=fph, revoked_kids=rv["kids"], revoked_keys=rv["keys"])
    g.set_local_seat(seat)
    return g


def _gate(body, func: str):
    """None — считать можно; иначе Flask-ответ с отказом."""
    g = _prepare_guard()
    if g is None:
        # Модуль проверки не собран в ядро — это поломка сборки, а не повод
        # считать без лицензии.
        return cors_response({"error": "license_required", "reason": "guard_missing",
                              "message": "Модуль проверки лицензии не найден. Переустановите программу."}, 403)
    denied = g.license_gate(body, CORS_HEADERS, func)
    if denied is None:
        return None
    try:
        data = json.loads(denied.get("body") or "{}")
    except Exception:
        data = {"error": "license_required"}
    return cors_response(data, denied.get("statusCode", 403))


def _find_dist():
    meipass = getattr(sys, "_MEIPASS", None)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(meipass, "pvs-core", "dist") if meipass else None,
        os.path.join(meipass, "dist") if meipass else None,
        os.path.join(script_dir, "dist"),
    ]
    candidates = [c for c in candidates if c]

    log_path = os.path.join(os.path.expanduser("~"), "pvs_debug.txt")
    with open(log_path, "w", encoding="utf-8") as f:
        f.write(f"_MEIPASS={meipass}\n")
        f.write(f"script_dir={script_dir}\n")
        for c in candidates:
            exists = os.path.isdir(c)
            has_index = os.path.exists(os.path.join(c, "index.html")) if exists else False
            f.write(f"  [{exists}/{has_index}] {c}\n")
            if exists:
                try:
                    files = os.listdir(c)[:10]
                    f.write(f"    files: {files}\n")
                except Exception as e:
                    f.write(f"    listdir error: {e}\n")

    for c in candidates:
        if os.path.isdir(c) and os.path.exists(os.path.join(c, "index.html")):
            return c
    return candidates[-1]


DIST_FOLDER = _find_dist()

app = Flask(__name__, static_folder=DIST_FOLDER, static_url_path="")

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-User-Id, X-Auth-Token",
}


def cors_response(data: dict, status: int = 200):
    resp = jsonify(data)
    resp.status_code = status
    for k, v in CORS_HEADERS.items():
        resp.headers[k] = v
    return resp


def handle_options():
    from flask import Response
    r = Response("")
    r.status_code = 200
    for k, v in CORS_HEADERS.items():
        r.headers[k] = v
    return r


# ─── React SPA ────────────────────────────────────────────────────────────────

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_spa(path):
    full = os.path.join(DIST_FOLDER, path)
    if path and os.path.exists(full):
        return send_from_directory(DIST_FOLDER, path)
    return send_from_directory(DIST_FOLDER, "index.html")


# Минимальный размер ответа, который имеет смысл сжимать. Мелкие ответы
# (статус, machine-id) от сжатия только проигрывают: расход процессора есть,
# выигрыша в объёме нет.
_GZIP_MIN_BYTES = 1024

# Что сжимаем. Картинки (png/jpg/webp) и шрифты уже сжаты — повторное сжатие
# бесполезно и лишь тратит время.
_GZIP_TYPES = (
    "application/json",
    "application/javascript",
    "text/javascript",
    "text/css",
    "text/html",
    "image/svg+xml",
    "text/plain",
)


@app.after_request
def _cache_and_compress(resp):
    """Кэширование статики и сжатие ответов.

    БЫЛО: на ВСЕ ответы вешался no-store и не было сжатия.
    Из-за этого десктоп проигрывал браузерной версии:
      • результат расчёта большой схемы (сотни килобайт JSON) передавался
        без сжатия — в облаке его сжимает сервер;
      • интерфейс при каждом запуске полностью перечитывался с диска,
        хотя файлы не менялись.

    СТАЛО: файлы с хешем в имени (assets/*.js, *.css — их имя меняется при
    каждой пересборке) кэшируются надолго, а index.html по-прежнему никогда
    не кэшируется. Поэтому после обновления программы WebView2 гарантированно
    берёт новый index.html, а тот уже ссылается на новые имена файлов —
    показать старый интерфейс невозможно.
    """
    path = request.path or ""
    is_asset = path.startswith("/assets/") and not path.endswith(".map")

    if is_asset:
        # Имя содержит хеш содержимого — файл неизменяем.
        resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        resp.headers.pop("Pragma", None)
        resp.headers.pop("Expires", None)
    else:
        # index.html и API — всегда свежие.
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"

    # ── Сжатие ────────────────────────────────────────────────────────────
    # Только если клиент его понимает и ответ ещё не сжат.
    if "gzip" not in (request.headers.get("Accept-Encoding") or ""):
        return resp
    if resp.headers.get("Content-Encoding"):
        return resp
    # direct_passthrough — ответ отдаётся потоком (send_from_directory).
    # Обычно тело трогать нельзя, но для файлов интерфейса это делается
    # осознанно: они сжимаются один раз (дальше работает кэш), зато первый
    # запуск после обновления заметно быстрее. Размер таких файлов измеряется
    # мегабайтами — читать их в память безопасно.
    if resp.direct_passthrough:
        if not is_asset:
            return resp
        try:
            resp.direct_passthrough = False
        except Exception:
            return resp
    if resp.status_code < 200 or resp.status_code >= 300:
        return resp

    ctype = (resp.headers.get("Content-Type") or "").split(";")[0].strip()
    if ctype not in _GZIP_TYPES:
        return resp

    try:
        data = resp.get_data()
    except Exception:
        return resp
    if len(data) < _GZIP_MIN_BYTES:
        return resp

    try:
        # Уровень 5 — компромисс: сжимает почти как максимальный, но заметно
        # быстрее. На локальной машине важнее время сжатия, чем лишние байты.
        packed = gzip.compress(data, 5)
    except Exception:
        return resp
    # Если сжатие не дало выигрыша — отдаём как есть.
    if len(packed) >= len(data):
        return resp

    resp.set_data(packed)
    resp.headers["Content-Encoding"] = "gzip"
    resp.headers["Content-Length"] = str(len(packed))
    resp.headers.add("Vary", "Accept-Encoding")
    return resp


# ─── Аэродинамика ─────────────────────────────────────────────────────────────

@app.route("/api/aerodynamics", methods=["GET", "POST", "OPTIONS"])
def api_aerodynamics():
    if request.method == "OPTIONS":
        return handle_options()
    body = request.get_json(force=True, silent=True) or {}
    denied = _gate(body, "aerodynamics")
    if denied is not None:
        return denied
    result = calc_aerodynamics.run(body)
    return cors_response(result)


# ─── Воздухораспределение ─────────────────────────────────────────────────────

@app.route("/api/airflow", methods=["GET", "POST", "OPTIONS"])
def api_airflow():
    if request.method == "OPTIONS":
        return handle_options()
    return call_backend("airflow")


# ─── Горноспасатели ───────────────────────────────────────────────────────────

@app.route("/api/rescue-calculator", methods=["GET", "POST", "OPTIONS"])
def api_rescue():
    if request.method == "OPTIONS":
        return handle_options()
    return call_backend("rescue-calculator")


# ─── Взрывы ───────────────────────────────────────────────────────────────────

@app.route("/api/explosion-calculator", methods=["GET", "POST", "OPTIONS"])
def api_explosion():
    if request.method == "OPTIONS":
        return handle_options()
    body = request.get_json(force=True, silent=True) or {}
    denied = _gate(body, "explosion")
    if denied is not None:
        return denied
    result = calc_explosion.run(body)
    return cors_response(result)


# ─── Гидравлика ППЗ ───────────────────────────────────────────────────────────

@app.route("/api/water-hydraulics", methods=["GET", "POST", "OPTIONS"])
def api_water():
    if request.method == "OPTIONS":
        return handle_options()
    return call_backend("water-hydraulics")


# ─── Лицензия (проксируем в облако) ──────────────────────────────────────────

@app.route("/api/license", methods=["GET", "POST", "OPTIONS"])
def api_license():
    if request.method == "OPTIONS":
        return handle_options()
    import urllib.request
    import urllib.error
    CLOUD_LICENSE_URL = "https://functions.poehali.dev/a1965362-df5e-40d6-ab62-0b523b49b023"
    body_bytes = request.get_data()
    req = urllib.request.Request(
        CLOUD_LICENSE_URL,
        data=body_bytes,
        method=request.method,
        headers={"Content-Type": "application/json"},
    )
    try:
        # 30 с вместо 10: в корпоративных сетях с прокси и SSL-инспекцией первый
        # запрос к облаку нередко идёт дольше 10 секунд, и активация срывалась
        # по таймауту, хотя ключ верный и интернет есть.
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
            # Ответ квартальной сверки аварийного ключа запоминаем в ядре:
            # отзыв должен действовать и без интернета, и после чистки WebView2.
            try:
                req_body = json.loads(body_bytes.decode("utf-8") or "{}")
                if req_body.get("action") == "offline_check":
                    _note_offline_verdict(req_body, data)
            except Exception:
                pass
            return cors_response(data)
    except urllib.error.HTTPError as e:
        # Облако вернуло ошибку (например неверный ключ) — пробрасываем
        # реальный статус и тело, чтобы интерфейс показал понятную причину.
        try:
            data = json.loads(e.read().decode())
        except Exception:
            data = {"error": "activation_failed"}
        return cors_response(data, e.code)
    except Exception as e:
        return cors_response({"error": str(e), "offline": True}, 503)


# ─── Сохранение файла (заглушка — диалог обрабатывает C#-обёртка) ────────────

@app.route("/api/save-file", methods=["POST", "OPTIONS"])
def api_save_file():
    if request.method == "OPTIONS":
        return handle_options()
    return cors_response({"ok": False, "error": "use window.chrome.webview in C# wrapper"}, 501)


# ─── Настоящий аппаратный ID машины (только десктоп) ─────────────────────────

@app.route("/api/machine", methods=["GET", "OPTIONS"])
def api_machine():
    if request.method == "OPTIONS":
        return handle_options()
    return cors_response({
        "machineId": get_machine_id(),
        "hostname": get_hostname(),
    })


# ─── Файловое хранилище лицензии (переживает чистку кэша WebView2) ───────────

@app.route("/api/license-store", methods=["GET", "POST", "DELETE", "OPTIONS"])
def api_license_store():
    if request.method == "OPTIONS":
        return handle_options()
    if request.method == "GET":
        return cors_response({"store": _load_store()})
    if request.method == "DELETE":
        _save_store({})
        return cors_response({"ok": True})
    # POST — сохранить { key, value }
    body = request.get_json(force=True, silent=True) or {}
    key = str(body.get("key", "")).strip()
    if not key:
        return cors_response({"ok": False, "error": "key_required"}, 400)
    store = _load_store()
    if body.get("remove"):
        store.pop(key, None)
    else:
        store[key] = body.get("value")
    ok = _save_store(store)
    return cors_response({"ok": ok})


# ─── Отозванные аварийные ключи (для окна лицензии) ─────────────────────────

@app.route("/api/offline-revoked", methods=["GET", "OPTIONS"])
def api_offline_revoked():
    if request.method == "OPTIONS":
        return handle_options()
    return cors_response(_load_revoked())


# ─── Статус сервера ───────────────────────────────────────────────────────────

@app.route("/api/status")
def api_status():
    return cors_response({"status": "ok", "version": get_core_version(), "mode": "desktop"})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5173, threaded=True, debug=False)