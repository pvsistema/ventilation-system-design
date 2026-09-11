"""
Проверка лицензии на расчётном сервере.

ЗАЧЕМ. Раньше вся защита жила в интерфейсе программы: кнопки в демо-режиме
не нажимались, но сами расчётные серверы считали для любого, кто их попросит.
Достаточно было поправить одну строку в файлах программы — и полный
функционал открывался без ключа. Ключи, подписи и привязка к ПК охраняли
дверь, рядом с которой было открыто окно.

Теперь расчёт выполняется ТОЛЬКО по действительной лицензии. Пропуском служит
тот же подписанный документ, который лицензионный сервис выдаёт рабочему месту
(поле signed). Подделать его нельзя: подпись Ed25519 ставится приватным
ключом, который есть только на сервере.

КАК ЭТО РАБОТАЕТ
    Программа кладёт в каждый расчётный запрос поле _lic:
        {"payload": <b64url>, "sig": <b64url>}        — обычная лицензия
        {"key": "PVSO....", "fp": "<отпечаток>"}      — аварийный ключ
    Здесь проверяется подпись, срок и привязка к ПК.

ДВА РЕЖИМА (переключаются кнопкой в админ-панели, без правки настроек функций):
    мягкий  — запрос без лицензии считается, но пишется в журнал. Нужен на
              время перехода, пока у людей не обновится программа.
    строгий — без действительной лицензии считается только задача демо-размера
              (как в интерфейсе), всё остальное — отказ 403.

ЧТО ИЗМЕНИЛОСЬ ПОСЛЕ РАЗБОРА СЛАБЫХ МЕСТ
    • Режим хранится в базе (app_settings.compute_license_mode), а не в
      переменной окружения каждой из пяти функций: переключение и откат —
      одно действие, без передеплоя.
    • Отзыв аварийного ключа теперь проверяется ЗДЕСЬ. Раньше отозванный
      PVSO-ключ, подставленный в запрос напрямую, проходил до самого срока:
      отзыв срабатывал только внутри программы, а её можно переписать.
    • Привязка аварийного ключа к компьютеру (поле fp внутри ключа) тоже
      проверяется здесь, а не только в программе.
    • Демо-размер задачи ограничен сервером: обойти лимит узлов правкой
      интерфейса больше нельзя.

Обращение к базе не делает расчёт дороже: соединение переиспользуется между
вызовами, а режим и список отозванных ключей держатся в памяти 5 минут.
"""
import base64
import json
import os
import time
from typing import Any, Optional, Tuple

# Публичный ключ Ed25519 — тот же, которым программа проверяет лицензию.
# Здесь он нужен для обратной проверки: что документ выдан именно нами.
# Публичный ключ не секрет, его безопасно держать в коде.
PUBLIC_KEY_B64 = "MsyBGg0UlSyEns_shvQD_Ob82SJ-9Klds-naVhQl9hc"

# Допуск на расхождение часов клиента и сервера.
CLOCK_SKEW_SEC = 24 * 3600

# Сколько живёт пропуск с момента выдачи. Лицензия обновляется программой
# регулярно, поэтому давний документ — признак того, что его сохранили и
# переиспользуют. Срок с запасом, чтобы не мешать работе без интернета.
MAX_TICKET_AGE_SEC = 30 * 24 * 3600

# Насколько долго держим в памяти режим проверки и список отозванных ключей.
# Пять минут — разумный размен: переключение режима в панели доходит до всех
# расчётных серверов за минуты, а базу мы при этом почти не трогаем.
SETTINGS_TTL_SEC = 300

# Значения по умолчанию, если база недоступна. Намеренно мягкие: недоступность
# базы не должна останавливать работу людей на руднике.
DEFAULT_MODE = "soft"
DEFAULT_DEMO_NODES = 20
DEFAULT_DEMO_BRANCHES = 30


def _b64url_decode(s: str) -> bytes:
    s = s.replace("-", "+").replace("_", "/")
    pad = "=" * (-len(s) % 4)
    return base64.b64decode(s + pad)


def _verify_sig(payload_b64: str, sig_b64: str) -> Optional[dict]:
    """Проверяет подпись Ed25519 и возвращает содержимое документа."""
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        pub = Ed25519PublicKey.from_public_bytes(_b64url_decode(PUBLIC_KEY_B64))
        payload_bytes = _b64url_decode(payload_b64)
        pub.verify(_b64url_decode(sig_b64), payload_bytes)
        return json.loads(payload_bytes.decode("utf-8"))
    except Exception:
        return None


# ── Соединение с базой и кэш настроек ────────────────────────────────────────
# Соединение переживает соседние вызовы функции (контейнер остаётся «тёплым»).
# Без этого на каждый расчёт тратилось бы время на подключение, а расчёт пожара
# делает несколько обращений подряд — задержка была бы заметной.
_conn = None

# Кэш режима и демо-пределов: (значение, когда истекает).
_settings_cache: Optional[dict] = None
_settings_expire = 0.0

# Кэш отозванных аварийных ключей: {kid: True} и их привязок {kid: bound_fp}.
_revoked_cache: Optional[set] = None
_bound_cache: Optional[dict] = None
# Закреплённые рабочие места по каждому ключу: {kid: {отпечатки}}.
_seats_cache: Optional[dict] = None
_keys_expire = 0.0


def _get_conn():
    """Соединение с базой; None — если база недоступна или не настроена."""
    global _conn
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        return None
    try:
        import psycopg2
        if _conn is None or _conn.closed:
            schema = os.environ.get("MAIN_DB_SCHEMA", "public")
            _conn = psycopg2.connect(dsn, options=f"-c search_path={schema}",
                                     connect_timeout=2)
        return _conn
    except Exception as e:
        print(f"[license_guard] нет соединения с базой: {e}")
        try:
            if _conn is not None:
                _conn.close()
        except Exception:
            pass
        _conn = None
        return None


def _load_settings() -> dict:
    """
    Режим проверки и демо-пределы из базы (с кэшем).

    База недоступна — возвращаем мягкий режим. Это осознанный выбор: сбой
    базы не должен оставлять людей без расчёта. Защита при этом не теряется
    полностью, случаи всё равно попадают в счётчик.
    """
    global _settings_cache, _settings_expire
    now = time.time()
    if _settings_cache is not None and now < _settings_expire:
        return _settings_cache

    result = {
        "mode": DEFAULT_MODE,
        "demo_nodes": DEFAULT_DEMO_NODES,
        "demo_branches": DEFAULT_DEMO_BRANCHES,
    }
    conn = _get_conn()
    if conn is not None:
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT key, value FROM app_settings WHERE key IN "
                "('compute_license_mode','compute_demo_max_nodes',"
                "'compute_demo_max_branches')"
            )
            cfg = {r[0]: r[1] for r in cur.fetchall()}
            conn.commit()
            mode = (cfg.get("compute_license_mode") or DEFAULT_MODE).strip().lower()
            result["mode"] = "strict" if mode == "strict" else "soft"
            try:
                result["demo_nodes"] = int(cfg.get("compute_demo_max_nodes")
                                           or DEFAULT_DEMO_NODES)
            except (TypeError, ValueError):
                pass
            try:
                result["demo_branches"] = int(cfg.get("compute_demo_max_branches")
                                              or DEFAULT_DEMO_BRANCHES)
            except (TypeError, ValueError):
                pass
        except Exception as e:
            print(f"[license_guard] настройки не прочитаны: {e}")
            try:
                conn.rollback()
            except Exception:
                pass

    # Переменная окружения остаётся аварийным рычагом: если она задана явно,
    # её значение важнее базы. Нужна на случай, когда база недоступна, а
    # строгий режим требуется удержать.
    env_mode = (os.environ.get("COMPUTE_LICENSE_MODE") or "").strip().lower()
    if env_mode in ("soft", "strict"):
        result["mode"] = env_mode

    _settings_cache = result
    _settings_expire = now + SETTINGS_TTL_SEC
    return result


def _load_offline_keys() -> Tuple[set, dict, dict]:
    """
    Отозванные аварийные ключи, привязки к компьютерам и реестр закреплённых
    рабочих мест (с кэшем).

    Возвращает (множество отозванных kid, {kid: bound_fp}, {kid: {отпечатки}}).

    ЗАЧЕМ ЗДЕСЬ. Раньше отзыв аварийного ключа работал только внутри программы:
    она сверялась с сервером и переставала прикладывать пропуск. Но программу
    можно переписать, а подписанный ключ подставить в запрос напрямую — и
    отозванный ключ считал бы до самого срока. Теперь отзыв проверяет сервер.

    Реестр мест нужен для ключей на НЕСКОЛЬКО компьютеров: в bound_fp попадает
    только один отпечаток, а закрепиться могут несколько. Без реестра у ключа
    на три места считал бы лишь один ПК.
    """
    global _revoked_cache, _bound_cache, _seats_cache, _keys_expire
    now = time.time()
    if _revoked_cache is not None and now < _keys_expire:
        return _revoked_cache, (_bound_cache or {}), (_seats_cache or {})

    revoked: set = set()
    bound: dict = {}
    seats: dict = {}
    conn = _get_conn()
    if conn is not None:
        try:
            cur = conn.cursor()
            # Отозванными считаем и выключенные, и просроченные ключи.
            cur.execute("SELECT id, is_active, bound_fp, expires_at FROM offline_keys")
            from datetime import datetime, timezone
            now_dt = datetime.now(timezone.utc)
            for kid, is_active, bfp, exp in cur.fetchall():
                if not is_active or (exp and exp < now_dt):
                    revoked.add(int(kid))
                if bfp:
                    bound[int(kid)] = str(bfp).strip().upper()
            # Закреплённые рабочие места. Заблокированные администратором ПК
            # в реестр не берём — для них ключ должен перестать работать.
            cur.execute("""
                SELECT offline_key_id, fingerprint FROM offline_key_seats
                WHERE is_blocked = FALSE
            """)
            for kid, fp in cur.fetchall():
                seats.setdefault(int(kid), set()).add(str(fp).strip().upper())
            conn.commit()
        except Exception as e:
            print(f"[license_guard] реестр ключей не прочитан: {e}")
            try:
                conn.rollback()
            except Exception:
                pass
            # Не кэшируем неудачу надолго — попробуем снова через минуту.
            _revoked_cache, _bound_cache, _seats_cache = revoked, bound, seats
            _keys_expire = now + 60
            return revoked, bound, seats

    _revoked_cache, _bound_cache, _seats_cache = revoked, bound, seats
    _keys_expire = now + SETTINGS_TTL_SEC
    return revoked, bound, seats


def _check_offline_key(key: str, client_fp: str, client_fph: str = "") -> Tuple[bool, str]:
    """
    Аварийный оффлайн-ключ (PVSO....). Проверяем подпись, срок, отзыв и
    привязку к компьютеру.

    client_fp  — код рабочего места (первые знаки отпечатка), тот самый, что
                 человек видит в окне «Лицензия».
    client_fph — хэш отпечатка (sha256), каким его знает сервер. Именно он
                 хранится в реестре рабочих мест.

    ПОЧЕМУ ДВА ЗНАЧЕНИЯ. Привязку можно задать двумя путями: администратор
    вводит код места вручную (тогда сверяем с client_fp) либо привязка берётся
    из реестра уже отметившегося компьютера (тогда сверяем с client_fph —
    восстановить код из хэша невозможно, это односторонняя функция).

    Если ключ выпущен с привязкой, расчёт пройдёт только с того компьютера:
    скопированный на соседнюю машину ключ отсекается здесь, а не только в
    интерфейсе программы.
    """
    if not key.startswith("PVSO."):
        return False, "bad_format"
    parts = key.split(".")
    if len(parts) != 3:
        return False, "bad_format"
    payload = _verify_sig(parts[1], parts[2])
    if payload is None:
        return False, "bad_signature"
    exp = payload.get("exp") or ""
    if not exp:
        return False, "no_expiry"
    try:
        from datetime import datetime
        exp_ts = datetime.fromisoformat(exp.replace("Z", "+00:00")).timestamp()
    except Exception:
        return False, "bad_expiry"
    if exp_ts < time.time() - CLOCK_SKEW_SEC:
        return False, "expired"

    # Отзыв и привязка — по реестру на сервере.
    kid = payload.get("kid")
    revoked, bound, seats = _load_offline_keys()
    key_seats: set = set()
    if isinstance(kid, int) or (isinstance(kid, str) and str(kid).isdigit()):
        kid_i = int(kid)
        if kid_i in revoked:
            return False, "revoked"
        # Привязка: приоритет у реестра (её можно задать после выпуска),
        # запасной вариант — поле внутри самой подписи.
        want_fp = bound.get(kid_i) or (str(payload.get("fp") or "").strip().upper())
        key_seats = seats.get(kid_i) or set()
    else:
        # Ключ без номера — выпущен до появления реестра. Отозвать его нельзя,
        # но привязку внутри подписи проверяем.
        want_fp = str(payload.get("fp") or "").strip().upper()

    # Компьютер уже закреплён за ключом в реестре мест — пропускаем сразу.
    #
    # Это ветка для ключей на НЕСКОЛЬКО мест: в bound_fp попадает лишь один
    # отпечаток, а закрепиться может несколько ПК. Без неё у ключа на три места
    # считал бы только один компьютер. Заблокированные места в реестр не
    # попадают (см. _load_offline_keys), поэтому отключённый ПК сюда не пройдёт.
    if key_seats and (client_fph or "").strip().upper() in key_seats:
        return True, "emergency"

    if want_fp:
        # Привязка может быть задана двумя видами значения, и оба законны:
        #   • код рабочего места (8 знаков) — администратор ввёл его вручную;
        #   • хэш отпечатка (64 знака) — взят из реестра отметившегося ПК.
        # Поэтому сверяем с тем, что прислала программа: код с кодом, хэш с
        # хэшем. Иначе привязка «из реестра» не совпала бы никогда.
        mine_fp = (client_fp or "").strip().upper()
        mine_fph = (client_fph or "").strip().upper()
        if not mine_fp and not mine_fph:
            return False, "fp_required"

        if len(want_fp) >= 32:
            # Привязка хэшем: сверяем с хэшем отпечатка этого ПК.
            if not mine_fph or not (mine_fph.startswith(want_fp) or want_fp.startswith(mine_fph)):
                return False, "wrong_computer"
        else:
            # Привязка коротким кодом: сравниваем по началу — программа может
            # прислать как короткий код, так и полный отпечаток.
            if not mine_fp or not (mine_fp.startswith(want_fp) or want_fp.startswith(mine_fp)):
                return False, "wrong_computer"

    return True, "emergency"


def check_license(body: Any) -> Tuple[bool, str]:
    """
    Проверяет пропуск в теле запроса.

    Возвращает (можно_считать, причина). Причина попадает в журнал и в ответ
    при отказе — по ней видно, что именно не так.
    """
    if not isinstance(body, dict):
        return False, "no_license"
    lic = body.get("_lic")
    if not isinstance(lic, dict):
        return False, "no_license"

    # Аварийный оффлайн-ключ
    key = lic.get("key")
    if isinstance(key, str) and key.startswith("PVSO."):
        return _check_offline_key(key, str(lic.get("fp") or ""),
                                  str(lic.get("fph") or ""))

    # Обычная лицензия: подписанный сервером документ
    payload_b64 = lic.get("payload")
    sig_b64 = lic.get("sig")
    if not isinstance(payload_b64, str) or not isinstance(sig_b64, str):
        return False, "no_license"

    payload = _verify_sig(payload_b64, sig_b64)
    if payload is None:
        return False, "bad_signature"
    if not payload.get("licensed"):
        return False, "not_licensed"

    # Документ обязан быть привязан к рабочему месту, иначе он расходился бы
    # по рукам как обычный файл.
    if not payload.get("fp"):
        return False, "no_fingerprint"

    now = time.time()
    exp = payload.get("exp")
    if exp:
        try:
            from datetime import datetime
            exp_ts = datetime.fromisoformat(str(exp).replace("Z", "+00:00")).timestamp()
            if exp_ts < now - CLOCK_SKEW_SEC:
                return False, "expired"
        except Exception:
            pass

    iat = payload.get("iat")
    if isinstance(iat, (int, float)):
        if iat > now + CLOCK_SKEW_SEC:
            return False, "issued_in_future"
        if iat < now - MAX_TICKET_AGE_SEC:
            return False, "ticket_too_old"

    return True, "ok"


def _task_size(body: Any) -> Tuple[int, int]:
    """Размер задачи: сколько узлов и ветвей пришло на расчёт."""
    if not isinstance(body, dict):
        return 0, 0
    nodes = body.get("nodes")
    branches = body.get("branches")
    n = len(nodes) if isinstance(nodes, list) else 0
    b = len(branches) if isinstance(branches, list) else 0
    return n, b


# Расчёты, которые в демо-режиме недоступны ВООБЩЕ (так же, как в интерфейсе:
# см. isDemo в Cad.tsx — аварийные расчёты закрыты). Схему они на сервер не
# присылают, поэтому по размеру задачи их не отличить: без этого списка
# «пустой» запрос на взрыв считался бы демо-задачей и проходил бы всегда.
DEMO_FORBIDDEN_FUNCS = {"explosion", "rescue"}


def _fits_demo(body: Any, settings: dict, func: str) -> bool:
    """
    Укладывается ли задача в демо-размер.

    Демо на сайте должно продолжать работать и в строгом режиме — иначе
    пропадает витрина. Но считать без лицензии можно только маленькую схему,
    ровно как показывает интерфейс. Раньше этот предел жил только в программе
    и снимался правкой одной строки.

    Аварийные расчёты (взрыв, маршруты ВГСЧ) в демо закрыты полностью — так же,
    как кнопки в интерфейсе.
    """
    if func in DEMO_FORBIDDEN_FUNCS:
        return False
    n, b = _task_size(body)
    # Запрос вообще без схемы — не демо-задача, а обращение напрямую в обход
    # программы. Пропускать такое нельзя: нулевой размер укладывался бы в
    # любой предел.
    if n == 0 and b == 0:
        return False
    return n <= settings["demo_nodes"] and b <= settings["demo_branches"]


def _bump_counter(func: str, outcome: str) -> None:
    """
    Отмечает исход проверки в дневном счётчике — по нему в админ-панели видно,
    когда можно безопасно включать строгий режим.

    Одна строка на день, функцию и исход: таблица не растёт. Запись
    НЕОБЯЗАТЕЛЬНАЯ: любая ошибка молча игнорируется. Расчёт для человека
    важнее статистики и не должен падать из-за недоступной базы.
    """
    sql = ("INSERT INTO compute_license_daily (day, func, outcome, cnt) "
           "VALUES (CURRENT_DATE, %s, %s, 1) "
           "ON CONFLICT (day, func, outcome) DO UPDATE "
           "SET cnt = compute_license_daily.cnt + 1")
    global _conn
    for attempt in (1, 2):
        conn = _get_conn()
        if conn is None:
            return
        try:
            cur = conn.cursor()
            cur.execute(sql, (func[:40], outcome[:40]))
            conn.commit()
            return
        except Exception as e:
            # Сохранённое соединение могло «протухнуть» — пробуем один раз заново.
            try:
                if _conn is not None:
                    _conn.close()
            except Exception:
                pass
            _conn = None
            if attempt == 2:
                print(f"[license_guard] счётчик не записан: {e}")


def license_gate(body: Any, cors: dict, func: str = "compute") -> Optional[dict]:
    """
    Главная проверка перед расчётом.

    Возвращает None — можно считать.
    Возвращает готовый ответ 403 — считать нельзя.

    Режим задаётся в админ-панели («Защита расчётов») и хранится в базе:
        soft   — пускаем всех, но ведём учёт;
        strict — без лицензии считается только задача демо-размера.
    Переменная COMPUTE_LICENSE_MODE, если задана, перекрывает базу — это
    аварийный рычаг на случай недоступности базы.
    """
    ok, reason = check_license(body)
    if ok:
        _bump_counter(func, reason)          # ok | emergency
        return None

    settings = _load_settings()
    if settings["mode"] != "strict":
        _bump_counter(func, reason)
        print(f"[license_guard] МЯГКИЙ РЕЖИМ: расчёт без лицензии ({reason})")
        return None

    # Строгий режим. Демо-задачу пропускаем — витрина на сайте должна жить.
    if _fits_demo(body, settings, func):
        _bump_counter(func, "demo")
        return None

    n, b = _task_size(body)
    _bump_counter(func, "denied_" + reason)
    print(f"[license_guard] ОТКАЗ: расчёт без действительной лицензии "
          f"({reason}); узлов={n} ветвей={b}")
    return {
        "statusCode": 403,
        "headers": {**cors, "Content-Type": "application/json"},
        "body": json.dumps({
            "error": "license_required",
            "reason": reason,
            "demo_limit": {
                "nodes": settings["demo_nodes"],
                "branches": settings["demo_branches"],
            },
            "message": "Расчёт доступен только в полной версии. "
                       f"Без лицензии считаются схемы до {settings['demo_nodes']} узлов. "
                       "Активируйте лицензию в окне «Лицензия».",
        }, ensure_ascii=False),
    }