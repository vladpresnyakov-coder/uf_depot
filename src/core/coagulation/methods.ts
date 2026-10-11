import type { CoagulantType } from "./profiles";
import { PROFILES } from "./profiles";

export type ModelType = "manual" | "parameterizedExpression" | "lookupTable";
export type ValidationStatus = "published" | "template" | "personal-unverified" | "personal-validated";

export interface MethodRecord {
  id: string;
  version: number;
  coagulantType: CoagulantType | "any";
  productScope: string;
  modelType: ModelType;
  inputVariables: { name: string; label: string; unit: string }[];
  outputBasis: string;
  expression?: string;
  lookup?: { key: string; rows: { from: number; to: number; low: number; high: number }[] };
  coefficients: { name: string; value: number; unit: string; basis: string }[];
  applicabilityLimits: { variable: string; min: number; max: number; unit: string }[];
  rangeRule: { type: "userMinMax" } | { type: "relativeBand"; lower: string; upper: string } | { type: "tableLowHigh"; central: "none" };
  source: string;
  validationStatus: ValidationStatus;
  testCases: unknown[];
  author: string;
  createdAt: string;
  note: string;
}

const CREATED = "2026-10-10";

const manual = (t: CoagulantType): MethodRecord => ({
  id: `PUB-MANUAL-${t.replace(/[()]/g, "")}`, version: 1, coagulantType: t, productScope: "любой продукт типа",
  modelType: "manual", inputVariables: [], outputBasis: "задаёт пользователь", coefficients: [], applicabilityLimits: [],
  rangeRule: { type: "userMinMax" }, source: "Не требуется: доза задаётся пользователем", validationStatus: "published",
  testCases: [], author: "UF Depot", createdAt: CREATED, note: `Ручная доза — ${PROFILES[t].label}`,
});

/** Общий опубликованный реестр v0.1: ручная доза и шаблоны без коэффициентов. */
export const PUBLIC_METHODS: MethodRecord[] = [
  ...(Object.keys(PROFILES) as CoagulantType[]).map(manual),
  {
    id: "PUB-TPL-LINEAR", version: 1, coagulantType: "any", productScope: "—", modelType: "parameterizedExpression",
    inputVariables: [], outputBasis: "", expression: "", coefficients: [], applicabilityLimits: [],
    rangeRule: { type: "relativeBand", lower: "kLow", upper: "kHigh" }, source: "Шаблон без коэффициентов",
    validationStatus: "template", testCases: [], author: "UF Depot", createdAt: CREATED, note: "Шаблон: параметрическое выражение",
  },
  {
    id: "PUB-TPL-LOOKUP", version: 1, coagulantType: "any", productScope: "—", modelType: "lookupTable",
    inputVariables: [], outputBasis: "", lookup: { key: "", rows: [] }, coefficients: [], applicabilityLimits: [],
    rangeRule: { type: "tableLowHigh", central: "none" }, source: "Шаблон без строк", validationStatus: "template",
    testCases: [], author: "UF Depot", createdAt: CREATED, note: "Шаблон: таблица",
  },
];

/** Методики, требующие подтверждения источниками (реестр неопределённостей). */
export const PENDING_METHODS = [
  { code: "M-14", name: "Предварительный диапазон доз", scope: "PACl", fallback: "Ручная доза" },
  { code: "M-15a", name: "Предварительный диапазон доз (перенос зависимости для Al запрещён)", scope: "FeCl₃", fallback: "Ручная доза; встроенные СНиП п. 6.16 и РД п. 7.4 (по эквиваленту)" },
  { code: "M-15b", name: "Предварительный диапазон доз", scope: "Fe₂(SO₄)₃", fallback: "Ручная доза; встроенные СНиП п. 6.16 и РД п. 7.4 (по эквиваленту)" },
  { code: "M-16", name: "Предварительный диапазон доз", scope: "Al₂(SO₄)₃", fallback: "Встроенные: СНиП п. 6.16, РД п. 7.4, справочные Rodriguez и ЗХР" },
  { code: "M-16b", name: "Предварительный диапазон доз", scope: "FeSO₄", fallback: "Ручная доза" },
  { code: "M-17", name: "Завершённость окисления Fe²⁺ за контактное время", scope: "FeSO₄", fallback: "Статус «требуется проверка»" },
  { code: "M-08", name: "Доза кислоты/щёлочи до целевого pH", scope: "HCl, H₂SO₄, NaOH", fallback: "Ручная доза или титрационная кривая" },
  { code: "M-06+", name: "Учёт свободной кислотности в балансе щёлочности", scope: "PACl и др.", fallback: "Баланс без неё, с пометкой" },
  { code: "M-09", name: "Контактное время", scope: "все", fallback: "Задаёт пользователь с основанием" },
  { code: "M-10", name: "Коэффициент использования объёма k", scope: "все", fallback: "Не применяется" },
  { code: "M-11v", name: "Расчётная скорость в трубопроводе", scope: "все", fallback: "Задаёт пользователь" },
  { code: "M-12z", name: "Проектный запас подачи насоса", scope: "все", fallback: "Задаёт пользователь" },
  { code: "M-18", name: "Прогноз SDI15, остаточного металла, ПО ультрафильтрата", scope: "все", fallback: "Только заданные требования" },
  { code: "M-19", name: "Нагрузка на УФ по ВВ и осадку", scope: "все", fallback: "Только модель данных" },
];
