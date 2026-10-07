"""
Кабинет клиента: ограниченный доступ организации к СВОИМ лицензиям.

Отдельная функция, НЕ связанная с административным паролем. Клиент входит
по логину и паролю, выданным в админке (таблица client_access), и получает
токен сессии. Каждый запрос ограничен группой организации (org_group),
к которой привязан доступ; каждое действие сначала проверяет, что ключ или
рабочее место принадлежит этой группе.

Действий создания/удаления ключей, изменения сроков и мест, выпуска
аварийных ключей и настроек сервера здесь нет вовсе.

POST /  body: {action, token?, ...}
  login                 — {login, password} -> {token, org_group}
  whoami                — текущая группа
  list_licenses         — онлайн-ключи группы (срок, мест всего/занято)
  list_seats            — ПК на онлайн-ключе {license_id}
  revoke_seat           — отвязать ПК от онлайн-ключа {seat_id}
  list_offline_keys     — аварийные ключи группы
  list_offline_seats    — ПК на аварийном ключе {offline_key_id}
  block_offline_seat    — отключить/вернуть ПК {seat_id, is_blocked}
  reset_offline_binding — сбросить привязку аварийного ключа {offline_key_id}
  list_events           — журнал событий по ключам группы {limit?}
"""
import json
import os
import hashlib
import hmac
import time
import psycopg2

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Client-Token",
    "Access-Control-Max-Age": "86400",
}

SESSION_HOURS = 12


def get_conn():
    dsn = os.environ["DATABASE_URL"]
    schema = os.environ.get("MAIN_DB_SCHEMA", "public")
    return psycopg2.connect(dsn, options=f"-c search_path={schema}")


def resp(status: int, body: dict) -> dict:
    return {
        "statusCode": status,
        "headers": {**CORS, "Content-Type": "application/json"},
        "body": json.dumps(body, default=str, ensure_ascii=False),
    }


def hash_password(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 200_000).hex()


def _sign(cid: int, exp: int, pw_hash: str) -> str:
    # Ключ подписи — хэш пароля клиента: смена пароля в админке сразу
    # делает недействительными все выданные ранее токены.
    msg = f"{cid}.{exp}".encode()
    return hmac.new(pw_hash.encode(), msg, hashlib.sha256).hexdigest()


def make_token(cid: int, pw_hash: str) -> str:
    exp = int(time.time()) + SESSION_HOURS * 3600
    return f"{cid}.{exp}.{_sign(cid, exp, pw_hash)}"


def check_token(cur, token: str):
    """Возвращает (org_group, login) или None. Отключённый доступ — None."""
    try:
        cid_s, exp_s, sig = token.split(".")
        cid, exp = int(cid_s), int(exp_s)
    except Exception:
        return None
    if exp < time.time():
        return None
    cur.execute("""
        SELECT org_group, login, password_hash FROM client_access
        WHERE id = %s AND is_active = TRUE
    """, (cid,))
    row = cur.fetchone()
    if not row or not hmac.compare_digest(_sign(cid, exp, row[2]), sig):
        return None
    return row[0], row[1]


def log_client(cur, login: str, event_type: str, detail: str,
               license_id=None, seat_id=None, hostname=None, platform=None, ip=None):
    cur.execute("""
        INSERT INTO license_events
          (license_id, seat_id, event_type, hostname, platform, ip, detail)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
    """, (license_id, seat_id, event_type, hostname, platform, ip,
          f"клиент ({login}): {detail}"))


def handler(event: dict, context) -> dict:
    """Кабинет клиента: просмотр и ограниченное управление ключами своей группы."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    body = {}
    if event.get("body"):
        try:
            body = json.loads(event["body"])
        except Exception:
            return resp(400, {"error": "invalid_json"})

    action = (body.get("action") or "").strip()
    headers = event.get("headers") or {}
    ip = ((event.get("requestContext") or {}).get("identity") or {}).get("sourceIp")

    conn = get_conn()
    cur = conn.cursor()
    try:
        # ── login ────────────────────────────────────────────────────────────
        if action == "login":
            login = (body.get("login") or "").strip().lower()
            password = (body.get("password") or "").strip()
            if not login or not password:
                return resp(400, {"error": "login_and_password_required"})
            cur.execute("""
                SELECT id, org_group, password_hash, password_salt, is_active
                FROM client_access WHERE login = %s
            """, (login,))
            row = cur.fetchone()
            ok = False
            if row and row[4]:
                ok = hmac.compare_digest(hash_password(password, row[3]), row[2])
            if not ok:
                time.sleep(1)  # замедляем перебор паролей
                return resp(401, {"error": "invalid_credentials"})
            token = make_token(row[0], row[2])
            cur.execute("UPDATE client_access SET last_login_at = NOW() WHERE id = %s", (row[0],))
            log_client(cur, login, "client_login", f"вход в кабинет «{row[1]}»", ip=ip)
            conn.commit()
            return resp(200, {"token": token, "org_group": row[1], "login": login})

        # ── проверка сессии для всех остальных действий ───────────────────────
        token = (body.get("token") or headers.get("X-Client-Token")
                 or headers.get("x-client-token") or "").strip()
        if not token:
            return resp(401, {"error": "unauthorized"})
        srow = check_token(cur, token)
        if not srow:
            return resp(401, {"error": "unauthorized"})
        group, login = srow

        if action == "whoami":
            return resp(200, {"org_group": group, "login": login})

        # ── list_licenses ────────────────────────────────────────────────────
        if action == "list_licenses":
            cur.execute("""
                SELECT l.id, l.key, l.owner_name, l.max_seats, l.is_active,
                       l.expires_at, COUNT(s.id), MAX(s.last_seen_at),
                       COUNT(s.id) FILTER (WHERE s.last_seen_at > NOW() - INTERVAL '45 minutes')
                FROM licenses l
                LEFT JOIN license_seats s ON s.license_id = l.id
                WHERE l.org_group = %s
                GROUP BY l.id
                ORDER BY l.owner_name
            """, (group,))
            items = [{
                "id": r[0], "key": r[1], "owner_name": r[2], "max_seats": r[3],
                "is_active": r[4], "expires_at": str(r[5]) if r[5] else None,
                "used_seats": int(r[6]), "last_activity": str(r[7]) if r[7] else None,
                "online_seats": int(r[8]),
            } for r in cur.fetchall()]
            return resp(200, {"licenses": items})

        # ── list_seats ───────────────────────────────────────────────────────
        if action == "list_seats":
            lic_id = int(body.get("license_id") or 0)
            cur.execute("SELECT 1 FROM licenses WHERE id = %s AND org_group = %s", (lic_id, group))
            if not cur.fetchone():
                return resp(404, {"error": "not_found"})
            cur.execute("""
                SELECT id, hostname, platform, app_version, activated_at, last_seen_at,
                       (last_seen_at > NOW() - INTERVAL '45 minutes')
                FROM license_seats WHERE license_id = %s
                ORDER BY last_seen_at DESC
            """, (lic_id,))
            seats = [{
                "id": r[0], "hostname": r[1], "platform": r[2], "app_version": r[3],
                "activated_at": str(r[4]), "last_seen_at": str(r[5]), "online": bool(r[6]),
            } for r in cur.fetchall()]
            return resp(200, {"seats": seats})

        # ── revoke_seat ──────────────────────────────────────────────────────
        if action == "revoke_seat":
            seat_id = int(body.get("seat_id") or 0)
            cur.execute("""
                SELECT s.license_id, s.fingerprint, s.hostname, s.platform, l.owner_name
                FROM license_seats s JOIN licenses l ON l.id = s.license_id
                WHERE s.id = %s AND l.org_group = %s
            """, (seat_id, group))
            row = cur.fetchone()
            if not row:
                return resp(404, {"error": "not_found"})
            cur.execute("DELETE FROM license_seats WHERE id = %s", (seat_id,))
            cur.execute("""
                INSERT INTO license_events
                  (license_id, seat_id, event_type, fingerprint, hostname, platform, ip, detail)
                VALUES (%s, %s, 'revoked', %s, %s, %s, %s, %s)
            """, (row[0], seat_id, row[1], row[2], row[3], ip,
                  f"клиент ({login}): ПК «{row[2] or '—'}» отвязан от ключа «{row[4]}»"))
            conn.commit()
            return resp(200, {"ok": True})

        # ── list_offline_keys ────────────────────────────────────────────────
        if action == "list_offline_keys":
            cur.execute("""
                SELECT o.id, o.org, o.seats, o.expires_at, o.is_active,
                       (o.expires_at IS NOT NULL AND o.expires_at < NOW()),
                       (o.bound_fp IS NOT NULL AND o.bound_fp <> ''),
                       o.autobind,
                       (SELECT COUNT(*) FROM offline_key_seats s
                         WHERE s.offline_key_id = o.id AND s.is_blocked = FALSE),
                       (SELECT MAX(s.last_seen_at) FROM offline_key_seats s
                         WHERE s.offline_key_id = o.id AND s.is_blocked = FALSE),
                       (SELECT s.hostname FROM offline_key_seats s
                         WHERE s.offline_key_id = o.id AND s.is_blocked = FALSE
                           AND s.bound_at IS NOT NULL
                         ORDER BY s.bound_at ASC LIMIT 1),
                       o.revoked_at
                FROM offline_keys o
                WHERE o.org_group = %s
                ORDER BY o.org
            """, (group,))
            items = [{
                "id": r[0], "org": r[1], "seats": r[2],
                "expires_at": str(r[3]) if r[3] else None,
                "is_active": r[4], "expired": bool(r[5]), "bound": bool(r[6]),
                "autobind": bool(r[7]), "used_seats": int(r[8] or 0),
                "last_seen_at": str(r[9]) if r[9] else None,
                "bound_host": r[10], "revoked_at": str(r[11]) if r[11] else None,
            } for r in cur.fetchall()]
            return resp(200, {"keys": items})

        # ── list_offline_seats ───────────────────────────────────────────────
        if action == "list_offline_seats":
            oid = int(body.get("offline_key_id") or 0)
            cur.execute("SELECT 1 FROM offline_keys WHERE id = %s AND org_group = %s", (oid, group))
            if not cur.fetchone():
                return resp(404, {"error": "not_found"})
            cur.execute("""
                SELECT id, hostname, platform, app_version, is_blocked,
                       first_seen_at, last_seen_at
                FROM offline_key_seats WHERE offline_key_id = %s
                ORDER BY first_seen_at
            """, (oid,))
            seats = [{
                "id": r[0], "hostname": r[1], "platform": r[2], "app_version": r[3],
                "is_blocked": bool(r[4]), "first_seen_at": str(r[5]),
                "last_seen_at": str(r[6]),
            } for r in cur.fetchall()]
            return resp(200, {"seats": seats})

        # ── block_offline_seat ───────────────────────────────────────────────
        if action == "block_offline_seat":
            sid = int(body.get("seat_id") or 0)
            blocked = bool(body.get("is_blocked", True))
            cur.execute("""
                SELECT s.hostname, s.platform, o.org, o.id
                FROM offline_key_seats s JOIN offline_keys o ON o.id = s.offline_key_id
                WHERE s.id = %s AND o.org_group = %s
            """, (sid, group))
            row = cur.fetchone()
            if not row:
                return resp(404, {"error": "not_found"})
            cur.execute("UPDATE offline_key_seats SET is_blocked = %s WHERE id = %s", (blocked, sid))
            what = "отключён" if blocked else "возвращён"
            log_client(cur, login, "client_offline_seat_blocked" if blocked else "client_offline_seat_unblocked",
                       f"ПК «{row[0] or '—'}» {what} на аварийном ключе «{row[2]}» (key_id={row[3]})",
                       hostname=row[0], platform=row[1], ip=ip)
            conn.commit()
            return resp(200, {"ok": True, "is_blocked": blocked})

        # ── reset_offline_binding ────────────────────────────────────────────
        if action == "reset_offline_binding":
            oid = int(body.get("offline_key_id") or 0)
            cur.execute("SELECT org, seats FROM offline_keys WHERE id = %s AND org_group = %s", (oid, group))
            row = cur.fetchone()
            if not row:
                return resp(404, {"error": "not_found"})
            cur.execute("DELETE FROM offline_key_seats WHERE offline_key_id = %s", (oid,))
            cur.execute("UPDATE offline_keys SET bound_fp = NULL, autobind = TRUE WHERE id = %s", (oid,))
            log_client(cur, login, "offline_binding_reset",
                       f"сброшена привязка аварийного ключа «{row[0]}» (key_id={oid}), "
                       f"ключ закрепится заново (мест {row[1]})", ip=ip)
            conn.commit()
            return resp(200, {"ok": True})

        # ── list_events ──────────────────────────────────────────────────────
        if action == "list_events":
            limit = max(1, min(int(body.get("limit") or 200), 500))
            # События онлайн-ключей группы + события аварийных ключей группы
            # (у них license_id пуст, номер ключа записан в тексте как key_id=N
            # или «Ключ #N»).
            cur.execute("""
                SELECT e.id, e.event_type, e.hostname, e.platform, e.app_version,
                       e.detail, e.created_at, l.owner_name
                FROM license_events e
                LEFT JOIN licenses l ON l.id = e.license_id
                WHERE e.event_type NOT IN ('check_ok', 'module_use', 'heartbeat')
                  AND (
                    l.org_group = %s
                    OR (e.license_id IS NULL AND EXISTS (
                        SELECT 1 FROM offline_keys o
                        WHERE o.org_group = %s
                          AND (e.detail ~ ('key_id=' || o.id || '([^0-9]|$)')
                               OR e.detail ~ ('Ключ #' || o.id || '([^0-9]|$)')
                               OR (e.event_type = 'offline_key_issued'
                                   AND position(('org=' || o.org || ';') IN e.detail) = 1))
                    ))
                    OR (e.event_type = 'client_login' AND e.detail LIKE %s)
                  )
                ORDER BY e.created_at DESC
                LIMIT %s
            """, (group, group, f"клиент ({login}):%", limit))
            events = [{
                "id": r[0], "event_type": r[1], "hostname": r[2], "platform": r[3],
                "app_version": r[4], "detail": r[5], "created_at": str(r[6]),
                "license": r[7],
            } for r in cur.fetchall()]
            return resp(200, {"events": events})

        return resp(400, {"error": "unknown_action"})
    except Exception as e:
        conn.rollback()
        import traceback
        print(f"[client] action={action} error: {e}\n{traceback.format_exc()}")
        return resp(500, {"error": "server_error", "detail": f"{type(e).__name__}: {str(e)[:200]}"})
    finally:
        cur.close()
        conn.close()