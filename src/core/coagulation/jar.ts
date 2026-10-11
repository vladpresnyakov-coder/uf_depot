/**
 * Пробное коагулирование по ГОСТ Р 51642-2000, приложение А, и выбор оптимальной дозы (п. 3.7, А.5).
 * Оптимальная доза — наименьшая доза (в пересчёте на оксид Al₂O₃), при которой выполнены все нормативы.
 * Сезонность — СП 31.13330.2021, п. 9.15: в проект — максимальная расчётная доза и диапазон регулирования.
 */
import { isNum } from "../units/chem";

export type Season = "flood" | "low" | "ice" | "other";
export const SEASONS: [Season, string][] = [["flood", "паводок"], ["low", "межень"], ["ice", "ледостав"], ["other", "другой период"]];

/** Показатели, определяемые в отфильтрованной воде (ГОСТ Р 51642-2000, А.4.6). */
export const JAR_PARAMS = {
  turbidityMg: { label: "Мутность", unit: "мг/л" },
  color: { label: "Цветность", unit: "град" },
  permanganate: { label: "ПО", unit: "мг O₂/л" },
  al: { label: "Al ост.", unit: "мг/л" },
  fe: { label: "Fe", unit: "мг/л" },
  pH: { label: "pH", unit: "" },
} as const;
export type JarKey = keyof typeof JAR_PARAMS;

export interface JarRow { dose: number | null; values: Partial<Record<JarKey, number | null>> }
export interface JarTest {
  id: string;
  date: string;
  season: Season;
  temperature: number | null;
  coagulantType: string;
  productName: string;
  /** Исходная вода перед испытанием (А.3). */
  source: Partial<Record<JarKey | "alkalinity", number | null>>;
  rows: JarRow[];
  note: string;
}

export interface Limit { max?: number | null; min?: number | null; active: boolean }
export interface NormSet { name: string; source: string; limits: Record<JarKey, Limit> }

/** Нормативы по умолчанию: СанПиН 1.2.3685-21 (проверить по действующей редакции). */
export const NORMS_SANPIN: NormSet = {
  name: "СанПиН 1.2.3685-21",
  source: "СанПиН 1.2.3685-21 — значения по умолчанию, проверить по действующей редакции",
  limits: {
    turbidityMg: { max: 1.5, active: true },
    color: { max: 20, active: true },
    permanganate: { max: 5.0, active: true },
    al: { max: 0.2, active: true },
    fe: { max: 0.3, active: true },
    pH: { min: 6, max: 9, active: true },
  },
};
/** ГОСТ Р 51642-2000, табл. 1 — требования для модельных растворов (Al для алюмосодержащих коагулянтов). */
export const NORMS_GOST_MODEL: NormSet = {
  name: "ГОСТ Р 51642-2000, табл. 1 (модельные растворы)",
  source: "ГОСТ Р 51642-2000, табл. 1: мутность 1,5 мг/дм³, цветность 20°, Al ≤ 0,5 мг/дм³, Fe ≤ 0,3 мг/дм³, pH 6–9",
  limits: {
    turbidityMg: { max: 1.5, active: true },
    color: { max: 20, active: true },
    permanganate: { max: null, active: false },
    al: { max: 0.5, active: true },
    fe: { max: 0.3, active: false },
    pH: { min: 6, max: 9, active: true },
  },
};

/** Навеска товарного продукта на 1 дм³ рабочего раствора, содержащая 1,0 г Al₂O₃ (п. 5.4.2): m = 1,0·100/C, г. */
export const workingSolutionMass = (cPct: number) => (isNum(cPct) && cPct > 0 ? 100 / cPct : NaN);

export interface RowCheck { dose: number; ok: boolean; fails: string[]; unknown: string[] }

export function checkRow(r: JarRow, n: NormSet): RowCheck | null {
  if (!isNum(r.dose)) return null;
  // строка без единого измерения — доза не испытывалась
  if (!(Object.keys(JAR_PARAMS) as JarKey[]).some((k) => isNum(r.values[k]))) return null;
  const fails: string[] = [], unknown: string[] = [];
  for (const k of Object.keys(JAR_PARAMS) as JarKey[]) {
    const L = n.limits[k];
    if (!L?.active) continue;
    const v = r.values[k];
    const name = JAR_PARAMS[k].label;
    if (!isNum(v)) { unknown.push(name); continue; }
    if (isNum(L.max) && v > L.max) fails.push(`${name} ${v} > ${L.max}`);
    if (isNum(L.min) && v < L.min) fails.push(`${name} ${v} < ${L.min}`);
  }
  return { dose: r.dose, ok: !fails.length && !unknown.length, fails, unknown };
}

export interface JarResult { test: JarTest; checks: RowCheck[]; optimal: number | null }

/** Оптимальная доза опыта: наименьшая доза, при которой все действующие нормативы выполнены и все показатели измерены. */
export function optimalDose(t: JarTest, n: NormSet): JarResult {
  const checks = t.rows.map((r) => checkRow(r, n)).filter((x): x is RowCheck => x !== null).sort((a, b) => a.dose - b.dose);
  const ok = checks.filter((c) => c.ok);
  return { test: t, checks, optimal: ok.length ? ok[0].dose : null };
}

export interface SeasonalDesign {
  results: JarResult[];
  bySeason: { season: Season; optimal: number }[];
  /** Расчётная (проектная) доза — максимальная из оптимальных по периодам; минимум — нижняя граница регулирования. */
  design: number | null;
  min: number | null;
}

export function seasonalDesign(tests: JarTest[], n: NormSet): SeasonalDesign {
  const results = tests.map((t) => optimalDose(t, n));
  const map = new Map<Season, number>();
  for (const r of results) if (r.optimal !== null) map.set(r.test.season, Math.max(map.get(r.test.season) ?? -Infinity, r.optimal));
  const bySeason = [...map.entries()].map(([season, optimal]) => ({ season, optimal }));
  const vals = bySeason.map((s) => s.optimal);
  return { results, bySeason, design: vals.length ? Math.max(...vals) : null, min: vals.length ? Math.min(...vals) : null };
}
