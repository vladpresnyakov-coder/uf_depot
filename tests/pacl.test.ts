import { describe, expect, it } from "vitest";
import { builtinAsMethod, builtinById, builtinsFor, recommendedBuiltin, AL2O3_TO_AL } from "@/core/coagulation/normative";
import { evaluateMethod } from "@/core/coagulation/doseMethod";
import { metalFraction } from "@/core/coagulation/profiles";
import { optimalDose, seasonalDesign, workingSolutionMass, NORMS_SANPIN, NORMS_GOST_MODEL, type JarTest } from "@/core/coagulation/jar";
import { calculateCoagulation, type CoagInput } from "@/core/coagulation/calculate";

const PACL1 = "rd-153-34.1-37.502-2000-7.4-pacl", JAR = "gost-r-51642-2000-a-jar";
// контрольный пример: ПО = 10, Щ₀ = 1,2; жидкий ПОХА C = 17 % Al₂O₃, B = 70 %, ρ = 1,30; Q = 100 м³/ч
const product = { w_me: 0.17 * metalFraction("PACl", "Al2O3"), basicity: 70, density: 1.3 };
const water = { permanganate: 10, alkalinity: 1.2 };
const row = (r: { rows: { label: string; result: string }[] }, s: string) => r.rows.find((x) => x.label.includes(s))?.result ?? "";

describe("ПОХА-1: РД п. 7.4 для ПОХА", () => {
  const r = evaluateMethod(builtinAsMethod(builtinById(PACL1)!, "PACl"), water, product, { alkali: "CaO" });
  it("Dэкв = 0,70 мг-экв/л, в диапазоне", () => {
    expect(r.status).toBe("ok");
    expect(row(r, "1. Доза по эквиваленту")).toBe("0,7 мг-экв/л");
    expect(row(r, "2. Проверка")).toBe("в диапазоне");
  });
  it("DAl₂O₃ = 11,9 мг/л; DAl = 6,30 мг/л", () => {
    expect(r.basis).toBe("Al2O3");
    expect(r.central).toBeCloseTo(11.9, 1);
    expect(r.central * AL2O3_TO_AL).toBeCloseTo(6.30, 1);
  });
  it("Dтов = 70,0 мг/л; Vтов = 53,8 мл/м³; рабочий раствор 5,88 г/дм³", () => {
    expect(row(r, "4. Товарный продукт")).toBe("69,97 мг/л (г/м³)");
    expect(row(r, "объём товарного продукта")).toBe("53,8 мл/м³");
    expect(workingSolutionMass(17)).toBeCloseTo(5.88, 2);
  });
  it("ΔЩ = 0,21; Щост = 0,99; подщелачивание не требуется (28·(0,21 − 1,2) + 1 < 0)", () => {
    expect(row(r, "5. Снижение щёлочности")).toBe("0,21 мг-экв/л");
    expect(row(r, "остаточная щёлочность")).toBe("0,99 мг-экв/л");
    expect(row(r, "подщелачивание")).toContain("не требуется");
    expect(r.warnings!.some((w) => w.includes("инженерная адаптация"))).toBe(true);
    expect(r.warnings!.some((w) => w.includes("ниже 0,5–1"))).toBe(true);
  });
  it("расход товарного продукта при Q = 100 м³/ч: 7,0 кг/ч и 5,38 л/ч", () => {
    const inp = {
      coagulant: "PACl",
      passport: { name: "ПОХА", form: "liquid", concentration: 17, concentrationBasis: "Al2O3", density: 1.3, basicity: 70, basicityDefinition: "[OH]/(3[Al])", workingConcentration: 10, workingBasis: "Al2O3" },
      flow: { mode: "coag", nom: 100, min: null, max: null },
      dose: { mode: "method", method: builtinAsMethod(builtinById(PACL1)!, "PACl"), options: {}, accepted: null, min: null, nom: null, max: null, basis: "Al2O3" },
      water: { ...water, pH: 7 },
      ph: { mode: "none", curve: [] },
      contact: { calc: "timeToVolume", time: 60, timeBasis: "", volume: null, flowBasis: "max", k: null, kBasis: "" },
      pipe: { flowBasis: "max", velocity: 1.5, velocityBasis: "", actualInnerDiameterMm: null },
      pumps: { pointPressureBar: 2, extraLossBar: 0.5, marginPct: null },
    } as unknown as CoagInput;
    const c = calculateCoagulation(inp);
    const nom = c.product.find((x) => x.k === "nom")!;
    expect(nom.Mp).toBeCloseTo(7.0, 1);
    expect(nom.Lp).toBeCloseTo(5.38, 2);
  });
  it("для ВОС — предупреждение о справочном статусе", () => {
    const v = evaluateMethod(builtinAsMethod(builtinById(PACL1)!, "PACl"), water, product, { objectType: "vos" });
    expect(v.warnings!.some((w) => w.includes("Для ВОС методика справочная"))).toBe(true);
  });
});

describe("СНиП п. 6.16 и ПОХА", () => {
  it("не предлагается для ПОХА и при выборе возвращает ошибку", () => {
    expect(builtinsFor("PACl").some((d) => d.id.startsWith("snip"))).toBe(false);
    const snip = builtinById("snip-2.04.02-84-6.16")!;
    const r = snip.evaluate("PACl", { color: 30 }, { mode: "color" });
    expect(r.status).toBe("invalid");
    expect(r.errors[0]).toContain("методика не распространяется на ПОХА".replace("м", "М"));
  });
});

describe("ПОХА-2: пробное коагулирование, ГОСТ Р 51642-2000", () => {
  const mk = (season: JarTest["season"], rows: [number, number, number, number, number, number, number][]): JarTest => ({
    id: season, date: "2026-04-10", season, temperature: 4, coagulantType: "PACl", productName: "ПОХА", source: {}, note: "",
    rows: rows.map(([dose, turbidityMg, color, permanganate, al, fe, pH]) => ({ dose, values: { turbidityMg, color, permanganate, al, fe, pH } })),
  });
  const flood = mk("flood", [[2, 3, 35, 7, 0.1, 0.2, 7.2], [4, 1.2, 18, 5.5, 0.12, 0.2, 7.0], [6, 0.8, 15, 4.6, 0.15, 0.1, 6.9], [8, 0.6, 12, 4.2, 0.18, 0.1, 6.8]]);
  const low = mk("low", [[2, 1.4, 18, 4.8, 0.1, 0.1, 7.3], [3, 1.0, 14, 4.2, 0.1, 0.1, 7.2]]);
  it("оптимальная — наименьшая доза, выполняющая все нормативы", () => {
    expect(optimalDose(flood, NORMS_SANPIN).optimal).toBe(6);
    expect(optimalDose(low, NORMS_SANPIN).optimal).toBe(2);
  });
  it("неизмеренный нормируемый показатель не позволяет принять дозу", () => {
    const t = mk("other", [[3, 1, 10, 4, 0.1, 0.1, 7]]);
    t.rows[0].values.al = null;
    const r = optimalDose(t, NORMS_SANPIN);
    expect(r.optimal).toBeNull();
    expect(r.checks[0].unknown).toContain("Al ост.");
  });
  it("набор норм табл. 1 ГОСТ Р 51642 не проверяет ПО", () => {
    expect(optimalDose(flood, NORMS_GOST_MODEL).optimal).toBe(4);
  });
  it("сезонность: проект — максимум по периодам, регулирование от минимума", () => {
    const d = seasonalDesign([flood, low], NORMS_SANPIN);
    expect(d.design).toBe(6);
    expect(d.min).toBe(2);
  });
  it("в методике: доза по опытам; без опытов — ПОХА-1 с плашкой предварительной оценки", () => {
    const m = builtinAsMethod(builtinById(JAR)!, "PACl");
    const a = evaluateMethod(m, water, product, {}, { tests: [flood, low], norms: NORMS_SANPIN });
    expect(a.status).toBe("ok");
    expect([a.low, a.central, a.high]).toEqual([2, 6, 6]);
    expect(a.rows.some((x) => x.result.includes("5,88 г"))).toBe(true);
    const b = evaluateMethod(m, water, product, {}, { tests: [], norms: NORMS_SANPIN });
    expect(b.central).toBeCloseTo(11.9, 1);
    expect(b.warnings![0]).toContain("не является проектной дозой по ГОСТ Р 51642-2000");
  });
  it("рекомендация: ВОС → пробное коагулирование, ТЭС → ПОХА-1", () => {
    expect(recommendedBuiltin("vos", "PACl")?.id).toBe(JAR);
    expect(recommendedBuiltin("tes", "PACl")?.id).toBe(PACL1);
    expect(recommendedBuiltin("vos", "Al2(SO4)3")?.id).toBe("snip-2.04.02-84-6.16");
  });
});

describe("справочный пересчёт с сульфата алюминия", () => {
  const m = builtinAsMethod(builtinById("ref-pacl-from-alum")!, "PACl");
  it("k не подставляется по умолчанию", () => {
    expect(evaluateMethod(m, {}, {}, { dSA: "40" }).status).toBe("nodata");
  });
  it("DAl₂O₃ = k · 0,298 · DСА", () => {
    const r = evaluateMethod(m, {}, {}, { dSA: "40", k: "0,8" });
    expect(r.central).toBeCloseTo(0.8 * 40 * 101.96 / 342.15, 2);
  });
});
