// Доступ к модулю «Отчёт ВДС»: пара «лицензионный ключ + код доступа»,
// выдаваемого администратором в админ-панели. Проверка — на сервере лицензий
// (action = vds_check). Подтверждённый код запоминается локально для этого
// ключа и перепроверяется при каждом открытии, если есть связь.
import { API_URLS } from "@/lib/api-urls";

const LS_KEY = "pvs_vds_access";

interface Stored { key: string; code: string; verifiedAt: number }

export function loadVdsAccess(licenseKey?: string): Stored | null {
  if (!licenseKey) return null;
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) || "null") as Stored | null;
    return s && s.key === licenseKey ? s : null;
  } catch { return null; }
}

export function clearVdsAccess() {
  localStorage.removeItem(LS_KEY);
}

const REASONS: Record<string, string> = {
  missing: "Введите код доступа",
  license_not_found: "Лицензионный ключ не найден на сервере",
  license_inactive: "Лицензия отозвана",
  license_expired: "Срок лицензии истёк",
  module_not_enabled: "Для вашей лицензии модуль «Отчёт ВДС» не подключён — обратитесь к правообладателю",
  wrong_code: "Неверный код доступа к отчёту ВДС",
};

export type VdsCheck = { ok: true } | { ok: false; message: string; offline?: boolean };

export async function verifyVdsCode(licenseKey: string, code: string, fingerprint: string): Promise<VdsCheck> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(API_URLS.license, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({ action: "vds_check", key: licenseKey, vds_code: code.trim().toUpperCase(), fingerprint: fingerprint || "vds" }),
    });
    const data = await res.json();
    if (data.ok) {
      localStorage.setItem(LS_KEY, JSON.stringify({ key: licenseKey, code: code.trim().toUpperCase(), verifiedAt: Date.now() }));
      return { ok: true };
    }
    if (data.reason && data.reason !== "missing") clearVdsAccess();
    return { ok: false, message: REASONS[data.reason] ?? "Доступ запрещён" };
  } catch {
    return { ok: false, offline: true, message: "Нет связи с сервером лицензий" };
  } finally {
    clearTimeout(timer);
  }
}

/** Сколько работает сохранённый доступ без связи с сервером */
export const VDS_OFFLINE_GRACE_MS = 14 * 24 * 3600 * 1000;
