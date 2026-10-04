// ─────────────────────────────────────────────────────────────────────────────
// mineVehicles.ts — справочник самоходной техники (пожарная нагрузка).
//
// Встроенный каталог + пользовательские правки. Всё хранится в браузере
// (localStorage): правка встроенной модели сохраняется поверх неё, свою
// технику можно добавить и удалить. «Сбросить» возвращает исходные данные.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";

export interface MineVehicle {
  id: string;
  name: string;
  type: string;
  /** Грузоподъёмность, т (необязательно). */
  tonnage?: number;
  /** Масса горючих материалов, кг. */
  rubber: number;
  diesel: number;
  oil: number;
  /** true — добавлена пользователем. */
  custom?: boolean;
}

export const VEHICLE_TYPES = [
  "ПДМ", "Самосвал", "Буровая установка", "Анкеровщик", "Набрызг-машина",
  "Самосвал карьерный", "Вспомогательная машина", "Прочее",
];

const BUILTIN: MineVehicle[] = [
  { id: "th315",  name: "Sandvik TH315",         type: "Самосвал",           tonnage: 15,  rubber: 780,  diesel: 260, oil: 160 },
  { id: "th430",  name: "Sandvik TH430",         type: "Самосвал",           tonnage: 30,  rubber: 1200, diesel: 400, oil: 220 },
  { id: "th540",  name: "Sandvik TH540",         type: "Самосвал",           tonnage: 40,  rubber: 1500, diesel: 520, oil: 280 },
  { id: "lh203",  name: "Sandvik LH203",         type: "ПДМ",                tonnage: 2,   rubber: 260,  diesel: 100, oil: 70  },
  { id: "lh307",  name: "Sandvik LH307",         type: "ПДМ",                tonnage: 7,   rubber: 520,  diesel: 180, oil: 110 },
  { id: "lh514",  name: "Sandvik LH514",         type: "ПДМ",                tonnage: 14,  rubber: 900,  diesel: 280, oil: 180 },
  { id: "st7",    name: "Epiroc ST7 Scooptram",  type: "ПДМ",                tonnage: 6.8, rubber: 480,  diesel: 170, oil: 120 },
  { id: "st14",   name: "Epiroc ST14 Scooptram", type: "ПДМ",                tonnage: 14,  rubber: 900,  diesel: 280, oil: 200 },
  { id: "mt42",   name: "Epiroc MT42",           type: "Самосвал",           tonnage: 42,  rubber: 1600, diesel: 550, oil: 300 },
  { id: "r1300",  name: "Caterpillar R1300G",    type: "ПДМ",                tonnage: 13,  rubber: 850,  diesel: 260, oil: 180 },
  { id: "r1600",  name: "Caterpillar R1600H",    type: "ПДМ",                tonnage: 16,  rubber: 950,  diesel: 290, oil: 210 },
  { id: "ad22",   name: "Caterpillar AD22",      type: "Самосвал",           tonnage: 22,  rubber: 1000, diesel: 340, oil: 200 },
  { id: "ad45",   name: "Caterpillar AD45B",     type: "Самосвал",           tonnage: 41,  rubber: 1500, diesel: 530, oil: 290 },
  { id: "wj5",    name: "Komatsu WJ-5",          type: "ПДМ",                tonnage: 5,   rubber: 400,  diesel: 150, oil: 95  },
  { id: "spray",  name: "Normet Spraymec",       type: "Набрызг-машина",                   rubber: 360,  diesel: 140, oil: 90  },
  { id: "t1d",    name: "Epiroc Boomer T1D",     type: "Буровая установка",                rubber: 800,  diesel: 290, oil: 240 },
  { id: "boltec", name: "Epiroc Boltec LC",      type: "Анкеровщик",                       rubber: 480,  diesel: 180, oil: 140 },
  { id: "th545",  name: "TH-545",                type: "Самосвал",           tonnage: 45,  rubber: 1200, diesel: 400, oil: 200 },
  { id: "belaz",  name: "БелАЗ-7555",            type: "Самосвал карьерный", tonnage: 55,  rubber: 2000, diesel: 700, oil: 400 },
];

const KEY = "pv_ref_vehicles_v2";

interface Stored {
  /** Правки встроенных моделей по id. */
  edits: Record<string, Partial<MineVehicle>>;
  /** Скрытые (удалённые) встроенные модели. */
  hidden: string[];
  /** Своя техника. */
  custom: MineVehicle[];
}

const EMPTY: Stored = { edits: {}, hidden: [], custom: [] };

function load(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const p = JSON.parse(raw) as Partial<Stored>;
    return { edits: p.edits ?? {}, hidden: p.hidden ?? [], custom: p.custom ?? [] };
  } catch { return EMPTY; }
}

const listeners = new Set<() => void>();
let state: Stored = load();

function save(next: Stored) {
  state = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* квота */ }
  listeners.forEach(l => l());
}

/** Текущий список техники: встроенная (с правками) + своя. */
export function getVehicles(): MineVehicle[] {
  const builtin = BUILTIN
    .filter(v => !state.hidden.includes(v.id))
    .map(v => ({ ...v, ...state.edits[v.id], id: v.id, custom: false }));
  return [...builtin, ...state.custom.map(v => ({ ...v, custom: true }))];
}

export function isVehicleEdited(id: string): boolean {
  return !!state.edits[id];
}

export function saveVehicle(v: MineVehicle) {
  if (v.custom) {
    const exists = state.custom.some(c => c.id === v.id);
    save({ ...state, custom: exists ? state.custom.map(c => c.id === v.id ? v : c) : [...state.custom, v] });
  } else {
    const { id, custom: _c, ...rest } = v;
    void _c;
    save({ ...state, edits: { ...state.edits, [id]: rest } });
  }
}

export function deleteVehicle(v: MineVehicle) {
  if (v.custom) save({ ...state, custom: state.custom.filter(c => c.id !== v.id) });
  else save({ ...state, hidden: [...state.hidden, v.id] });
}

/** Вернуть встроенную модель к исходным данным. */
export function revertVehicle(id: string) {
  const edits = { ...state.edits };
  delete edits[id];
  save({ ...state, edits });
}

/** Сбросить весь справочник к исходному (своя техника удаляется). */
export function resetVehicles() {
  save(EMPTY);
}

export function newVehicleId(): string {
  return `u_${Date.now().toString(36)}`;
}

/** React-хук: список техники, обновляется при любых правках. */
export function useVehicles(): MineVehicle[] {
  const [list, setList] = useState<MineVehicle[]>(getVehicles);
  useEffect(() => {
    const l = () => setList(getVehicles());
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return list;
}
