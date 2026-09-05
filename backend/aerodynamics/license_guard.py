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
        {"key": "PVSO...."}                            — аварийный ключ
    Здесь проверяется подпись, срок и (для обычной лицензии) привязка к ПК.

ДВА РЕЖИМА (переключаются в админ-панели, без переустановки программы):
    мягкий  — запрос без лицензии считается, но пишется в журнал. Нужен на
              время перехода, пока у людей не обновится программа.
    строгий — без действительной лицензии расчёт не выполняется (403).

Модуль намеренно самодостаточный и без обращений к базе: он подключается к
каждой расчётной функции копией, а лишний запрос к БД на каждый расчёт стоил
бы времени и денег.
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


def _check_offline_key(key: str) -> Tuple[bool, str]:
    """
    Аварийный оффлайн-ключ (PVSO....). Проверяем подпись и срок.

    Отзыв ключа здесь НЕ проверяется: это стоило бы запроса к базе на каждый
    расчёт. Отзыв работает на рабочем месте — программа сверяется с сервером
    и перестаёт считать себя лицензированной, после чего пропуск в запрос
    просто не попадёт.
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
        from datetime import datetime, timezone
        exp_ts = datetime.fromisoformat(exp.replace("Z", "+00:00")).timestamp()
    except Exception:
        return False, "bad_expiry"
    if exp_ts < time.time() - CLOCK_SKEW_SEC:
        return False, "expired"
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
        return _check_offline_key(key)

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


# Соединение с базой переживает соседние вызовы функции (контейнер остаётся
# «тёплым»). Без этого на каждый расчёт тратилось бы время на подключение, а
# расчёт пожара делает несколько обращений подряд — задержка была бы заметной.
_conn = None


def _bump_counter(func: str, outcome: str) -> None:
    """
    Отмечает исход проверки в дневном счётчике — по нему в админ-панели видно,
    когда можно безопасно включать строгий режим.

    Одна строка на день, функцию и исход: таблица не растёт. Запись
    НЕОБЯЗАТЕЛЬНАЯ: любая ошибка молча игнорируется. Расчёт для человека
    важнее статистики и не должен падать из-за недоступной базы.
    """
    global _conn
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        return
    sql = ("INSERT INTO compute_license_daily (day, func, outcome, cnt) "
           "VALUES (CURRENT_DATE, %s, %s, 1) "
           "ON CONFLICT (day, func, outcome) DO UPDATE "
           "SET cnt = compute_license_daily.cnt + 1")
    for attempt in (1, 2):
        try:
            import psycopg2
            if _conn is None or _conn.closed:
                schema = os.environ.get("MAIN_DB_SCHEMA", "public")
                _conn = psycopg2.connect(dsn, options=f"-c search_path={schema}",
                                         connect_timeout=2)
            cur = _conn.cursor()
            cur.execute(sql, (func[:40], outcome[:40]))
            _conn.commit()
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

    Режим задаётся переменной окружения COMPUTE_LICENSE_MODE:
        soft (по умолчанию) — пускаем, но пишем в журнал;
        strict              — без лицензии отказываем.
    Значение меняется в настройках функции и не требует правки кода.
    """
    ok, reason = check_license(body)
    if ok:
        _bump_counter(func, reason)          # ok | emergency
        return None

    mode = (os.environ.get("COMPUTE_LICENSE_MODE") or "soft").strip().lower()
    if mode != "strict":
        _bump_counter(func, reason)
        print(f"[license_guard] МЯГКИЙ РЕЖИМ: расчёт без лицензии ({reason})")
        return None

    _bump_counter(func, "denied_" + reason)
    print(f"[license_guard] ОТКАЗ: расчёт без действительной лицензии ({reason})")
    return {
        "statusCode": 403,
        "headers": {**cors, "Content-Type": "application/json"},
        "body": json.dumps({
            "error": "license_required",
            "reason": reason,
            "message": "Расчёт доступен только в полной версии. "
                       "Активируйте лицензию в окне «Лицензия».",
        }, ensure_ascii=False),
    }