/**
 * Встроенные методики расчётной дозы коагулянта по нормативным документам и справочным источникам.
 * Коэффициенты — только из документов (или из ТЗ со ссылкой на вторичный источник, с пометкой о сверке).
 * Результат — расчётная (ориентировочная) доза; проектная доза уточняется пробной коагуляцией и при наладке.
 */
import { ATOMIC, isNum } from "../units/chem";
import { PROFILES, type Basis, type CoagulantType } from "./profiles";
import type { DoseMethod, MethodResult, ProductVars, WaterKey, WaterQuality } from "./doseMethod";
import { metalFraction } from "./profiles";
import { seasonalDesign, workingSolutionMass, SEASONS, type JarTest, type NormSet } from "./jar";

export type DocStatus = "normative" | "reference" | "superseded" | "adapted";
export type FormulaCheck = "text" | "secondary";

export interface BuiltinOption {
  key: string;
  label: string;
  kind: "select" | "number";
  choices?: [string, string][];
  default: string;
  unit?: string;
  hint?: string;
  /** Опция показывается только для этих типов коагулянта. */
  types?: CoagulantType[];
}

export interface Quote { clause: string; text: string; check: FormulaCheck }

export interface BuiltinDef {
  id: string;
  version: number;
  title: string;
  doc: string;
  clause: string;
  fileRef: { file: string; origin: string } | null;
  status: DocStatus;
  /** Для каких типов коагулянта методика применима и как (прямо по документу или пересчётом). */
  coagulants: Partial<Record<CoagulantType, "direct" | "equivalent">>;
  area: string;
  formula: string;
  formulaCheck: FormulaCheck;
  outputBasis: (t: CoagulantType) => Basis;
  options: BuiltinOption[];
  required: (o: Opts) => WaterKey[];
  phWindow?: (t: CoagulantType) => { min: number; max: number; source: string } | null;
  recommendedFor?: ObjectType;
  /** Рекомендация с учётом типа коагулянта (перекрывает recommendedFor). */
  recommended?: Partial<Record<ObjectType, CoagulantType[]>>;
  /** Пояснение статуса (например, нормативная для ТЭС, справочная для ВОС). */
  statusNote?: string;
  /** Части расчёта со статусом «инженерная адаптация». */
  adapted?: string[];
  /** Сообщение для типов коагулянта, к которым методика не применяется. */
  notApplicable?: Partial<Record<CoagulantType, string>>;
  warnings: string[];
  quotes: Quote[];
  evaluate: (t: CoagulantType, w: WaterQuality, o: Opts, ctx?: Ctx) => MethodResult;
}

export type Opts = Record<string, string>;
export interface Ctx { product?: ProductVars; jar?: { tests: JarTest[]; norms: NormSet } }
export type ObjectType = "vos" | "tes" | "other";
export const OBJECT_TYPES: [ObjectType, string][] = [
  ["vos", "ВОС: хозяйственно-питьевое / производственное водоснабжение"],
  ["tes", "ТЭС, котельная: предочистка добавочной воды"],
  ["other", "Другое"],
];

export const BUILTIN_PREFIX = "builtin:";
export const SECONDARY_NOTE = "Формула сверена по вторичному источнику, требуется сверка с официальным текстом.";
export const SECONDARY_SHORT = "формула сверена по вторичному источнику, требуется сверка с официальным текстом";
export const NOT_FINAL = "Не окончательная проектная доза: доза уточняется пробной коагуляцией и при наладке (СП 31.13330.2021, пп. 9.2, 9.15).";

const f = (x: number, d = 3) => (isNum(x) ? Number(x.toFixed(d)).toLocaleString("ru-RU", { maximumFractionDigits: d }) : "—");
const num = (s: string | undefined) => { if (s == null || s.trim() === "") return null; const x = Number(s.replace(",", ".")); return Number.isFinite(x) ? x : NaN; };

/** Молярные массы эквивалента (полный гидролиз Me³⁺: 3 экв на атом металла), г/экв. */
export function eqMass(t: CoagulantType, form: "metal" | "Al2O3" | "salt"): number {
  const P = PROFILES[t];
  const z = P.oxidation === "Fe(II)" ? 2 : 3;
  if (form === "metal") return ATOMIC[P.metal] / z;
  if (form === "Al2O3") return P.metal === "Al" ? (2 * ATOMIC.Al + 3 * ATOMIC.O) / 6 : NaN;
  return P.salt ? P.salt.molarMass / (P.salt.metalAtoms * z) : NaN;
}

const empty = (basis: Basis): MethodResult => ({ status: "ok", missing: [], outside: [], errors: [], central: NaN, low: NaN, high: NaN, basis, rows: [], warnings: [], info: [] });

function need(r: MethodResult, w: WaterQuality, keys: [WaterKey, string, string][]): Record<string, number> {
  const v: Record<string, number> = {};
  for (const [k, label, unit] of keys) {
    const x = w[k];
    if (!isNum(x)) { r.missing.push(label); r.rows.push({ label: `Вход: ${label}`, formula: unit, result: "нет данных" }); }
    else { v[k] = x; r.rows.push({ label: `Вход: ${label}`, formula: unit, result: `${f(x)} ${unit}` }); }
  }
  if (r.missing.length) r.status = "nodata";
  return v;
}

function negative(r: MethodResult, w: WaterQuality, keys: WaterKey[]) {
  for (const k of keys) if (isNum(w[k]) && (w[k] as number) < 0) { r.status = "outside"; r.outside.push(`${k} < 0`); }
}

/** Строки пересчёта дозы из мг-экв/л в массовые базы. */
function meqRows(t: CoagulantType, meq: number): { label: string; formula: string; result: string }[] {
  const P = PROFILES[t];
  const rows = [{ label: `Пересчёт в мг/л ${P.metal}`, formula: `× ${f(eqMass(t, "metal"), 3)} (A/3)`, result: `${f(meq * eqMass(t, "metal"))} мг/л ${P.metal}` }];
  if (P.metal === "Al") rows.push({ label: "Пересчёт в мг/л Al₂O₃", formula: `× ${f(eqMass(t, "Al2O3"), 3)} (M/6)`, result: `${f(meq * eqMass(t, "Al2O3"))} мг/л Al₂O₃` });
  if (P.salt) rows.push({ label: `Пересчёт в мг/л ${P.salt.formula} безв.`, formula: `× ${f(eqMass(t, "salt"), 2)} (M/${P.salt.metalAtoms * 3})`, result: `${f(meq * eqMass(t, "salt"))} мг/л ${P.salt.formula}` });
  return rows;
}

/* ---------------- Методика 1: СНиП 2.04.02-84*, п. 6.16 ---------------- */

export const SNIP_TABLE16: { from: number; to: number; low: number; high: number }[] = [
  { from: 0, to: 100, low: 25, high: 35 },
  { from: 100, to: 200, low: 30, high: 40 },
  { from: 200, to: 400, low: 35, high: 45 },
  { from: 400, to: 600, low: 45, high: 50 },
  { from: 600, to: 800, low: 50, high: 60 },
  { from: 800, to: 1000, low: 60, high: 70 },
  { from: 1000, to: 1500, low: 70, high: 80 },
];
/** Коэффициент Кк по п. 6.65 СНиП 2.04.02-84*. Для Fe₂(SO₄)₃ в пункте не приведён. */
export const SNIP_KK = { purified: 0.5, nepheline: 1.2, FeCl3: 0.7 } as const;

const snip: BuiltinDef = {
  id: "snip-2.04.02-84-6.16",
  version: 1,
  title: "СНиП 2.04.02-84*, п. 6.16 — сульфат алюминия / хлорное железо / сульфат железа(III) (безводные) — по цветности и мутности",
  doc: "СНиП 2.04.02-84* «Водоснабжение. Наружные сети и сооружения»",
  clause: "п. 6.16, формула (6), табл. 16; п. 6.65, формула (11)",
  fileRef: { file: "docs/normative/SNiP_2.04.02-84.txt", origin: "files.stroyinf.ru/Data2/1/4294854/4294854703.htm" },
  status: "superseded",
  coagulants: { "Al2(SO4)3": "direct", FeCl3: "direct", "Fe2(SO4)3": "direct" },
  area: "Хозяйственно-питьевые и производственные водопроводы, поверхностные воды.",
  formula: "Dц = 4·√Ц (ф. 6); Dм — по табл. 16 по мутности М, мг/л; D = max(Dц; Dм); контактные осветлители / фильтры с коагуляцией в загрузке: × (0,85…0,90)",
  formulaCheck: "secondary",
  outputBasis: () => "salt",
  recommendedFor: "vos",
  notApplicable: { PACl: "Методика не распространяется на ПОХА: п. 6.16 СНиП 2.04.02-84* относится только к Al₂(SO₄)₃, FeCl₃, Fe₂(SO₄)₃ по безводному веществу." },
  options: [
    { key: "mode", label: "Определяющий показатель", kind: "select", default: "max", choices: [["max", "мутность и цветность — большая из доз (прим. к п. 6.16)"], ["turbidity", "только мутность — мутные воды (табл. 16)"], ["color", "только цветность — цветные воды (ф. 6)"]] },
    { key: "bound", label: "Значение из диапазона табл. 16", kind: "select", default: "mid", choices: [["low", "нижняя граница (грубодисперсная взвесь, прим. 1)"], ["mid", "середина диапазона"], ["high", "верхняя граница"]] },
    { key: "facility", label: "Тип сооружения", kind: "select", default: "settler", choices: [["settler", "отстойник / осветлитель со взвешенным осадком"], ["contact", "контактный осветлитель / фильтр с коагуляцией в загрузке (−10…15 %, прим. 2)"]] },
    { key: "kk", label: "Коагулянт для Кк (п. 6.65)", kind: "select", default: "purified", choices: [["purified", "очищенный сернокислый алюминий, Кк = 0,5"], ["nepheline", "нефелиновый коагулянт, Кк = 1,2"]], types: ["Al2(SO4)3"] },
    { key: "vn", label: "Вн — нерастворимые вещества с известью", kind: "number", default: "", unit: "мг/л", hint: "пусто — известь не вводится (Вн = 0)" },
  ],
  required: (o) => (o.mode === "color" ? ["color"] : o.mode === "turbidity" ? ["turbidityMg"] : ["color", "turbidityMg"]),
  warnings: [
    "Методика из отменённого документа (СНиП 2.04.02-84* заменён СП 31.13330), применяется как справочная / для предварительной оценки; проектная доза — по пробной коагуляции (СП 31.13330.2021, пп. 9.2, 9.15).",
    "Доза — по безводному веществу. Мутность — в мг/л (по каолину); пересчёт из NTU сервис не выполняет.",
  ],
  quotes: [
    { clause: "п. 6.16", check: "text", text: "Дозу коагулянта Дк, мг/л, в расчете на Al₂(SO₄)₃, FeCl₃, Fe₂(SO₄)₃ (по безводному веществу) допускается принимать при обработке: мутных вод — по табл. 16, цветных вод — по формуле (6), где Ц — цветность обрабатываемой воды, град. Примечание. При одновременном содержании в воде взвешенных веществ и цветности принимается большая из доз коагулянта, определенных по табл. 16 и формуле (6)." },
    { clause: "формула (6)", check: "secondary", text: "Дк = 4·√Ц — в тексте-источнике формула не воспроизведена (была изображением). " + SECONDARY_NOTE },
    { clause: "табл. 16", check: "text", text: "Мутность воды, мг/л → доза безводного коагулянта, мг/л: до 100 — 25–35; св. 100 до 200 — 30–40; 200–400 — 35–45; 400–600 — 45–50; 600–800 — 50–60; 800–1000 — 60–70; 1000–1500 — 70–80. Примечания: 1. Меньшие значения доз относятся к воде, содержащей грубодисперсную взвесь. 2. При применении контактных осветлителей или фильтров, работающих по принципу коагуляции в зоне фильтрующей загрузки, дозу коагулянта следует принимать на 10—15 % меньше, чем по табл. 16 и формуле (6)." },
    { clause: "п. 6.65, формула (11)", check: "secondary", text: "Св = М + Кк·Дк + 0,25·Ц + Вн — формула не воспроизведена в тексте-источнике; " + SECONDARY_NOTE + " Экспликация по тексту: М — количество взвешенных веществ в исходной воде, г/м³ (принимается равным мутности воды); Дк — доза коагулянта по безводному продукту, г/м³; Кк — коэффициент, принимаемый для очищенного сернокислого алюминия — 0,5, для нефелинового коагулянта — 1,2, для хлорного железа — 0,7; Ц — цветность исходной воды, град; Вн — количество нерастворимых веществ, вводимых с известью, г/м³." },
  ],
  evaluate(t, w, o) {
    const r = empty("salt");
    const P = PROFILES[t];
    if (!this.coagulants[t]) { r.status = "invalid"; r.errors.push(this.notApplicable?.[t] ?? `Методика не применяется к ${P.label}.`); return r; }
    const mode = o.mode ?? "max", bound = o.bound ?? "mid", facility = o.facility ?? "settler";
    const keys: [WaterKey, string, string][] = [];
    if (mode !== "turbidity") keys.push(["color", "Цветность Ц", "град"]);
    if (mode !== "color") keys.push(["turbidityMg", "Мутность М (по каолину)", "мг/л"]);
    const v = need(r, w, keys);
    negative(r, w, ["color", "turbidityMg"]);
    if (r.status !== "ok") return r;
    let low = 0, high = 0, central = 0;
    const parts: string[] = [];
    if (mode !== "turbidity") {
      const dc = 4 * Math.sqrt(v.color);
      r.rows.push({ label: "По цветности, ф. (6)", formula: `Dц = 4·√${f(v.color)}`, result: `${f(dc)} мг/л` });
      low = high = central = dc; parts.push("Dц");
    }
    if (mode !== "color") {
      const M = v.turbidityMg;
      const row = SNIP_TABLE16.find((x) => M <= x.to && (x.from === 0 ? M >= 0 : M > x.from));
      if (!row) { r.status = "outside"; r.outside.push(`мутность ${f(M)} мг/л > 1500 мг/л — вне табл. 16`); return r; }
      const pick = bound === "low" ? row.low : bound === "high" ? row.high : (row.low + row.high) / 2;
      r.rows.push({ label: "По мутности, табл. 16", formula: `М = ${f(M)} мг/л ∈ ${row.from === 0 ? "до" : `св. ${row.from} до`} ${row.to}`, result: `${f(row.low)}–${f(row.high)} мг/л; принято ${f(pick)} (${bound === "low" ? "нижняя" : bound === "high" ? "верхняя" : "середина"})` });
      if (mode === "max") {
        const dc = central;
        low = Math.max(row.low, dc); high = Math.max(row.high, dc); central = Math.max(pick, dc);
        r.rows.push({ label: "Принимается большая из доз (прим. к п. 6.16)", formula: `max(${f(row.low)}–${f(row.high)}; ${f(dc)})`, result: `${f(low)}–${f(high)} мг/л; центр ${f(central)}` });
      } else { low = row.low; high = row.high; central = pick; }
      parts.push("Dм");
    }
    if (facility === "contact") {
      r.rows.push({ label: "Контактный осветлитель / фильтр (прим. 2 к табл. 16)", formula: "−10…15 %: низ × 0,85, верх × 0,90, центр × 0,875", result: `${f(low * 0.85)}–${f(high * 0.9)} мг/л` });
      low *= 0.85; high *= 0.9; central *= 0.875;
    }
    r.low = low; r.high = high; r.central = central;
    r.rows.push({ label: "Расчётная доза", formula: `мг/л ${P.salt?.formula} безв.`, result: `${f(low)}…${f(high)}; центр ${f(central)}` });
    // Св по п. 6.65 — связанный расчёт (взвесь, поступающая в отстойник)
    const kk = t === "FeCl3" ? SNIP_KK.FeCl3 : t === "Al2(SO4)3" ? (o.kk === "nepheline" ? SNIP_KK.nepheline : SNIP_KK.purified) : null;
    const vn = num(o.vn);
    if (isNum(w.turbidityMg) && isNum(w.color) && kk != null && (vn === null || isNum(vn))) {
      const Vn = vn ?? 0;
      const cv = (w.turbidityMg as number) + kk * central + 0.25 * (w.color as number) + Vn;
      r.rows.push({ label: "Взвесь, поступающая в отстойник, п. 6.65 ф. (11)", formula: `Св = ${f(w.turbidityMg as number)} + ${f(kk)}·${f(central)} + 0,25·${f(w.color as number)} + ${f(Vn)}${vn === null ? " (известь не вводится)" : ""}`, result: `${f(cv, 1)} мг/л` });
      r.info!.push(`Взвесь, поступающая в отстойник (п. 6.65, ф. (11); ${SECONDARY_SHORT}): Св ≈ ${f(cv, 1)} мг/л.`);
    } else if (t === "Fe2(SO4)3") r.rows.push({ label: "Св по п. 6.65", formula: "Кк для Fe₂(SO₄)₃ в п. 6.65 не приведён", result: "не рассчитывается" });
    if (isNum(w.color) && isNum(w.permanganate) && (w.permanganate as number) > 1 && (w.color as number) > 0) {
      const g = Math.log(w.color as number) / Math.log(w.permanganate as number);
      r.info!.push(`Для этой воды Ц ≈ ПО^γ даёт γ = ${f(g, 2)}. По статье ЗХР (2020) γ ≈ 1,3–2,4 по водоисточникам, а формула (6) фактически предполагает γ = 2; для низкомутных цветных вод доза по окисляемости точнее, чем по цветности.`);
    }
    r.warnings!.push(...this.warnings, NOT_FINAL);
    if (parts.length) r.info!.push(`Формула (6): ${SECONDARY_SHORT}. Табл. 16 — по тексту документа.`);
    return r;
  },
};

/* ---------------- Методика 2: РД 153-34.1-37.502-2000, п. 7.4 ---------------- */

export const RD_K = 0.07;
export const RD_TYPICAL = { min: 0.3, max: 1.5 } as const;

const rd: BuiltinDef = {
  id: "rd-153-34.1-37.502-2000-7.4",
  version: 1,
  title: "РД 153-34.1-37.502-2000, п. 7.4 — сульфат алюминия (по эквиваленту) — по перманганатной окисляемости",
  doc: "РД 153-34.1-37.502-2000 «Методические указания по очистке исходной воды коагулянтами на ТЭС»",
  clause: "п. 7.4 (ориентировочная формула); п. 6.5 (диапазон 0,3–1,5 мг-экв/л); п. 6.4 (pH 5,5–7,5)",
  fileRef: { file: "docs/normative/RD_153-34.1-37.502-2000.txt", origin: "meganorm.ru/Data2/1/4294812/4294812827.htm" },
  status: "normative",
  coagulants: { "Al2(SO4)3": "direct", FeCl3: "equivalent", "Fe2(SO4)3": "equivalent" },
  area: "Предочистка исходной воды на ТЭС и котельных, поверхностные источники. Основная методика для энергетики: СП 31.13330.2021 не распространяется на водоподготовку теплоэнергетических объектов.",
  formula: "Dк = 0,07·ПО, мг-экв/л; ПО — перманганатная окисляемость, мг O₂/л",
  formulaCheck: "secondary",
  outputBasis: (t) => (PROFILES[t].metal === "Al" ? "Al2O3" : "salt"),
  recommendedFor: "tes",
  options: [],
  required: () => ["permanganate"],
  phWindow: (t) => (PROFILES[t].metal === "Al" ? { min: 5.5, max: 7.5, source: "РД 153-34.1-37.502-2000, п. 6.4" } : null),
  warnings: [
    "Формула не учитывает pH и щёлочность.",
    "Доза принимается по результатам пробной коагуляции или по данным эксплуатации установок на той же исходной воде (п. 7.4).",
    "Проверить достаточность щёлочности для гидролиза коагулянта; при нехватке — подщелачивание (п. 6.7.1).",
  ],
  quotes: [
    { clause: "п. 6.4", check: "text", text: "Для полноты выделения гидроксида алюминия величина рН коагулированной воды должна находится в пределах 5,5 - 7,5. Оптимальная величина рН (в указанных пределах) устанавливается экспериментально для каждого водоисточника и для каждого характерного периода года при изменении качества воды в источнике по сезонам." },
    { clause: "п. 6.5", check: "text", text: "Как правило, требуемые дозы коагулянта находятся в пределах 0,3 - 1,5 мг-экв/л, устанавливаются экспериментально для каждого водоисточника в различные характерные периоды года в лабораторных условиях и уточняются при эксплуатации по результатам обработки воды." },
    { clause: "п. 7.4", check: "text", text: "Дозу коагулянта следует принимать по результатам пробной коагуляции воды или по данным эксплуатации водоподготовительных установок, использующих ту же исходную воду. При отсутствии экспериментальных данных можно использовать ориентировочную формулу [...], где О₂ - перманганатная окисляемость исходной воды в мг/л О₂." },
    { clause: "п. 7.4, формула", check: "secondary", text: "Дк = 0,07·ПО, мг-экв/л — в тексте-источнике формула не воспроизведена (была изображением). " + SECONDARY_NOTE },
  ],
  evaluate(t, w) {
    const P = PROFILES[t];
    const r = empty(this.outputBasis(t));
    const how = this.coagulants[t];
    if (!how) { r.status = "invalid"; r.errors.push(`Методика не применяется к ${P.label}.`); return r; }
    const v = need(r, w, [["permanganate", "Перманганатная окисляемость ПО", "мг O₂/л"]]);
    negative(r, w, ["permanganate"]);
    if (r.status !== "ok") return r;
    const meq = RD_K * v.permanganate;
    r.rows.push({ label: "Ориентировочная доза, п. 7.4", formula: `Dк = 0,07 · ${f(v.permanganate)}`, result: `${f(meq)} мг-экв/л` });
    r.rows.push(...meqRows(t, meq));
    const conv = P.metal === "Al" ? eqMass(t, "Al2O3") : eqMass(t, "salt");
    r.central = r.low = r.high = meq * conv;
    const inRange = meq >= RD_TYPICAL.min && meq <= RD_TYPICAL.max;
    r.rows.push({ label: "Проверка по п. 6.5", formula: `типовой диапазон ${f(RD_TYPICAL.min)}–${f(RD_TYPICAL.max)} мг-экв/л`, result: inRange ? "в диапазоне" : "ВНЕ типового диапазона" });
    if (!inRange) r.warnings!.push(`Доза ${f(meq)} мг-экв/л вне типового диапазона 0,3–1,5 мг-экв/л (РД, п. 6.5): проверить исходные данные и выполнить пробную коагуляцию.`);
    if (how === "equivalent") r.warnings!.push(`Для ${P.label} доза показана как пересчёт по эквиваленту, а не как прямое требование РД (методика РД — для алюминийсодержащих коагулянтов).`);
    if (isNum(w.permanganate) && (w.permanganate as number) >= 100) r.warnings!.push("Метод перманганатной окисляемости применяется для вод с окисляемостью ниже 100 мгО/л (РД, п. 3.2.2).");
    r.warnings!.push(...this.warnings, NOT_FINAL);
    r.info!.push(`Формула п. 7.4: ${SECONDARY_SHORT}. Диапазон п. 6.5 и pH п. 6.4 — по тексту документа.`);
    return r;
  },
};

/* ---------------- Справочные методики (без нормативного статуса) ---------------- */

const rodriguez: BuiltinDef = {
  id: "ref-rodriguez-2000",
  version: 1,
  title: "Rodriguez et al., 2000 — сульфат алюминия (по Al₂O₃) — по TOC, щёлочности и pH",
  doc: "J. Water Supply: Research and Technology – AQUA, 49:2, 57–73 (2000)",
  clause: "регрессионная зависимость",
  fileRef: null,
  status: "reference",
  coagulants: { "Al2(SO4)3": "direct" },
  area: "Справочно, без нормативного статуса.",
  formula: "D = 3,25 + 0,8·TOC + 2,5·[HCO₃⁻] + 0,25·pH, мг/л Al₂O₃; TOC — мг/л, [HCO₃⁻] — мг-экв/л",
  formulaCheck: "secondary",
  outputBasis: () => "Al2O3",
  options: [],
  required: () => ["toc", "alkalinity", "pH"],
  warnings: [
    "Справочно, без нормативного статуса.",
    "Область применимости регрессии по первоисточнику в сервис не внесена — сверить с публикацией.",
  ],
  quotes: [{ clause: "формула", check: "secondary", text: "D = 3,25 + 0,8·TOC + 2,5·[HCO₃⁻] + 0,25·pH (мг/л Al₂O₃) — по ТЗ сервиса со ссылкой на публикацию; " + SECONDARY_NOTE }],
  evaluate(t, w) {
    const r = empty("Al2O3");
    if (!this.coagulants[t]) { r.status = "invalid"; r.errors.push(`Методика не применяется к ${PROFILES[t].label}.`); return r; }
    const v = need(r, w, [["toc", "TOC", "мг C/л"], ["alkalinity", "[HCO₃⁻] = общая щёлочность", "мг-экв/л"], ["pH", "pH", ""]]);
    negative(r, w, ["toc", "alkalinity"]);
    if (r.status !== "ok") return r;
    const d = 3.25 + 0.8 * v.toc + 2.5 * v.alkalinity + 0.25 * v.pH;
    r.rows.push({ label: "Доза по регрессии", formula: `3,25 + 0,8·${f(v.toc)} + 2,5·${f(v.alkalinity)} + 0,25·${f(v.pH)}`, result: `${f(d)} мг/л Al₂O₃` });
    r.central = r.low = r.high = d;
    r.warnings!.push(v.pH > 8.3 ? "pH > 8,3: принятие [HCO₃⁻] равной общей щёлочности некорректно (есть карбонаты) — задайте воду с pH ≤ 8,3 или уточните [HCO₃⁻]." : "[HCO₃⁻] принят равным общей щёлочности (корректно при pH ≤ 8,3).");
    r.warnings!.push(...this.warnings, NOT_FINAL);
    r.info!.push(SECONDARY_NOTE);
    return r;
  },
};

export const ZXR_K = 0.9;
export const ZXR_SLUDGE = 3.5;

const zxr: BuiltinDef = {
  id: "ref-zxr-2020-po",
  version: 1,
  title: "ЗХР, эмпирическая — сульфат алюминия (по Al₂O₃) — по снижению перманганатной окисляемости",
  doc: "Статья ЗХР «Проблематика определения доз коагулянтов по цветности и перманганатной окисляемости» (zxr.ru, 16.10.2020)",
  clause: "эмпирическая зависимость",
  fileRef: null,
  status: "reference",
  coagulants: { "Al2(SO4)3": "direct" },
  area: "Справочно, без нормативного статуса. Для низкомутных цветных вод окисляемость точнее цветности.",
  formula: "D(Al₂O₃) = 0,9·(ПОисх − ПОкон), мг/л; органический шлам ≈ 3,5 мг на 1 мг Al₂O₃",
  formulaCheck: "secondary",
  outputBasis: () => "Al2O3",
  options: [{ key: "poTarget", label: "Целевая ПО после коагуляции, ПОкон", kind: "number", default: "", unit: "мг O₂/л", hint: "обязательно для этой методики" }],
  required: () => ["permanganate"],
  warnings: ["Справочно, без нормативного статуса."],
  quotes: [{ clause: "формула", check: "secondary", text: "D(Al₂O₃) = 0,9·(ПОисх − ПОкон), мг/л; шлам ≈ 3,5 мг на 1 мг Al₂O₃ — по ТЗ сервиса со ссылкой на статью; " + SECONDARY_NOTE }],
  evaluate(t, w, o) {
    const r = empty("Al2O3");
    if (!this.coagulants[t]) { r.status = "invalid"; r.errors.push(`Методика не применяется к ${PROFILES[t].label}.`); return r; }
    const v = need(r, w, [["permanganate", "ПОисх", "мг O₂/л"]]);
    const target = num(o.poTarget);
    if (target === null) { r.missing.push("Целевая ПО после коагуляции"); r.status = "nodata"; }
    else if (!isNum(target)) { r.errors.push("Целевая ПО — не число."); r.status = "invalid"; }
    if (r.status !== "ok") return r;
    if ((target as number) < 0 || (target as number) >= v.permanganate) { r.status = "outside"; r.outside.push(`ПОкон = ${f(target as number)} должна быть в [0; ПОисх)`); return r; }
    const d = ZXR_K * (v.permanganate - (target as number));
    r.rows.push({ label: "Доза по снижению ПО", formula: `0,9·(${f(v.permanganate)} − ${f(target as number)})`, result: `${f(d)} мг/л Al₂O₃` });
    r.rows.push({ label: "Органический шлам (оценка)", formula: `≈ 3,5 · ${f(d)}`, result: `${f(ZXR_SLUDGE * d, 1)} мг/л` });
    r.central = r.low = r.high = d;
    r.info!.push(`Оценка органического шлама ≈ ${f(ZXR_SLUDGE * d, 1)} мг/л (3,5 мг на 1 мг Al₂O₃).`, SECONDARY_NOTE);
    r.warnings!.push(...this.warnings, NOT_FINAL);
    return r;
  },
};

/* ---------------- ПОХА (полиоксихлорид алюминия) по ГОСТ 34879-2022 ---------------- */

/** Коэффициент пересчёта Al₂O₃ на Al (ГОСТ 34879-2022, прил. Ж). */
export const AL2O3_TO_AL = 0.5292;
/** Кщ по СНиП 2.04.02-84*, п. 6.19 (СП 31.13330.2021, п. 9.16): известь по CaO — 28, сода по Na₂CO₃ — 53. */
export const K_ALK = { CaO: 28, Na2CO3: 53 } as const;
export const ALK_ADAPT_NOTE = "Замена Дк/ек на ΔЩ — инженерная адаптация для ПОХА; в нормативе эквивалентные массы даны только для сульфата алюминия и солей железа.";
const PRELIM_BANNER = "Предварительная оценка, не является проектной дозой по ГОСТ Р 51642-2000.";

/** Массовая доля Al₂O₃ в товарном продукте, % — из доли металла паспорта. */
function cAl2O3(t: CoagulantType, ctx?: Ctx): number {
  const wme = ctx?.product?.w_me;
  return isNum(wme) ? (wme / metalFraction(t, "Al2O3")) * 100 : NaN;
}

/** ПОХА-1: доза по РД п. 7.4, товарный продукт, расход щёлочи (адаптация). */
function evalPacl1(t: CoagulantType, w: WaterQuality, o: Opts, ctx: Ctx | undefined, r: MethodResult) {
  const v = need(r, w, [["permanganate", "Перманганатная окисляемость ПО", "мг O₂/л"]]);
  negative(r, w, ["permanganate", "alkalinity"]);
  if (r.status !== "ok") return;
  const deq = RD_K * v.permanganate;
  const dox = deq * eqMass(t, "Al2O3");
  r.rows.push({ label: "1. Доза по эквиваленту, РД п. 7.4", formula: `Dэкв = 0,07 · ${f(v.permanganate)}`, result: `${f(deq)} мг-экв/л` });
  const inRange = deq >= RD_TYPICAL.min && deq <= RD_TYPICAL.max;
  r.rows.push({ label: "2. Проверка, РД п. 6.5", formula: "0,3–1,5 мг-экв/л", result: inRange ? "в диапазоне" : "ВНЕ типового диапазона" });
  if (!inRange) r.warnings!.push(`Dэкв = ${f(deq)} мг-экв/л вне типового диапазона 0,3–1,5 мг-экв/л (РД, п. 6.5): обязательна пробная коагуляция.`);
  r.rows.push({ label: "3. Доза по Al₂O₃ (основная база, ГОСТ Р 51642-2000)", formula: `${f(deq)} × ${f(eqMass(t, "Al2O3"), 2)} (102/6)`, result: `${f(dox)} мг/л Al₂O₃` });
  r.rows.push({ label: "   то же по Al (ГОСТ 34879-2022, прил. Ж)", formula: `${f(dox)} × ${AL2O3_TO_AL.toString().replace(".", ",")}`, result: `${f(dox * AL2O3_TO_AL)} мг/л Al` });
  const C = cAl2O3(t, ctx), rho = ctx?.product?.density ?? null;
  if (isNum(C) && C > 0) {
    const dt = (dox * 100) / C;
    r.rows.push({ label: "4. Товарный продукт", formula: `${f(dox)} × 100 / ${f(C, 2)} %`, result: `${f(dt, 2)} мг/л (г/м³)` });
    if (isNum(rho) && rho > 0) r.rows.push({ label: "   объём товарного продукта", formula: `${f(dt, 2)} / ${f(rho, 3)}`, result: `${f(dt / rho, 1)} мл/м³` });
    r.rows.push({ label: "   рабочий раствор по ГОСТ Р 51642-2000, п. 5.4.2", formula: `m = 1,0 · 100 / ${f(C, 2)}`, result: `${f(workingSolutionMass(C), 2)} г товарного продукта на 1 дм³ (1 см³ на 1 дм³ пробы = 1 мг/дм³ Al₂O₃)` });
  } else r.rows.push({ label: "4. Товарный продукт", formula: "нужна доля Al₂O₃ в паспорте продукта", result: "не рассчитан" });
  // 5. Щёлочь — инженерная адаптация
  const B = ctx?.product?.basicity, alk = w.alkalinity;
  if (isNum(B) && isNum(alk)) {
    const dAlk = deq * (1 - B / 100), rest = alk - dAlk;
    const reag = o.alkali === "Na2CO3" ? "Na2CO3" : "CaO";
    const K = K_ALK[reag];
    const dsh = K * (dAlk - alk) + 1;
    r.rows.push({ label: "5. Снижение щёлочности (адаптация)", formula: `ΔЩ = ${f(deq)} · (1 − ${f(B)}/100)`, result: `${f(dAlk)} мг-экв/л` });
    r.rows.push({ label: "   остаточная щёлочность", formula: `Щост = ${f(alk)} − ${f(dAlk)}`, result: `${f(rest)} мг-экв/л` });
    r.rows.push({ label: `   подщелачивание, СНиП п. 6.19 (${reag === "CaO" ? "известь по CaO" : "сода по Na₂CO₃"}), адаптация`, formula: `Дщ = ${K} · (${f(dAlk)} − ${f(alk)}) + 1`, result: dsh > 0 ? `${f(dsh, 2)} мг/л — требуется` : `${f(dsh, 2)} ≤ 0 — не требуется` });
    if (dsh > 0) r.warnings!.push(`По адаптированной формуле СНиП п. 6.19 требуется подщелачивание: Дщ ≈ ${f(dsh, 2)} мг/л ${reag === "CaO" ? "CaO" : "Na₂CO₃"}.`);
    if (rest < 1) r.warnings!.push(`Остаточная щёлочность ${f(rest)} мг-экв/л ниже 0,5–1 мг-экв/л — проверить необходимость подщелачивания пробной коагуляцией.`);
    r.warnings!.push(ALK_ADAPT_NOTE);
  } else r.rows.push({ label: "5. Расход щёлочи", formula: "нужны щёлочность воды Щ₀ и основность B из паспорта", result: "не рассчитан" });
  if (isNum(w.turbidityMg) && (w.turbidityMg as number) > 50) r.warnings!.push("Мутная вода (М > 50–100 мг/л): окисляемость не отражает нагрузку — требуется пробное коагулирование.");
  r.central = r.low = r.high = dox;
}

const pacl1: BuiltinDef = {
  id: "rd-153-34.1-37.502-2000-7.4-pacl",
  version: 1,
  title: "РД 153-34.1-37.502-2000, п. 7.4 — полиоксихлорид алюминия (ПОХА) по ГОСТ 34879-2022 — по перманганатной окисляемости",
  doc: "РД 153-34.1-37.502-2000; ГОСТ 34879-2022; ГОСТ Р 51642-2000",
  clause: "РД пп. 5.2.1 (табл. 1), 5.2.4, 6.5, 7.4; ГОСТ 34879-2022 п. 4.1, прил. Б, Ж; ГОСТ Р 51642-2000 п. 5.4.2; СНиП 2.04.02-84* п. 6.19 (СП 31.13330.2021 п. 9.16)",
  fileRef: { file: "docs/normative/RD_153-34.1-37.502-2000.txt", origin: "meganorm.ru/Data2/1/4294812/4294812827.htm" },
  status: "normative",
  statusNote: "Нормативная для предочистки на ТЭС и в котельных; для ВОС — справочно, только предварительная оценка до пробного коагулирования.",
  adapted: ["Расход щёлочи: ΔЩ = Dэкв·(1 − B/100) и подстановка ΔЩ вместо Дк/ек в формулу (7) СНиП п. 6.19"],
  coagulants: { PACl: "direct" },
  area: "Ни один действующий нормативный документ РФ не содержит формулы дозы ПОХА по показателям исходной воды. Ориентировочная формула есть только в отраслевом РД (п. 7.4) — для коагулянтов вообще; оксихлорид алюминия входит в перечень РД (п. 5.2.1, табл. 1; п. 5.2.4).",
  formula: "Dэкв = 0,07·ПО, мг-экв/л; DAl₂O₃ = 17·Dэкв ≈ 1,19·ПО; DAl = 0,5292·DAl₂O₃; Dтов = DAl₂O₃·100/C; Vтов = Dтов/ρ; ΔЩ = Dэкв·(1 − B/100); Дщ = Кщ·(ΔЩ − Щ₀) + 1",
  formulaCheck: "secondary",
  outputBasis: () => "Al2O3",
  recommended: { tes: ["PACl"] },
  options: [{ key: "alkali", label: "Подщелачивающий реагент", kind: "select", default: "CaO", choices: [["CaO", "известь (по CaO), Кщ = 28"], ["Na2CO3", "сода (по Na₂CO₃), Кщ = 53"]] }],
  required: () => ["permanganate", "alkalinity"],
  warnings: [
    "Формула РД не учитывает pH, температуру, мутность и фракционный состав органики — оценка приблизительная.",
    "Высокоосновный ПОХА на практике часто работает при меньших дозах Al₂O₃, чем сульфат алюминия, — формула РД даёт консервативную оценку сверху; итоговая доза — по пробной коагуляции.",
    "Для мутных вод (М > 50–100 мг/л) окисляемость не отражает нагрузку — требуется пробное коагулирование.",
  ],
  quotes: [
    { clause: "РД п. 5.2.1, табл. 1", check: "text", text: "Оксихлорид алюминия Al₂(ОН)ₙCl₍₆₋ₙ₎ — содержание Al₂O₃ 40–44 вес. % (табл. 1 «Алюминий содержащие коагулянты»)." },
    { clause: "РД п. 5.2.4", check: "text", text: "Оксихлорид алюминия — это продукт гидролиза хлорида алюминия, в котором степень основности определяется как отношение количества ОН-группы к числу атомов алюминия. Преимущество этого реагента перед сульфатом алюминия заключается в том, что он лишь минимально увеличивает содержание в коагулированной воде анионов сильных кислот и эффективно работает в более широком диапазоне рН." },
    { clause: "РД п. 6.5", check: "text", text: "Как правило, требуемые дозы коагулянта находятся в пределах 0,3 - 1,5 мг-экв/л, устанавливаются экспериментально для каждого водоисточника в различные характерные периоды года в лабораторных условиях и уточняются при эксплуатации по результатам обработки воды." },
    { clause: "РД п. 7.4", check: "secondary", text: "Дозу коагулянта следует принимать по результатам пробной коагуляции воды или по данным эксплуатации водоподготовительных установок, использующих ту же исходную воду. При отсутствии экспериментальных данных можно использовать ориентировочную формулу [Dк = 0,07·ПО, мг-экв/л — в тексте-источнике формула не воспроизведена; коэффициент сверен по лекционным материалам ТПУ; требуется сверка с официальным текстом РД]." },
    { clause: "ГОСТ 34879-2022, п. 4.1", check: "text", text: "Товарная форма ПОХА — жидкая или твердая в зависимости от концентрации основного вещества в пересчете на Al₂O₃ (от 7,0 % до 50,0 %)." },
    { clause: "ГОСТ 34879-2022, прил. Ж", check: "text", text: "Основность В, %, — отношение молярных содержаний гидроксид-ионов и ионов алюминия: В = [ОН⁻] / (3·[Al³⁺]) · 100 (Ж.1). ... 0,5292 — коэффициент пересчета Al₂O₃ на Al." },
    { clause: "ГОСТ Р 51642-2000, п. 5.4.2", check: "text", text: "Для приготовления рабочего раствора пробу коагулянта, содержащую 1,0 г оксида (III), переносят в мерную колбу вместимостью 1 дм³, доводят объем раствора дистиллированной водой до метки и перемешивают." },
    { clause: "СНиП 2.04.02-84*, п. 6.19, ф. (7)", check: "text", text: "Дозы подщелачивающих реагентов Дщ, мг/л, необходимых для улучшения процесса хлопьеобразования, надлежит определять по формуле Дщ = Кщ(Дк/ек − Щ₀) + 1, где Дк — максимальная в период подщелачивания доза безводного коагулянта, мг/л; ек — эквивалентная масса коагулянта (безводного), мг/мг-экв, принимаемая для Al₂(SO₄)₃ – 57, FeCl₃ – 54, Fe₂(SO₄)₃ – 67; Кщ — коэффициент, равный для извести (по СаО) — 28, для соды (по Na₂CO₃) — 53; Щ₀ — минимальная щелочность воды, мг-экв/л." },
  ],
  evaluate(t, w, o, ctx) {
    const r = empty("Al2O3");
    if (!this.coagulants[t]) { r.status = "invalid"; r.errors.push(`Методика не применяется к ${PROFILES[t].label}.`); return r; }
    evalPacl1(t, w, o, ctx, r);
    if (r.status !== "ok") return r;
    if (o.objectType === "vos") r.warnings!.push("Для ВОС методика справочная: предварительная оценка до пробного коагулирования по ГОСТ Р 51642-2000, прил. А.");
    r.warnings!.push(...this.warnings, NOT_FINAL);
    r.info!.push(`Формула п. 7.4: ${SECONDARY_SHORT} (коэффициент сверен по лекционным материалам ТПУ).`);
    return r;
  },
};

const jar: BuiltinDef = {
  id: "gost-r-51642-2000-a-jar",
  version: 1,
  title: "ГОСТ Р 51642-2000, приложение А; СП 31.13330.2021, пп. 9.2, 9.15 — оптимальная доза по пробному коагулированию",
  doc: "ГОСТ Р 51642-2000 «Коагулянты для хозяйственно-питьевого водоснабжения. Общие требования и метод определения эффективности»; СП 31.13330.2021",
  clause: "ГОСТ Р 51642-2000 пп. 3.7, 5.4.2, табл. 1, прил. А (А.3–А.5); СП 31.13330.2021 пп. 9.2, 9.15",
  fileRef: { file: "docs/normative/GOST_R_51642-2000.pdf", origin: "приложенный файл" },
  status: "normative",
  statusNote: "Основная методика для проектной дозы на ВОС (питьевая вода).",
  coagulants: { PACl: "direct", "Al2(SO4)3": "direct" },
  area: "Хозяйственно-питьевое водоснабжение. Доза в пересчёте на оксид Al₂O₃ (п. 3.7). Железосодержащие коагулянты (база Fe₂O₃) в сервисе пока не поддержаны.",
  formula: "Dопт = min{ D : все нормативы выполнены } по серии 1, 2, 3…n мг/дм³ Al₂O₃; Dпроект = max по периодам года; m = 1,0·100/C г на 1 дм³ рабочего раствора",
  formulaCheck: "text",
  outputBasis: () => "Al2O3",
  recommended: { vos: ["PACl"], tes: [] },
  options: [],
  required: () => [],
  warnings: [
    "Оптимальная доза — наименьшая, обеспечивающая все нормативы (ГОСТ Р 51642-2000, п. 3.7, А.5); неизмеренный нормируемый показатель не позволяет принять дозу.",
    "Нормативы — редактируемый справочник; по умолчанию значения СанПиН 1.2.3685-21 — проверить по действующей редакции.",
    "В проект — максимальная из оптимальных доз по характерным периодам года и диапазон регулирования дозаторов (СП 31.13330.2021, п. 9.15).",
  ],
  quotes: [
    { clause: "п. 3.7", check: "text", text: "Оптимальная доза коагулянта: Наименьшее количество коагулянта в пересчете на оксид (III) основного вещества, мг/дм³, необходимое для достижения нормативов [1] по мутности, цветности, перманганатной окисляемости, алюминию, железу и водородному показателю в 1 дм³ воды источника водоснабжения." },
    { clause: "п. 5.4.2", check: "text", text: "Для приготовления рабочего раствора пробу коагулянта, содержащую 1,0 г оксида (III), переносят в мерную колбу вместимостью 1 дм³, доводят объем раствора дистиллированной водой до метки и перемешивают." },
    { clause: "табл. 1", check: "text", text: "Модельная суспензия мутности: мутность 1,5 мг/дм³; цветность не более 20°; алюминий для алюмосодержащих коагулянтов не более 0,5 мг/дм³; железо для железосодержащих не более 0,3 мг/дм³; pH в пределах 6–9." },
    { clause: "А.3", check: "text", text: "Испытания проводят при температурах (4 ± 1) °С и (20 ± 1) °С. Допускается проводить испытания при температуре, равной температуре воды источника водоснабжения, поступающей на стадию коагуляции. Перед проведением испытаний в воде источника водоснабжения определяют мутность, цветность, железо, алюминий, перманганатную окисляемость и водородный показатель." },
    { clause: "А.4.2–А.4.5", check: "text", text: "Скорость перемешивания — 140 об/мин. ... В первый, второй, третий ... n-ный стаканы ... добавляют соответственно по 1, 2, 3 ... n см³ рабочего раствора ... Массовая концентрация коагулянта в пересчете на оксид основного вещества ... составит соответственно 1, 2, 3 ... n мг/дм³. Время перемешивания — 3 мин. После этого скорость ... переключают на 40 об/мин и перемешивают 15 мин. ... Время отстаивания растворов — 30 мин. После отстаивания осветленную часть воды ... фильтруют через ... бумажные однослойные фильтры." },
    { clause: "А.5", check: "text", text: "Оптимальной для воды источника водоснабжения является наименьшая доза коагулянта, обеспечивающая достижение показателей качества питьевой воды по А.4.6, отвечающих требованиям [1]." },
  ],
  evaluate(t, w, o, ctx) {
    const r = empty("Al2O3");
    if (!this.coagulants[t]) { r.status = "invalid"; r.errors.push(`Методика не применяется к ${PROFILES[t].label} (база Fe₂O₃ пока не поддержана).`); return r; }
    const C = cAl2O3(t, ctx);
    if (isNum(C) && C > 0) r.rows.push({ label: "Рабочий раствор, п. 5.4.2", formula: `m = 1,0 · 100 / ${f(C, 2)} %`, result: `${f(workingSolutionMass(C), 2)} г товарного продукта на 1 дм³` });
    const tests = (ctx?.jar?.tests ?? []).filter((x) => x.coagulantType === t);
    const norms = ctx?.jar?.norms;
    const sd = norms ? seasonalDesign(tests, norms) : null;
    if (sd && norms) {
      r.rows.push({ label: "Нормативы", formula: norms.name, result: norms.source });
      const sl = (s: string) => SEASONS.find((x) => x[0] === s)?.[1] ?? s;
      for (const x of sd.results) {
        const fail = x.checks.length ? x.checks[x.checks.length - 1] : null;
        r.rows.push({ label: `Опыт ${x.test.date || "без даты"} · ${sl(x.test.season)}${isNum(x.test.temperature) ? ` · ${f(x.test.temperature, 1)} °C` : ""}`, formula: `${x.checks.length} доз`, result: x.optimal !== null ? `Dопт = ${f(x.optimal)} мг/л Al₂O₃` : `оптимальная доза не найдена${fail ? `: при ${f(fail.dose)} мг/л — ${[...fail.fails, ...fail.unknown.map((u) => `${u} не измерен`)].join(", ")}` : ""}` });
      }
    }
    if (sd && sd.design !== null) {
      for (const s of sd.bySeason) r.rows.push({ label: `Период: ${SEASONS.find((x) => x[0] === s.season)?.[1]}`, formula: "наибольшая из оптимальных в периоде", result: `${f(s.optimal)} мг/л Al₂O₃` });
      r.rows.push({ label: "Проектная доза (СП 31.13330.2021, п. 9.15)", formula: "max по периодам; регулирование от min", result: `${f(sd.min as number)}…${f(sd.design)} мг/л Al₂O₃` });
      r.central = r.high = sd.design; r.low = sd.min as number;
      if (sd.bySeason.length < 2) r.warnings!.push("Опыты только для одного периода года: оптимальные дозы нужны для характерных периодов (паводок, межень, ледостав) — СП 31.13330.2021, п. 9.15.");
      r.warnings!.push(...this.warnings);
      return r;
    }
    // нет экспериментальных данных — предварительная оценка
    r.warnings!.push(tests.length ? "Ни в одном опыте не найдена доза, обеспечивающая все нормативы: расширьте серию доз или проверьте измерения." : "Нет данных пробного коагулирования.");
    if (t === "PACl") {
      r.rows.push({ label: "Без данных опытов", formula: "методика ПОХА-1 (РД п. 7.4)", result: PRELIM_BANNER });
      evalPacl1(t, w, o, ctx, r);
      if (r.status !== "ok") return r;
      r.warnings!.unshift(PRELIM_BANNER);
      r.warnings!.push(NOT_FINAL);
      return r;
    }
    r.status = "nodata"; r.missing.push("результаты пробного коагулирования");
    return r;
  },
};

const fromSA: BuiltinDef = {
  id: "ref-pacl-from-alum",
  version: 1,
  title: "Справочный пересчёт: доза ПОХА по дозе сульфата алюминия и коэффициенту эффективности k",
  doc: "Пересчёт по молярным массам; k — по данным пробной коагуляции или производителя",
  clause: "без нормативного пункта",
  fileRef: null,
  status: "reference",
  coagulants: { PACl: "direct" },
  area: "Справочно, без нормативного статуса. Значения k по умолчанию не подставляются.",
  formula: "DAl₂O₃(СА) = DСА · 102/342 ≈ 0,298·DСА; DAl₂O₃(ПОХА) = k · DAl₂O₃(СА)",
  formulaCheck: "text",
  outputBasis: () => "Al2O3",
  options: [
    { key: "dSA", label: "Доза сульфата алюминия (безводного), DСА", kind: "number", default: "", unit: "мг/л", hint: "обязательно" },
    { key: "k", label: "Коэффициент эффективности k", kind: "number", default: "", unit: "—", hint: "по пробной коагуляции или данным производителя; по умолчанию не задаётся" },
  ],
  required: () => [],
  warnings: ["Справочно, без нормативного статуса."],
  quotes: [],
  evaluate(t, _w, o) {
    const r = empty("Al2O3");
    if (!this.coagulants[t]) { r.status = "invalid"; r.errors.push(`Методика не применяется к ${PROFILES[t].label}.`); return r; }
    const d = num(o.dSA), k = num(o.k);
    if (d === null) r.missing.push("доза сульфата алюминия DСА");
    if (k === null) r.missing.push("коэффициент эффективности k");
    if (r.missing.length) { r.status = "nodata"; return r; }
    if (!isNum(d) || !isNum(k) || d < 0 || k <= 0) { r.status = "invalid"; r.errors.push("DСА ≥ 0 и k > 0 — числа."); return r; }
    const ratio = eqMass("Al2(SO4)3", "Al2O3") / eqMass("Al2(SO4)3", "salt");
    const sa = d * ratio;
    r.rows.push({ label: "Сульфат алюминия по Al₂O₃", formula: `${f(d)} × ${f(ratio, 4)} (101,96/342,15)`, result: `${f(sa)} мг/л Al₂O₃` });
    r.rows.push({ label: "ПОХА по Al₂O₃", formula: `k · ${f(sa)} = ${f(k)} · ${f(sa)}`, result: `${f(k * sa)} мг/л Al₂O₃` });
    r.central = r.low = r.high = k * sa;
    r.warnings!.push(...this.warnings, NOT_FINAL);
    return r;
  },
};

export const BUILTIN_METHODS: BuiltinDef[] = [snip, rd, pacl1, jar, fromSA, rodriguez, zxr];
export const builtinById = (id: string) => BUILTIN_METHODS.find((d) => d.id === id || BUILTIN_PREFIX + d.id === id) ?? null;
export const builtinsFor = (t: CoagulantType) => BUILTIN_METHODS.filter((d) => d.coagulants[t]);
export const defaultOptions = (d: BuiltinDef): Opts => Object.fromEntries(d.options.map((o) => [o.key, o.default]));

export const STATUS_LABEL: Record<DocStatus, string> = {
  normative: "Нормативная",
  reference: "Справочно, без нормативного статуса",
  superseded: "Отменённый документ — справочно",
  adapted: "Инженерная адаптация",
};

/** Встроенная методика в виде записи справочника (не хранится у пользователя, строится из кода). */
export function builtinAsMethod(d: BuiltinDef, t: CoagulantType): DoseMethod {
  const ph = d.phWindow?.(t) ?? null;
  return {
    id: BUILTIN_PREFIX + d.id, builtinId: d.id, name: d.title, coagulantType: t, model: "builtin", version: d.version,
    inputs: d.required(defaultOptions(d)).map((key) => ({ key, min: null, max: null })), coefficients: [],
    outputBasis: d.outputBasis(t), band: null, phWindow: ph ? { min: ph.min, max: ph.max } : null,
    source: `${d.doc}, ${d.clause}`, status: "verified", createdAt: "2026-10-11",
  };
}

/** Рекомендуемая методика по типу объекта (ВОС → СНиП п. 6.16 со ссылкой на СП 31.13330.2021; ТЭС → РД п. 7.4). */
export function recommendedBuiltin(obj: ObjectType, t: CoagulantType): BuiltinDef | null {
  const list = builtinsFor(t);
  return list.find((d) => d.recommended?.[obj]?.includes(t)) ?? list.find((d) => !d.recommended && d.recommendedFor === obj) ?? null;
}
