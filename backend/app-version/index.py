"""
Проверка версии и управление обновлениями ПВС-Система.

Файлы обновлений (PVS-Setup.exe, server.exe) НЕ хранятся в нашем хранилище —
они лежат на Яндекс.Диске. Мы храним только публичную ссылку, а прямую ссылку
на скачивание выдаём свежую при каждом запросе (они у Яндекса временные).

GET  /                      → версия + контрольная сумма и подпись ядра
GET  /  ?file=exe           → редирект на свежую прямую ссылку установщика
GET  /  ?file=server        → редирект на свежую прямую ссылку расчётного ядра
POST /  action=set_url      → сохранить публичную ссылку Я.Диска + версию;
                              для ядра дополнительно считает SHA-256 файла и
                              подписывает её приватным ключом Ed25519 — программа
                              проверит целостность обновления перед установкой
POST /  action=set_version  → обновить только номер версии и заметки
"""
import json
import os
import re
import hashlib
import base64
import urllib.request
import urllib.parse
import boto3

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Password",
    "Access-Control-Max-Age": "86400",
}

VERSION_KEY = "updates/version.json"
BUCKET      = "files"


def get_s3():
    return boto3.client(
        "s3",
        endpoint_url="https://bucket.poehali.dev",
        aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
    )


def get_version_info(s3):
    default = {
        "version":         "1.0.0",
        "server_version":  "1.0.0",
        "notes":           "",
        "exe_public_url":  "",   # публичная ссылка Я.Диска на установщик
        "server_public_url": "", # публичная ссылка Я.Диска на расчётное ядро
        "server_sha256":   "",   # SHA-256 подлинного server.exe (проверка целостности)
        "server_sig":      "",   # подпись хэша ядра приватным ключом Ed25519
        "exe_sha256":      "",   # SHA-256 подлинного установщика PVS-Setup.exe
        "exe_sig":         "",   # подпись хэша установщика приватным ключом Ed25519
        # Минимальная БЕЗОПАСНАЯ версия. Всё, что ниже, содержит устранённую
        # уязвимость: такие сборки показывают блокирующее окно «обновитесь»
        # вместо обычного баннера, который можно закрыть.
        "min_secure_version": "",
        # Пояснение для пользователя, почему обновление обязательно.
        "security_notes":     "",
    }
    try:
        obj    = s3.get_object(Bucket=BUCKET, Key=VERSION_KEY)
        data   = obj["Body"].read().decode()
        parsed = json.loads(data)
        if isinstance(parsed, str):
            parsed = json.loads(parsed)
        return {**default, **parsed}
    except Exception:
        return default


def save_version_info(s3, info):
    s3.put_object(Bucket=BUCKET, Key=VERSION_KEY,
                  Body=json.dumps(info, ensure_ascii=False).encode(),
                  ContentType="application/json")


def resolve_download_url(src_url: str) -> str:
    """Публичную ссылку → прямую ссылку на скачивание файла.

    Поддерживает Яндекс.Диск через официальный API. Прямые ссылки временные,
    поэтому запрашиваем свежую при каждом обращении. Остальные ссылки — как есть.
    """
    if not src_url:
        return ""
    if "disk.yandex" in src_url or "yadi.sk" in src_url:
        api = ("https://cloud-api.yandex.net/v1/disk/public/resources/download"
               f"?public_key={urllib.parse.quote(src_url, safe='')}")
        req = urllib.request.Request(api, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read().decode())
        href = data.get("href")
        if not href:
            raise ValueError("Не удалось получить прямую ссылку с Яндекс.Диска")
        return href
    return src_url


def check_admin(event):
    password = (event.get("headers") or {}).get("X-Admin-Password", "")
    return password == os.environ.get("ADMIN_PASSWORD", "")


# ── Подпись файла обновления ─────────────────────────────────────────────────
def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _decode_priv_key(s: str) -> bytes:
    """Приватный ключ Ed25519 из секрета OFFLINE_KEY_PRIVATE (base64/hex)."""
    conv = s.replace("-", "+").replace("_", "/")
    b64chars = re.sub(r"[^A-Za-z0-9+/]", "", conv)
    std = b64chars.rstrip("=")
    pad = "=" * (-len(std) % 4)
    try:
        raw = base64.b64decode(std + pad)
        if len(raw) >= 32:
            return raw
    except Exception:
        pass
    raw = bytes.fromhex(re.sub(r"[^0-9a-fA-F]", "", s))
    if len(raw) >= 32:
        return raw
    raise ValueError("bad_private_key_format")


def sign_bytes(data: bytes) -> str:
    """
    Подписывает данные приватным ключом Ed25519 (тем же, что для лицензий).
    Возвращает подпись в base64url или "" если ключ не задан.
    """
    priv_b64 = os.environ.get("OFFLINE_KEY_PRIVATE", "")
    if not priv_b64.strip():
        return ""
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    raw = _decode_priv_key(priv_b64)
    if len(raw) > 32:
        raw = raw[:32]
    sk = Ed25519PrivateKey.from_private_bytes(raw)
    return _b64url(sk.sign(data))


def hash_and_sign_file(direct_url: str) -> tuple:
    """
    Скачивает файл по прямой ссылке, считает SHA-256 и подписывает хэш.

    ЗАЧЕМ. При обновлении расчётного ядра десктоп раньше проверял скачанный
    server.exe лишь на сигнатуру «MZ» — подменив ответ, можно было подсунуть
    любой exe. Теперь мы фиксируем контрольную сумму подлинного файла и
    подписываем её приватным ключом. Программа сверит сумму скачанного файла и
    проверит подпись публичным ключом — подделать нельзя.

    Возвращает (sha256_hex, sig_b64url). Хэш считается потоково, файл целиком
    в память не грузится.
    """
    req = urllib.request.Request(direct_url, headers={"User-Agent": "Mozilla/5.0"})
    h = hashlib.sha256()
    with urllib.request.urlopen(req, timeout=300) as r:
        while True:
            chunk = r.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    digest_hex = h.hexdigest()
    # Подписываем именно строку hex-хэша: её же проверяет клиент.
    sig = sign_bytes(digest_hex.encode())
    return digest_hex, sig


def handler(event: dict, context) -> dict:
    """Версия приложения и управление обновлениями ПВС-Система."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    method = event.get("httpMethod", "GET")
    s3     = get_s3()
    params = event.get("queryStringParameters") or {}

    # ── GET ?file=exe|server: редирект на скачивание с правильным именем ────────
    # Файл большой (80+ МБ) — проксировать через функцию нельзя (лимит размера
    # ответа). Отдаём 302-редирект на прямую ссылку, добавляя к ней параметр
    # filename=PVS-Setup-{версия}.exe — CDN Яндекса отдаёт файл с этим именем.
    if method == "GET" and params.get("file") in ("exe", "server"):
        info = get_version_info(s3)
        is_exe = params["file"] == "exe"
        pub    = info["exe_public_url"] if is_exe else info["server_public_url"]
        if not pub:
            return {"statusCode": 404, "headers": CORS,
                    "body": json.dumps({"error": "Файл ещё не опубликован"}, ensure_ascii=False)}
        try:
            direct = resolve_download_url(pub)
        except Exception as e:
            return {"statusCode": 502, "headers": CORS,
                    "body": json.dumps({"error": str(e)}, ensure_ascii=False)}

        ver      = info["version"] if is_exe else info["server_version"]
        prefix   = "PVS-Setup" if is_exe else "PVS-Server"
        filename = f"{prefix}-{ver}.exe"
        # Задаём понятное имя файла при скачивании, чтобы он не сохранялся
        # как безымянный хэш (что усиливает предупреждение SmartScreen).
        # Разные хранилища читают имя из разных параметров, добавляем оба:
        #   • filename=...                       — Яндекс.Диск CDN
        #   • response-content-disposition=...   — S3-совместимые хранилища
        sep       = "&" if "?" in direct else "?"
        cd        = urllib.parse.quote(f'attachment; filename="{filename}"')
        direct    = (f"{direct}{sep}filename={urllib.parse.quote(filename)}"
                     f"&response-content-disposition={cd}")
        return {"statusCode": 302, "headers": {**CORS, "Location": direct}, "body": ""}

    # ── GET: информация о версии ──────────────────────────────────────────────
    #
    # ЭКОНОМИЯ. Раньше на КАЖДУЮ проверку версии функция дополнительно ходила
    # на Яндекс.Диск ДВА раза — за прямыми ссылками на установщик и на ядро.
    # Это самая долгая часть ответа (сетевой запрос наружу с ожиданием до 60 с),
    # причём ссылки никто не использовал: скачивание идёт отдельным адресом
    # ?file=exe, который получает свежую ссылку в момент нажатия «Скачать».
    #
    # Теперь обычная проверка версии — это одно быстрое чтение из хранилища,
    # без обращений наружу. Ссылки отдаём только по явному запросу
    # (?with_links=1), чтобы ничего не сломать у старых клиентов.
    if method == "GET":
        info = get_version_info(s3)
        out = {
            "version":        info["version"],
            "server_version": info["server_version"],
            "notes":          info["notes"],
            # Контроль целостности расчётного ядра: программа сверит сумму
            # скачанного файла и проверит подпись публичным ключом.
            "server_sha256":  info.get("server_sha256", ""),
            "server_sig":     info.get("server_sig", ""),
            # То же для установщика — используется для отметки в админ-панели.
            "exe_sha256":     info.get("exe_sha256", ""),
            "exe_sig":        info.get("exe_sig", ""),
            # Порог обязательного обновления по безопасности: сборки ниже
            # этой версии обязаны обновиться (блокирующее окно).
            "min_secure_version": info.get("min_secure_version", ""),
            "security_notes":     info.get("security_notes", ""),
        }
        if params.get("with_links") in ("1", "true", "yes"):
            try:
                out["download_url"] = resolve_download_url(info["exe_public_url"])
            except Exception:
                out["download_url"] = ""
            try:
                out["server_url"] = resolve_download_url(info["server_public_url"])
            except Exception:
                out["server_url"] = ""
        # Ответ можно недолго держать в кэше: версия меняется редко, а так
        # повторные обращения с одного устройства не доходят до функции.
        headers = {**CORS, "Cache-Control": "public, max-age=1800"}
        return {"statusCode": 200, "headers": headers, "body": json.dumps(out, ensure_ascii=False)}

    # ── POST: требует пароль ───────────────────────────────────────────────────
    if method == "POST":
        if not check_admin(event):
            return {"statusCode": 403, "headers": CORS,
                    "body": json.dumps({"error": "Неверный пароль"}, ensure_ascii=False)}

        body   = json.loads(event.get("body") or "{}")
        action = body.get("action")

        # ── Порог обязательного обновления по безопасности ────────────────────
        # Админ указывает версию, ниже которой работать небезопасно. Программы
        # со старой сборкой покажут блокирующее окно с кнопкой «Обновить».
        # Пустая строка снимает требование.
        if action == "set_min_secure":
            info = get_version_info(s3)
            ver  = (body.get("min_secure_version") or "").strip()
            if ver and not re.fullmatch(r"\d+(\.\d+)*", ver):
                return {"statusCode": 400, "headers": CORS,
                        "body": json.dumps({"error": "Версия вида 2.134.389"}, ensure_ascii=False)}
            info["min_secure_version"] = ver
            info["security_notes"]     = (body.get("security_notes") or "").strip()
            save_version_info(s3, info)
            return {"statusCode": 200, "headers": CORS,
                    "body": json.dumps({"ok": True, "info": info}, ensure_ascii=False)}

        # ── Сохранить публичную ссылку Я.Диска + версию (без скачивания) ──────
        if action == "set_url":
            file_type = body.get("file_type", "exe")
            src_url   = (body.get("url") or "").strip()
            if not src_url.startswith("http"):
                return {"statusCode": 400, "headers": CORS,
                        "body": json.dumps({"error": "Нужна публичная ссылка (http...)"}, ensure_ascii=False)}

            # Сразу проверяем, что ссылка рабочая и отдаёт файл (получаем прямую ссылку)
            try:
                resolve_download_url(src_url)
            except Exception as e:
                return {"statusCode": 400, "headers": CORS,
                        "body": json.dumps({"error": f"Ссылка недоступна: {e}"}, ensure_ascii=False)}

            info = get_version_info(s3)
            if file_type == "exe":
                info["exe_public_url"] = src_url
                info["version"]        = body.get("version", info["version"])
                info["notes"]          = body.get("notes", info.get("notes", ""))
                # Фиксируем контрольную сумму установщика и подписываем её —
                # чтобы в админ-панели было видно, что файл на Я.Диске подлинный
                # и не подменён. Установщик ставится вручную, поэтому отсутствие
                # ключа подписи не блокирует публикацию: просто оставим пусто.
                try:
                    direct = resolve_download_url(src_url)
                    exe_sha, exe_sig = hash_and_sign_file(direct)
                    info["exe_sha256"] = exe_sha
                    info["exe_sig"]    = exe_sig
                except Exception as e:
                    info["exe_sha256"] = ""
                    info["exe_sig"]    = ""
                    print(f"[app-version] exe sign skipped: {e}")
            else:
                info["server_public_url"] = src_url
                info["server_version"]    = body.get("server_version", info.get("server_version", "1.0.0"))
                # Фиксируем контрольную сумму подлинного ядра и подписываем её.
                # Скачиваем файл один раз здесь (в момент публикации), чтобы
                # программа при обновлении могла проверить целостность и подпись.
                try:
                    direct = resolve_download_url(src_url)
                    sha256, sig = hash_and_sign_file(direct)
                    info["server_sha256"] = sha256
                    info["server_sig"]    = sig
                    if not sig:
                        # Ключ подписи не настроен — не публикуем «полузащищённое»
                        # обновление, чтобы клиент не отверг его при проверке.
                        return {"statusCode": 500, "headers": CORS,
                                "body": json.dumps({"error": "Подпись обновления не настроена (OFFLINE_KEY_PRIVATE)"},
                                                   ensure_ascii=False)}
                except Exception as e:
                    return {"statusCode": 502, "headers": CORS,
                            "body": json.dumps({"error": f"Не удалось подписать ядро: {e}"}, ensure_ascii=False)}
            save_version_info(s3, info)
            return {"statusCode": 200, "headers": CORS,
                    "body": json.dumps({"ok": True, "info": info}, ensure_ascii=False)}

        # ── Обновить только номер версии и заметки ────────────────────────────
        if action == "set_version":
            info = get_version_info(s3)
            info["version"] = body.get("version", info["version"])
            info["notes"]   = body.get("notes",   info.get("notes", ""))
            save_version_info(s3, info)
            return {"statusCode": 200, "headers": CORS,
                    "body": json.dumps({"ok": True, "info": info}, ensure_ascii=False)}

        return {"statusCode": 400, "headers": CORS,
                "body": json.dumps({"error": "Неизвестный action"}, ensure_ascii=False)}

    return {"statusCode": 405, "headers": CORS, "body": ""}