/**
 * Аварийный оффлайн-ключ для расчётов без интернета (рудник / ВГСЧ).
 *
 * Ключ — криптографически подписанный токен формата:
 *   PVSO.<payload_b64url>.<sig_b64url>
 * payload — JSON {org, exp (ISO), seats, iat}. Подпись Ed25519 создаётся
 * приватным ключом на сервере, а здесь проверяется ПУБЛИЧНЫМ ключом
 * локально, без обращения к серверу. Подделать нельзя, работает офлайн.
 *
 * Приоритет: обычная (онлайн) лицензия важнее. Аварийный ключ — страховка
 * на случай отсутствия связи, ограничен сроком действия (по умолчанию 1 год
 * с возможностью продления через выпуск нового ключа).
 */
import { verify as ed25519Verify, etc as edEtc } from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";

// @noble/ed25519 v2 требует задать функцию SHA-512 для синхронного verify.
edEtc.sha512Sync = (...m) => sha512(edEtc.concatBytes(...m));

// Публичный ключ проверки (base64url, Ed25519, 32 байта). НЕ секретный.
// Пара к секрету OFFLINE_KEY_PRIVATE на сервере.
const PUBLIC_KEY_B64 = "MsyBGg0UlSyEns_shvQD_Ob82SJ-9Klds-naVhQl9hc";

const OFFLINE_PREFIX = "PVSO.";
const STORAGE_KEY = "pvs_offline_key";
/** Отозванные аварийные ключи: {kids: number[], keys: string[]}. */
const REVOKED_KEY = "pvs_offline_revoked";

const IS_DESKTOP = typeof window !== "undefined"
  && !!(window as Window & { __IS_DESKTOP__?: boolean }).__IS_DESKTOP__;

// ── Хранение ────────────────────────────────────────────────────────────────
// В десктопе аварийный ключ, вердикт сервера и список отозванных ключей пишем
// не только в localStorage, но и в файл профиля через ядро (/api/license-store)
// — так же, как основную лицензию. Раньше они жили только в localStorage:
// очистка данных WebView2 стирала отметку «ключ отозван», и отозванный ключ,
// введённый заново без интернета, снова работал до своего срока.
// При запуске файл возвращает значения в localStorage (storage.init в license.ts).
function persist(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
  } catch { /* ignore */ }
  if (!IS_DESKTOP) return;
  try {
    fetch("/api/license-store", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value === null ? { key, remove: true } : { key, value }),
    }).catch(() => { /* ignore */ });
  } catch { /* ignore */ }
}

interface RevokedList { kids: number[]; keys: string[] }

function readRevoked(): RevokedList {
  try {
    const d = JSON.parse(localStorage.getItem(REVOKED_KEY) || "{}") as Partial<RevokedList>;
    return {
      kids: Array.isArray(d.kids) ? d.kids.filter((k) => Number.isInteger(k)) : [],
      keys: Array.isArray(d.keys) ? d.keys.filter((k) => typeof k === "string") : [],
    };
  } catch { return { kids: [], keys: [] }; }
}

function kidOf(key: string): number | undefined {
  try {
    const p = JSON.parse(new TextDecoder().decode(b64urlToBytes(key.trim().split(".")[1]))) as { kid?: unknown };
    return typeof p.kid === "number" ? p.kid : (typeof p.kid === "string" && /^\d+$/.test(p.kid) ? Number(p.kid) : undefined);
  } catch { return undefined; }
}

/** Отметить ключ отозванным (или снять отметку, если сервер его вернул). */
export function markOfflineKeyRevoked(key: string, revoked: boolean): void {
  const k = key.trim();
  const kid = kidOf(k);
  const list = readRevoked();
  const kids = new Set(list.kids), keys = new Set(list.keys);
  if (revoked) { if (kid !== undefined) kids.add(kid); keys.add(k); }
  else { if (kid !== undefined) kids.delete(kid); keys.delete(k); }
  persist(REVOKED_KEY, JSON.stringify({ kids: [...kids], keys: [...keys] }));
}

/** Ключ ранее отозван сервером (список хранится на устройстве, в десктопе — и в файле). */
export function isOfflineKeyRevoked(key: string): boolean {
  const k = key.trim();
  const list = readRevoked();
  if (list.keys.includes(k)) return true;
  const kid = kidOf(k);
  return kid !== undefined && list.kids.includes(kid);
}

/**
 * Десктоп: подтянуть список отзыва из ядра. Ядро запоминает отзыв из ответа
 * сервера в отдельном файле — он переживает и чистку WebView2, и удаление
 * записей в license_store.
 */
export async function syncRevokedFromCore(): Promise<void> {
  if (!IS_DESKTOP) return;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch("/api/offline-revoked", { cache: "no-store", signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return;
    const d = await res.json() as Partial<RevokedList>;
    const cur = readRevoked();
    const kids = new Set([...cur.kids, ...(d.kids ?? []).filter((k) => Number.isInteger(k))]);
    const keys = new Set([...cur.keys, ...(d.keys ?? []).filter((k) => typeof k === "string")]);
    persist(REVOKED_KEY, JSON.stringify({ kids: [...kids], keys: [...keys] }));
  } catch { /* ядро старой версии — эндпоинта нет */ }
}

export interface OfflineKeyInfo {
  valid: boolean;
  org?: string;
  expiresAt?: string;   // ISO
  daysLeft?: number;
  seats?: number;
  expired?: boolean;
  reason?: string;      // причина невалидности
  /**
   * Код компьютера, к которому привязан ключ (если привязка задана при
   * выпуске). Ключ с привязкой работает ТОЛЬКО на этом ПК — скопировать его
   * на соседние машины нельзя.
   */
  boundFp?: string;
  /** Номер ключа в реестре — для квартальной проверки отзыва на сервере. */
  kid?: number;
  /** Дата выпуска ключа (подписана) — по ней виден откат часов назад. */
  issuedAt?: string;
}

/**
 * Код рабочего места, который сверяется с привязкой внутри ключа.
 *
 * Это те же первые 8 символов отпечатка, что показаны человеку в окне
 * лицензии («ID ...»). Их называют при заказе ключа, и по ним ключ намертво
 * привязывается к компьютеру.
 *
 * Хранится только в памяти и вычисляется из реального железа при каждом
 * запуске: подменить вместе с ключом нельзя.
 */
let _seatCode: string | null = null;
export function setSeatCode(fingerprint: string): void {
  _seatCode = fingerprint ? fingerprint.slice(0, 8).toUpperCase() : null;
}
export function getSeatCode(): string | null {
  return _seatCode;
}

export function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Похоже ли значение на аварийный оффлайн-ключ (по префиксу). */
export function isOfflineKey(key: string): boolean {
  return key.trim().startsWith(OFFLINE_PREFIX);
}

/**
 * Проверяет подпись Ed25519 произвольного набора байт ТЕМ ЖЕ публичным ключом,
 * что и аварийный ключ. Используется для проверки подписи онлайн-лицензии
 * (см. license.ts): сервер подписывает ответ приватным ключом, клиент —
 * проверяет здесь, без обращения к серверу.
 *
 * payloadB64 и sigB64 — base64url. Возвращает true, только если подпись верна.
 */
export function verifySignedPayload(payloadB64: string, sigB64: string): boolean {
  try {
    const payloadBytes = b64urlToBytes(payloadB64);
    const sig = b64urlToBytes(sigB64);
    const pub = b64urlToBytes(PUBLIC_KEY_B64);
    return ed25519Verify(sig, payloadBytes, pub);
  } catch {
    return false;
  }
}

/** Декодирует base64url-payload в текст (для чтения подписанного JSON). */
export function decodeB64urlText(payloadB64: string): string {
  return new TextDecoder().decode(b64urlToBytes(payloadB64));
}

/**
 * Проверяет оффлайн-ключ ЛОКАЛЬНО (подпись + срок). Интернет не нужен.
 */
export function verifyOfflineKey(key: string): OfflineKeyInfo {
  const raw = key.trim();
  if (!raw.startsWith(OFFLINE_PREFIX)) {
    return { valid: false, reason: "not_offline_key" };
  }
  const parts = raw.split(".");
  if (parts.length !== 3) {
    return { valid: false, reason: "bad_format" };
  }
  const [, payloadB64, sigB64] = parts;
  try {
    const payloadBytes = b64urlToBytes(payloadB64);
    const sig = b64urlToBytes(sigB64);
    const pub = b64urlToBytes(PUBLIC_KEY_B64);

    const ok = ed25519Verify(sig, payloadBytes, pub);
    if (!ok) return { valid: false, reason: "bad_signature" };

    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as {
      org?: string; exp?: string; seats?: number; fp?: string; kid?: number;
      iat?: string;
    };
    const exp = payload.exp ? new Date(payload.exp).getTime() : 0;
    if (!exp) return { valid: false, reason: "no_expiry" };

    const now = Date.now();

    // ЧАСЫ ОТВЕДЕНЫ НАЗАД — ПРОВЕРКА ПО САМОМУ КЛЮЧУ.
    //
    // Внутри подписи есть дата выпуска (iat). Ключ физически не мог
    // существовать раньше, чем был выпущен, поэтому дата на компьютере НИКОГДА
    // не должна быть раньше неё. Если это так — часы переведены назад.
    //
    // Это важнее, чем кажется: отдельная отметка времени хранится на диске, и
    // её можно стереть вместе с данными браузера. А дату выпуска стереть
    // нельзя — она защищена той же подписью, что и сам ключ: изменишь её, и
    // ключ перестанет проходить проверку подлинности.
    //
    // Допуск в сутки — на случай неточных часов и часовых поясов.
    if (payload.iat) {
      const iat = new Date(payload.iat).getTime();
      if (iat && now < iat - 24 * 3600 * 1000) {
        return {
          valid: false, reason: "clock_before_issue",
          org: payload.org, expiresAt: payload.exp,
          issuedAt: payload.iat,
        };
      }
    }
    const daysLeft = Math.floor((exp - now) / (24 * 3600 * 1000));
    if (exp < now) {
      return {
        valid: false, expired: true, reason: "expired",
        org: payload.org, expiresAt: payload.exp, daysLeft: 0,
      };
    }

    // ПРИВЯЗКА К КОМПЬЮТЕРУ. Если при выпуске ключа указан код рабочего места,
    // ключ действует только на нём. Это отсекает главную лазейку: раньше один
    // аварийный ключ можно было разослать на любое число ПК.
    //
    // Код места считается из реального железа при запуске (см. setSeatCode).
    // Пока он ещё не посчитан, проверку не проваливаем — она повторится на
    // следующем шаге запуска, когда отпечаток уже известен.
    if (payload.fp) {
      const mine = getSeatCode();
      if (mine && mine !== payload.fp.toUpperCase()) {
        return {
          valid: false, reason: "wrong_computer",
          org: payload.org, expiresAt: payload.exp,
          boundFp: payload.fp.toUpperCase(),
        };
      }
    }

    return {
      valid: true,
      org: payload.org,
      expiresAt: payload.exp,
      daysLeft,
      seats: payload.seats,
      boundFp: payload.fp ? payload.fp.toUpperCase() : undefined,
      kid: payload.kid,
      issuedAt: payload.iat,
    };
  } catch {
    return { valid: false, reason: "verify_error" };
  }
}

/** Сохранить аварийный ключ на устройстве (для повторных запусков без сети). */
export function saveOfflineKey(key: string): void {
  persist(STORAGE_KEY, key.trim());
}

/** Загрузить сохранённый аварийный ключ, если он ещё валиден. */
export function loadOfflineKey(): { key: string; info: OfflineKeyInfo } | null {
  try {
    const key = localStorage.getItem(STORAGE_KEY);
    if (!key) return null;
    return { key, info: verifyOfflineKey(key) };
  } catch { return null; }
}

export function clearOfflineKey(): void {
  // Список отозванных ключей НЕ очищаем: он и нужен, чтобы отозванный ключ
  // нельзя было ввести заново после выхода из лицензии.
  persist(STORAGE_KEY, null);
  persist(VERDICT_KEY, null);
}

// ── Квартальная сверка аварийного ключа с сервером ───────────────────────────
// Ключ по-прежнему проверяется локально и без интернета. Но раз в квартал,
// ЕСЛИ связь есть, программа сверяется с сервером: не отозван ли ключ и не
// отключено ли это рабочее место. Ответ сохраняется здесь.
//
// Режим МЯГКИЙ: нет связи — ничего не происходит, программа работает дальше.
// Блокировка наступает только по явному ответу сервера «ключ отозван».
const VERDICT_KEY = "pvs_offline_verdict";

/** Раз в 90 дней (квартал) — если в этот момент есть интернет. */
export const OFFLINE_RECHECK_MS = 90 * 24 * 3600 * 1000;

export interface OfflineVerdict {
  /** false — сервер сказал, что ключ больше не действует */
  valid: boolean;
  /** revoked | expired | seat_blocked | seats_exhausted */
  reason?: string;
  /** Когда сверялись последний раз */
  checkedAt: number;
  /** Когда сверяться снова */
  nextCheckAt: number;
}

export function loadOfflineVerdict(): OfflineVerdict | null {
  try {
    const raw = localStorage.getItem(VERDICT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as OfflineVerdict;
  } catch { return null; }
}

export function saveOfflineVerdict(v: OfflineVerdict): void {
  persist(VERDICT_KEY, JSON.stringify(v));
}

/** Пора ли сверяться с сервером (наступил срок или сверки не было ни разу). */
export function isOfflineRecheckDue(): boolean {
  const v = loadOfflineVerdict();
  if (!v) return true;
  const now = Date.now();
  // Дата на компьютере оказалась РАНЬШЕ последней сверки — часы отвели назад.
  // Без этой строки откат даты откладывал бы сверку на сколько угодно: срок
  // следующей проверки навсегда оставался «в будущем», и отзыв ключа не
  // доходил бы до компьютера. Сверяемся немедленно.
  if (now < v.checkedAt) return true;
  return now >= v.nextCheckAt;
}