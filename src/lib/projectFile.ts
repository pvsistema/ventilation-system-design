// Разбор файла схемы (.vproj) с понятными причинами отказа.
// Раньше каждое место открытия проверяло файл по-своему, а повреждённый файл
// либо молча пропускался, либо давал общее «Ошибка чтения файла».

export const PROJECT_FORMAT_VERSION = 2;

export type ParsedProject =
  | { ok: true; data: Record<string, unknown>; warning?: string }
  | { ok: false; error: string };

export function parseProjectText(text: string, fileName: string): ParsedProject {
  const name = fileName || "файл";
  if (!text || !text.trim()) {
    return { ok: false, error: `Файл «${name}» пустой — в нём нет схемы.\n\nВозможно, запись была прервана. Если есть резервная копия — откройте её.` };
  }
  let data: unknown;
  try {
    data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return {
      ok: false,
      error: `Файл «${name}» повреждён: его содержимое не читается как схема.\n\n` +
        "Чаще всего так бывает, если запись файла оборвалась (пропало питание, отключилась сетевая папка) " +
        "или файл обрезан при копировании. Откройте резервную копию, если она есть.",
    };
  }
  if (!data || typeof data !== "object" || !Array.isArray((data as { nodes?: unknown }).nodes)) {
    return { ok: false, error: `Файл «${name}» не является схемой ПВ-Системы.\n\nОткройте файл с расширением .vproj, сохранённый этой программой.` };
  }
  const d = data as Record<string, unknown>;
  const ver = typeof d.version === "number" ? d.version : 0;
  const warning = ver > PROJECT_FORMAT_VERSION
    ? `Файл «${name}» сохранён более новой версией программы. Часть данных может не отобразиться — обновите программу.`
    : undefined;
  return { ok: true, data: d, warning };
}

export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e ?? "неизвестная ошибка");
}

export function isUserCancel(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { name?: string }).name === "AbortError";
}
