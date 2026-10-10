/**
 * Методики расчёта дозы коагулянта по качеству исходной воды и данным продукта.
 * Методику задаёт пользователь (выражение или таблица) с единицами, областью применимости и основанием.
 * Ядро вычисляет её детерминированно; результат — расчётная доза по методике, а не подтверждённый оптимум.
 */
import { isNum } from "../units/chem";
import { evaluate, identifiers, parse } from "./expr";
import type { Basis, CoagulantType } from "./profiles";

/** Показатели исходной воды, доступные методикам. Единицы фиксированы. */
export const WATER_PARAMS = {
  pH: { label: "pH", unit: "" },
  alkalinity: { label: "Общая щёлочность", unit: "мг-экв/л" },
  temperature: { label: "Температура", unit: "°C" },
  turbidity: { label: "Мутность", unit: "NTU" },
  color: { label: "Цветность", unit: "град. Pt-Co" },
  permanganate: { label: "Перманганатная окисляемость", unit: "мг O₂/л" },
  toc: { label: "Общий органический углерод (TOC)", unit: "мг C/л" },
  uv254: { label: "УФ-поглощение 254 нм", unit: "1/см" },
  tss: { label: "Взвешенные вещества", unit: "мг/л" },
  al: { label: "Al общий", unit: "мг/л" },
  fe: { label: "Fe общее", unit: "мг/л" },
  o2: { label: "Растворённый O₂", unit: "мг/л" },
  fe2: { label: "Fe²⁺", unit: "мг/л" },
} as const;
export type WaterKey = keyof typeof WATER_PARAMS;
export type WaterQuality = Partial<Record<WaterKey, number | null>>;

/** Данные продукта, доступные методикам. */
export const PRODUCT_PARAMS = {
  w_me: { label: "Доля металла в товарном продукте", unit: "доля" },
  basicity: { label: "Основность ПОХА", unit: "%" },
  density: { label: "Плотность товарного продукта", unit: "кг/л" },
} as const;
export type ProductKey = keyof typeof PRODUCT_PARAMS;
export type ProductVars = Partial<Record<ProductKey, number | null>>;

export type MethodModel = "manual" | "expression" | "lookup";

export interface DoseMethod {
  id: string;
  name: string;
  coagulantType: CoagulantType;
  model: MethodModel;
  version: number;
  /** Входы методики с областью применимости. */
  inputs: { key: WaterKey | ProductKey; min?: number | null; max?: number | null }[];
  /** Выражение центральной оценки (для model = expression). */
  expression?: string;
  coefficients: { name: string; value: number; unit: string; basis: string }[];
  /** Таблица по одному входу (для model = lookup). */
  lookup?: { key: WaterKey | ProductKey; rows: { from: number; to: number; low: number; high: number; central?: number | null }[] };
  /** База результата дозы. */
  outputBasis: Basis;
  /** Диапазон вокруг центральной оценки, доли (для выражения). */
  band?: { lower: number; upper: number } | null;
  /** Рабочий диапазон pH коагуляции по методике — критерий необходимости коррекции pH. */
  phWindow?: { min: number | null; max: number | null } | null;
  source: string;
  status: "user" | "demo" | "verified";
  createdAt: string;
}

export const MANUAL_METHOD_ID = (t: CoagulantType) => `manual-${t}`;

export interface MethodResult {
  status: "manual" | "ok" | "nodata" | "outside" | "invalid";
  missing: string[];
  outside: string[];
  errors: string[];
  central: number;
  low: number;
  high: number;
  basis: Basis;
  rows: { label: string; formula: string; result: string }[];
}

const f = (x: number, d = 3) => (isNum(x) ? Number(x.toFixed(d)).toLocaleString("ru-RU", { maximumFractionDigits: d }) : "—");
const labelOf = (k: string) => (k in WATER_PARAMS ? WATER_PARAMS[k as WaterKey] : PRODUCT_PARAMS[k as ProductKey]) ?? { label: k, unit: "" };

/** Проверка записи методики: единицы коэффициентов, область применимости, основание, корректность выражения. */
export function validateMethod(m: DoseMethod): string[] {
  const e: string[] = [];
  if (m.model === "manual") return e;
  if (!m.name.trim()) e.push("Не задано название методики.");
  if (!m.source.trim()) e.push("Не указан источник / основание методики.");
  for (const i of m.inputs) {
    if (!(i.key in WATER_PARAMS) && !(i.key in PRODUCT_PARAMS)) e.push(`Неизвестный вход «${i.key}».`);
    if (!isNum(i.min) || !isNum(i.max)) e.push(`Вход «${labelOf(i.key).label}»: не задана область применимости (min и max).`);
    else if (i.min > i.max) e.push(`Вход «${labelOf(i.key).label}»: min больше max.`);
  }
  if (m.model === "expression") {
    for (const c of m.coefficients) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.name)) e.push(`Некорректное имя коэффициента «${c.name}».`);
      if (!isNum(c.value)) e.push(`Коэффициент ${c.name}: нет значения.`);
      if (!c.unit.trim()) e.push(`Коэффициент ${c.name}: нет единицы.`);
      if (!c.basis.trim()) e.push(`Коэффициент ${c.name}: нет основания.`);
    }
    try {
      const ast = parse(m.expression ?? "");
      const known = new Set([...m.inputs.map((i) => i.key as string), ...m.coefficients.map((c) => c.name)]);
      for (const id of identifiers(ast)) if (!known.has(id)) e.push(`В выражении имя «${id}» не объявлено ни входом, ни коэффициентом.`);
    } catch (err) {
      e.push(`Выражение: ${(err as Error).message}`);
    }
    if (m.band && (!(m.band.lower >= 0 && m.band.lower < 1) || !(m.band.upper >= 0))) e.push("Диапазон: нижняя доля в [0; 1), верхняя ≥ 0.");
  }
  if (m.model === "lookup") {
    if (!m.lookup || !m.lookup.rows.length) e.push("Таблица пуста.");
    else {
      if (!m.inputs.some((i) => i.key === m.lookup!.key)) e.push("Ключ таблицы должен быть объявлен входом методики.");
      m.lookup.rows.forEach((r, i) => {
        if (![r.from, r.to, r.low, r.high].every(isNum)) e.push(`Строка ${i + 1}: не все значения заданы.`);
        else if (r.from >= r.to || r.low > r.high) e.push(`Строка ${i + 1}: нужно «от» < «до» и низ ≤ верх.`);
      });
    }
  }
  if (m.phWindow && isNum(m.phWindow.min) && isNum(m.phWindow.max) && m.phWindow.min > m.phWindow.max) e.push("Рабочий диапазон pH: min больше max.");
  return e;
}

export function evaluateMethod(m: DoseMethod, water: WaterQuality, product: ProductVars): MethodResult {
  const out: MethodResult = { status: "ok", missing: [], outside: [], errors: [], central: NaN, low: NaN, high: NaN, basis: m.outputBasis, rows: [] };
  if (m.model === "manual") { out.status = "manual"; return out; }
  out.errors = validateMethod(m);
  if (out.errors.length) { out.status = "invalid"; return out; }
  out.rows.push({ label: "Методика", formula: `${m.name} · v${m.version} · ${m.model === "expression" ? "выражение" : "таблица"}`, result: m.status === "demo" ? "ДЕМО-пример" : m.status === "verified" ? "проверена" : "задана пользователем" });
  const vars: Record<string, number> = {};
  for (const i of m.inputs) {
    const v = i.key in WATER_PARAMS ? water[i.key as WaterKey] : product[i.key as ProductKey];
    const L = labelOf(i.key);
    if (!isNum(v)) { out.missing.push(L.label); out.rows.push({ label: `Вход: ${L.label}`, formula: `область ${f(i.min ?? NaN)}…${f(i.max ?? NaN)} ${L.unit}`, result: "нет данных" }); continue; }
    vars[i.key] = v;
    const inside = v >= (i.min as number) && v <= (i.max as number);
    if (!inside) out.outside.push(`${L.label} = ${f(v)} ${L.unit} (область ${f(i.min as number)}…${f(i.max as number)})`);
    out.rows.push({ label: `Вход: ${L.label}`, formula: `${f(v)} ${L.unit}; область ${f(i.min as number)}…${f(i.max as number)}`, result: inside ? "в области" : "ВНЕ области" });
  }
  if (out.missing.length) { out.status = "nodata"; return out; }
  if (out.outside.length) { out.status = "outside"; return out; }
  if (m.model === "expression") {
    for (const c of m.coefficients) vars[c.name] = c.value;
    out.central = evaluate(parse(m.expression as string), vars);
    out.rows.push({ label: "Центральная оценка", formula: `${m.expression}`, result: `${f(out.central)} мг/л` });
    if (!isNum(out.central) || out.central < 0) { out.status = "invalid"; out.errors.push("Выражение дало отрицательное или нечисловое значение."); return out; }
    if (m.band) {
      out.low = out.central * (1 - m.band.lower);
      out.high = out.central * (1 + m.band.upper);
      out.rows.push({ label: "Диапазон", formula: `D·(1 − ${f(m.band.lower)}) … D·(1 + ${f(m.band.upper)})`, result: `${f(out.low)}…${f(out.high)} мг/л` });
    } else { out.low = out.central; out.high = out.central; }
  } else {
    const L = m.lookup!;
    const x = vars[L.key];
    const row = L.rows.find((r) => x >= r.from && x < r.to) ?? (x === L.rows[L.rows.length - 1].to ? L.rows[L.rows.length - 1] : undefined);
    if (!row) { out.status = "outside"; out.outside.push(`${labelOf(L.key).label} = ${f(x)}: нет строки таблицы`); return out; }
    out.low = row.low; out.high = row.high; out.central = isNum(row.central) ? row.central : NaN;
    out.rows.push({ label: "Строка таблицы", formula: `${labelOf(L.key).label} ∈ [${f(row.from)}; ${f(row.to)})`, result: `${f(row.low)}…${f(row.high)} мг/л${isNum(row.central) ? `, центр ${f(row.central)}` : ""}` });
  }
  return out;
}

/** Необходимость коррекции pH: по рабочему диапазону pH методики и стехиометрическому балансу щёлочности. */
export function assessPhCorrection(
  water: WaterQuality,
  window: DoseMethod["phWindow"],
  alkalinityConsumedAtMax: number,
): { need: "none" | "acid" | "base" | "unknown"; reasons: string[] } {
  const r: string[] = [];
  const pH = water.pH, alk = water.alkalinity;
  const hasWin = window && isNum(window.min) && isNum(window.max);
  if (!isNum(pH)) return { need: "unknown", reasons: ["pH исходной воды не задан."] };
  let need: "none" | "acid" | "base" | "unknown" = "unknown";
  if (!hasWin) r.push("У методики не задан рабочий диапазон pH — критерия для решения нет.");
  else if (pH < (window!.min as number)) { need = "base"; r.push(`pH ${f(pH, 2)} ниже рабочего диапазона методики ${f(window!.min as number, 2)}–${f(window!.max as number, 2)}: требуется подщелачивание.`); }
  else if (pH > (window!.max as number)) { need = "acid"; r.push(`pH ${f(pH, 2)} выше рабочего диапазона методики ${f(window!.min as number, 2)}–${f(window!.max as number, 2)}: требуется подкисление.`); }
  else { need = "none"; r.push(`Исходный pH ${f(pH, 2)} в рабочем диапазоне методики ${f(window!.min as number, 2)}–${f(window!.max as number, 2)}. Снижение pH при вводе коагулянта не прогнозируется — проверить испытанием.`); }
  if (isNum(alk) && isNum(alkalinityConsumedAtMax)) {
    if (alkalinityConsumedAtMax >= alk) {
      r.push(`Теоретический расход щёлочности при Dmax (${f(alkalinityConsumedAtMax)} мг-экв/л) не меньше щёлочности воды (${f(alk)} мг-экв/л): щёлочи по стехиометрии недостаточно.`);
      if (need === "none" || need === "unknown") need = "base";
    }
  } else r.push("Щёлочность не задана — стехиометрический баланс не выполнен.");
  r.push("Доза кислоты/щёлочи по разности pH не рассчитывается: нужна ручная доза или титрационная кривая.");
  return { need, reasons: r };
}
