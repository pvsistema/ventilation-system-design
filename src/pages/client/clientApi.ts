import { API_URLS } from "@/lib/api-urls";

// Обращение к функции кабинета клиента. Токен выдаётся при входе и
// хранится в sessionStorage — закрыл вкладку браузера, вход нужен заново.
export const TOKEN_KEY = "pvs-client-token";

export class AuthError extends Error {}

export async function clientApi(body: object) {
  const token = sessionStorage.getItem(TOKEN_KEY) || "";
  const res = await fetch(API_URLS.clientLicenses, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, token }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new AuthError(data.error || "unauthorized");
  if (!res.ok) throw new Error(data.detail || data.error || "Ошибка запроса");
  return data;
}

export interface ClientLicense {
  id: number; key: string; owner_name: string; max_seats: number;
  is_active: boolean; expires_at: string | null; used_seats: number;
  online_seats: number; last_activity: string | null;
}
export interface ClientSeat {
  id: number; hostname: string | null; platform: string | null;
  app_version: string | null; activated_at: string; last_seen_at: string; online: boolean;
}
export interface ClientOfflineKey {
  id: number; org: string; seats: number; expires_at: string | null;
  is_active: boolean; expired: boolean; bound: boolean; autobind: boolean;
  used_seats: number; last_seen_at: string | null; bound_host: string | null;
  revoked_at: string | null;
}
export interface ClientOfflineSeat {
  id: number; hostname: string | null; platform: string | null;
  app_version: string | null; is_blocked: boolean;
  first_seen_at: string; last_seen_at: string;
}
export interface ClientEvent {
  id: number; event_type: string; hostname: string | null; platform: string | null;
  app_version: string | null; detail: string | null; created_at: string; license: string | null;
}

export function fmtDate(s: string | null) {
  if (!s || s === "None") return "—";
  return new Date(s).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}
export function fmtDateTime(s: string | null) {
  if (!s || s === "None") return "—";
  return new Date(s).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
export function daysLeft(s: string | null): number | null {
  if (!s || s === "None") return null;
  return Math.ceil((new Date(s).getTime() - Date.now()) / 86400000);
}

export const EVENT_LABELS: Record<string, string> = {
  activate: "Активация ключа",
  seat_created: "Новое рабочее место",
  revoked: "ПК отвязан от ключа",
  deactivated_by_user: "Лицензия снята с ПК пользователем",
  seats_exhausted: "Не хватило мест",
  expired_attempt: "Запуск с истёкшим ключом",
  disabled_attempt: "Запуск с отключённым ключом",
  clock_rollback: "Часы ПК переведены назад",
  vds_ok: "Отчёт ВДС",
  offline_key_issued: "Выпущен аварийный ключ",
  offline_key_autobound: "Аварийный ключ закрепился за ПК",
  offline_key_bound: "Аварийный ключ привязан к ПК",
  offline_binding_reset: "Сброшена привязка аварийного ключа",
  offline_autobind_enabled: "Включена автопривязка",
  offline_wrong_computer: "Аварийный ключ на чужом ПК",
  offline_seats_exhausted: "Не хватило мест аварийного ключа",
  offline_key_revoked_hit: "Запуск с отозванным аварийным ключом",
  offline_key_deleted_hit: "Запуск с удалённым аварийным ключом",
  client_login: "Вход в кабинет",
  client_offline_seat_blocked: "ПК отключён на аварийном ключе",
  client_offline_seat_unblocked: "ПК возвращён на аварийный ключ",
};
