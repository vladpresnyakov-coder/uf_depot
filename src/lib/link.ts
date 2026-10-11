"use client";
/**
 * Двусторонняя связь «Коагуляция ⇄ UF Calc».
 * Коагуляция → UF: подача исходной воды при фильтрации на одну рабочую установку и число установок.
 * UF → Коагуляция: число рабочих установок, подача на установку при фильтрации, максимум подачи.
 * До появления проектов передаваемые данные хранятся в браузере.
 */
const KEY = "ufdepot.link.v1";

export interface CoagToUf { at: string; N: number | null; feedPerUnit: number | null; totalFeed: number | null }
export interface UfToCoag { at: string; N: number; X: number; feedPerUnit: number; totalFeed: number; feedMax: number; Qnet: number; J: number; modules: number; moduleArea: number }
interface Link { coagToUf?: CoagToUf; ufToCoag?: UfToCoag }

function load(): Link {
  try { const r = localStorage.getItem(KEY); return r ? (JSON.parse(r) as Link) : {}; } catch { return {}; }
}
function save(l: Link) {
  try { localStorage.setItem(KEY, JSON.stringify(l)); return true; } catch { return false; }
}
export const sendToUf = (d: Omit<CoagToUf, "at">) => save({ ...load(), coagToUf: { ...d, at: new Date().toISOString() } });
export const sendToCoag = (d: Omit<UfToCoag, "at">) => save({ ...load(), ufToCoag: { ...d, at: new Date().toISOString() } });
export const readCoagToUf = () => load().coagToUf ?? null;
export const readUfToCoag = () => load().ufToCoag ?? null;
/** Параметр в адресе страницы, по которому принимающая сторона подхватывает переданные данные. */
export const fromParam = (): string | null => {
  try { return new URLSearchParams(window.location.search).get("from"); } catch { return null; }
};
export const nf = (x: number, d = 2) => Number(x.toFixed(d)).toLocaleString("ru-RU", { maximumFractionDigits: d });
