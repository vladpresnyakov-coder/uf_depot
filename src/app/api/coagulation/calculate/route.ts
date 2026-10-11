import { calculateCoagulation, type CoagInput } from "@/core/coagulation/calculate";
import type { Basis, CoagulantType } from "@/core/coagulation/profiles";
import { errorResponse, InputError, num, oneOf, readJson, str } from "@/lib/validate";
import { builtinAsMethod, builtinById } from "@/core/coagulation/normative";
import { WATER_PARAMS, PRODUCT_PARAMS, type DoseMethod, type WaterQuality, type WaterKey } from "@/core/coagulation/doseMethod";

const COAG = ["PACl", "Al2(SO4)3", "FeCl3", "Fe2(SO4)3", "FeSO4"] as const;
const BASES = ["metal", "Al2O3", "salt", "hydrate", "product"] as const;
const QB = ["min", "nom", "max"] as const;
type R = Record<string, unknown>;
const INPUT_KEYS = [...Object.keys(WATER_PARAMS), ...Object.keys(PRODUCT_PARAMS)] as (keyof typeof WATER_PARAMS | keyof typeof PRODUCT_PARAMS)[];

/** Методика приходит из справочника пользователя; разбирается как данные, выражение — безопасным парсером ядра. */
function parseMethod(v: unknown, coagulant: CoagulantType): DoseMethod | null {
  if (!v || typeof v !== "object") return null;
  const m = v as R;
  if (m.model === "builtin") {
    // встроенная методика строится из кода по идентификатору; данные клиента не используются
    const def = builtinById(str(m.builtinId, 80));
    if (!def || !def.coagulants[coagulant]) throw new InputError("Встроенная методика не найдена или не применяется к выбранному коагулянту.");
    return builtinAsMethod(def, coagulant);
  }
  const opt = { optional: true } as const;
  const model = oneOf(m.model, "тип методики", ["manual", "expression", "lookup"] as const);
  const inputs = Array.isArray(m.inputs) ? (m.inputs as R[]).slice(0, 20).map((i, k) => ({ key: oneOf(i.key, `вход ${k + 1}`, INPUT_KEYS), min: num(i.min, `min входа ${k + 1}`, opt), max: num(i.max, `max входа ${k + 1}`, opt) })) : [];
  const coefficients = Array.isArray(m.coefficients) ? (m.coefficients as R[]).slice(0, 30).map((c, k) => ({ name: str(c.name, 40), value: num(c.value, `коэффициент ${k + 1}`) as number, unit: str(c.unit, 60), basis: str(c.basis, 200) })) : [];
  const lk = m.lookup as R | undefined;
  const expression = str(m.expression, 500);
  if (model === "expression" && !expression) throw new InputError("У методики не задано выражение.");
  return {
    id: str(m.id, 80), name: str(m.name, 120), coagulantType: coagulant, model, version: (num(m.version, "версия", { min: 1, int: true, optional: true }) ?? 1) as number,
    inputs, expression, coefficients,
    lookup: lk && Array.isArray(lk.rows) ? { key: oneOf(lk.key, "ключ таблицы", INPUT_KEYS), rows: (lk.rows as R[]).slice(0, 50).map((r, k) => ({ from: num(r.from, `от, строка ${k + 1}`) as number, to: num(r.to, `до, строка ${k + 1}`) as number, low: num(r.low, `низ, строка ${k + 1}`) as number, high: num(r.high, `верх, строка ${k + 1}`) as number, central: num(r.central, `центр, строка ${k + 1}`, opt) })) } : undefined,
    outputBasis: oneOf(m.outputBasis, "база результата методики", BASES as readonly Basis[]),
    band: m.band && typeof m.band === "object" ? { lower: num((m.band as R).lower, "нижняя доля", { min: 0, max: 0.99 }) as number, upper: num((m.band as R).upper, "верхняя доля", { min: 0, max: 10 }) as number } : null,
    phWindow: m.phWindow && typeof m.phWindow === "object" ? { min: num((m.phWindow as R).min, "pH min", { min: 0, max: 14, ...opt }), max: num((m.phWindow as R).max, "pH max", { min: 0, max: 14, ...opt }) } : null,
    source: str(m.source, 400), status: m.status === "demo" ? "demo" : m.status === "verified" ? "verified" : "user", createdAt: str(m.createdAt, 30),
  };
}

/** Опции встроенной методики: только строки, ограниченный набор ключей. */
function parseOptions(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!v || typeof v !== "object") return out;
  for (const [k, x] of Object.entries(v as R).slice(0, 20)) if (/^[A-Za-z]{1,20}$/.test(k) && (typeof x === "string" || typeof x === "number")) out[k] = String(x).slice(0, 40);
  return out;
}

function parseWater(w: R): WaterQuality & { oxidant?: string | null } {
  const out: WaterQuality & { oxidant?: string | null } = {};
  for (const k of Object.keys(WATER_PARAMS) as WaterKey[]) out[k] = num(w[k], WATER_PARAMS[k].label, k === "pH" ? { min: 0, max: 14, optional: true } : { optional: true });
  out.oxidant = str(w.oxidant) || null;
  return out;
}

function parseInput(b: R): CoagInput {
  oneOf(b.coagulant, "коагулянт", COAG as readonly CoagulantType[]);
  const pp = (b.passport ?? {}) as R, fl = (b.flow ?? {}) as R, d = (b.dose ?? {}) as R, w = (b.water ?? {}) as R;
  const ph = (b.ph ?? {}) as R, c = (b.contact ?? {}) as R, pi = (b.pipe ?? {}) as R, pu = (b.pumps ?? {}) as R;
  const opt = { optional: true } as const;
  const basisOrNull = (v: unknown, n: string) => (v == null || v === "" ? null : oneOf(v, n, BASES as readonly Basis[]));
  const flowMode = oneOf(fl.mode, "режим расхода", ["coag", "uf"] as const);
  const phMode = oneOf(ph.mode ?? "none", "коррекция pH", ["none", "acid", "base", "unknown"] as const);
  return {
    coagulant: oneOf(b.coagulant, "коагулянт", COAG as readonly CoagulantType[]),
    passport: {
      name: str(pp.name), form: oneOf(pp.form, "форма продукта", ["liquid", "solid"] as const),
      hydrateN: num(pp.hydrateN, "n кристаллогидрата", { min: 0, max: 30, ...opt }),
      concentration: num(pp.concentration, "концентрация", { min: 0, ...opt }),
      concentrationBasis: basisOrNull(pp.concentrationBasis, "база концентрации"),
      density: num(pp.density, "плотность", { min: 0, max: 5, ...opt }),
      basicity: num(pp.basicity, "основность", { min: 0, max: 100, ...opt }),
      basicityDefinition: str(pp.basicityDefinition),
      freeAcidity: num(pp.freeAcidity, "свободная кислотность", opt),
      workingConcentration: num(pp.workingConcentration, "концентрация рабочего раствора", { min: 0, ...opt }),
      workingBasis: basisOrNull(pp.workingBasis, "база рабочего раствора"),
    },
    flow: flowMode === "uf"
      ? { mode: "uf", trains: num(fl.trains, "число установок", { min: 1, max: 100, int: true }), perTrain: num(fl.perTrain, "подача на установку", { min: 0 }), minOverride: num(fl.minOverride, "Qmin", { min: 0, ...opt }), maxOverride: num(fl.maxOverride, "Qmax", { min: 0, ...opt }) }
      : { mode: "coag", nom: num(fl.nom, "Qном", { min: 0 }), min: num(fl.min, "Qmin", { min: 0, ...opt }), max: num(fl.max, "Qmax", { min: 0, ...opt }) },
    dose: {
      mode: d.mode === "method" ? "method" : "manual", method: d.mode === "method" ? parseMethod(d.method, b.coagulant as CoagulantType) : null, options: parseOptions(d.options), accepted: num(d.accepted, "принятая доза", { min: 0, ...opt }),
      min: num(d.min, "Dmin", { min: 0, ...opt }), nom: num(d.nom, "Dном", { min: 0, ...opt }), max: num(d.max, "Dmax", { min: 0, ...opt }), basis: oneOf(d.basis, "база дозы", BASES as readonly Basis[]), hydrateN: num(d.hydrateN, "n гидрата дозы", { min: 0, max: 30, ...opt }),
    },
    water: parseWater(w),
    ph: {
      mode: phMode, reagent: ph.reagent ? oneOf(ph.reagent, "реагент pH", ["HCl", "H2SO4", "NaOH"] as const) : undefined,
      method: ph.method ? oneOf(ph.method, "способ дозы pH", ["manual", "curve"] as const) : "manual",
      dose100: num(ph.dose100, "доза 100 %", { min: 0, ...opt }), target: num(ph.target, "целевой pH", { min: 0, max: 14, ...opt }),
      curve: Array.isArray(ph.curve) ? (ph.curve as unknown[]).slice(0, 50).map((p, i) => { const a = p as unknown[]; return [num(a?.[0], `доза точки ${i + 1}`) as number, num(a?.[1], `pH точки ${i + 1}`, { min: 0, max: 14 }) as number] as [number, number]; }) : [],
      massFraction: num(ph.massFraction, "массовая доля", { min: 0, max: 1, ...opt }), density: num(ph.density, "плотность раствора", { min: 0, max: 5, ...opt }), working100: num(ph.working100, "рабочий раствор", { min: 0, ...opt }),
    },
    contact: { calc: oneOf(c.calc, "режим камер", ["timeToVolume", "volumeToTime"] as const), time: num(c.time, "контактное время", { min: 0, ...opt }), timeBasis: str(c.timeBasis), volume: num(c.volume, "объём", { min: 0, ...opt }), flowBasis: oneOf(c.flowBasis, "расход подбора камер", QB), k: num(c.k, "k", opt), kBasis: str(c.kBasis) },
    pipe: { flowBasis: oneOf(pi.flowBasis, "расход трубы", QB), velocity: num(pi.velocity, "скорость", { min: 0, max: 10, ...opt }), velocityBasis: str(pi.velocityBasis), actualInnerDiameterMm: num(pi.actualInnerDiameterMm, "dвн", { min: 0, ...opt }) },
    pumps: { pointPressureBar: num(pu.pointPressureBar, "давление в точке ввода", opt), extraLossBar: num(pu.extraLossBar, "доп. потери", { min: 0, ...opt }), marginPct: num(pu.marginPct, "запас", { min: 0, max: 200, ...opt }) },
    feso4OxidationStatus: b.feso4OxidationStatus ? oneOf(b.feso4OxidationStatus, "статус окисления", ["unchecked", "required", "method", "test"] as const) : undefined,
  };
}

export async function POST(req: Request) {
  try {
    const input = parseInput(await readJson(req));
    return Response.json({ input, result: calculateCoagulation(input) });
  } catch (e) {
    return errorResponse(e);
  }
}
