import { describe, it, expect } from "vitest";
import { metalFraction } from "@/core/coagulation/profiles";
import { calculateCoagulation, effectiveFlows, type CoagInput } from "@/core/coagulation/calculate";
import { parse, evaluate, identifiers } from "@/core/coagulation/expr";

describe("пересчёт баз (M-01)", () => {
  const cases: [Parameters<typeof metalFraction>, number][] = [
    [["PACl", "Al2O3"], 0.5293],
    [["Al2(SO4)3", "salt"], 0.1577],
    [["Al2(SO4)3", "hydrate", 14], 0.0908],
    [["Al2(SO4)3", "hydrate", 18], 0.081],
    [["FeCl3", "salt"], 0.3443],
    [["FeCl3", "hydrate", 6], 0.2066],
    [["Fe2(SO4)3", "salt"], 0.2793],
    [["FeSO4", "salt"], 0.3676],
    [["FeSO4", "hydrate", 7], 0.2009],
  ];
  it.each(cases)("%j → %f", (args, w) => expect(metalFraction(...args)).toBeCloseTo(w, 4));
  it("Al₂O₃ для железа не определён", () => expect(Number.isNaN(metalFraction("FeCl3", "Al2O3"))).toBe(true));
  it("гидрат без n не определён", () => expect(Number.isNaN(metalFraction("FeSO4", "hydrate", null))).toBe(true));
});

const demo = (over: Partial<CoagInput> = {}): CoagInput => ({
  coagulant: "PACl",
  passport: { name: "ДЕМО-ПОХА-17", form: "liquid", concentration: 17, concentrationBasis: "Al2O3", density: 1.37, basicity: 70, basicityDefinition: "[OH]/(3·[Al])", workingConcentration: 10, workingBasis: "Al2O3" },
  flow: { mode: "uf", trains: 3, perTrain: 40 },
  dose: { min: 1.5, nom: 2.5, max: 4, basis: "metal" },
  water: { pH: 7.4, alkalinity: 2.1, temperature: 8 },
  ph: { mode: "none" },
  contact: { calc: "timeToVolume", time: 60, timeBasis: "", flowBasis: "max" },
  pipe: { flowBasis: "max", velocity: 1.5 },
  pumps: { pointPressureBar: 2.5, extraLossBar: 0.5, marginPct: null },
  ...over,
});

describe("расходы и оборудование", () => {
  it("режим «с установками УФ»: Qmin = одна установка, Qном = все", () => {
    const q = effectiveFlows({ mode: "uf", trains: 3, perTrain: 40 });
    expect([q.min, q.nom, q.max]).toEqual([40, 120, 120]);
  });
  it("режим «только коагуляция»: пустые Qmin/Qmax = Qном", () => {
    const q = effectiveFlows({ mode: "coag", nom: 100 });
    expect([q.min, q.nom, q.max]).toEqual([100, 100, 100]);
  });
  it("демо ПОХА: насос 11–91 л/ч, камера 2 м³, труба 168 мм", () => {
    const r = calculateCoagulation(demo());
    expect(r.pumps[0].qmin).toBeCloseTo(11.34, 1);
    expect(r.pumps[0].qmax).toBeCloseTo(90.69, 1);
    expect(r.chambers.Veff).toBeCloseTo(2, 9);
    expect(r.pipe.dCalcMm).toBeCloseTo(168.2, 1);
    expect(r.product[1].Mp).toBeCloseTo(3.334, 3);
  });
  it("мг/л = г/м³: кг/ч = D × Q / 1000", () => {
    const r = calculateCoagulation(demo({ dose: { min: 10, nom: 10, max: 10, basis: "metal" }, flow: { mode: "coag", nom: 100 } }));
    expect(r.product[1].Mme).toBeCloseTo(1, 12);
  });
  it("концентрация без базы не принимается", () => {
    const r = calculateCoagulation(demo({ passport: { ...demo().passport, concentrationBasis: null } }));
    expect(r.status).toBe("incomplete");
  });
  it("концентрация вне границ даёт ошибку", () => {
    const r = calculateCoagulation(demo({ passport: { ...demo().passport, concentration: 150 } }));
    expect(r.warnings.some((w) => w[0] === "bad")).toBe(true);
  });
  it("отсутствие щёлочности не трактуется как ноль", () => {
    const r = calculateCoagulation(demo({ water: {} }));
    expect(Number.isNaN(r.alkalinity.water)).toBe(true);
  });
  it("FeSO₄: стехиометрия O₂ не подтверждает окисление", () => {
    const r = calculateCoagulation(demo({
      coagulant: "FeSO4",
      passport: { name: "ДЕМО-FeSO₄·7H₂O", form: "solid", hydrateN: 7, concentration: 98, concentrationBasis: "hydrate", workingConcentration: 100, workingBasis: "hydrate" },
      dose: { min: 3, nom: 5, max: 8, basis: "metal" },
      water: { pH: 7.4, temperature: 8, o2: 9 },
    }));
    expect(r.feso4?.o2Need).toBeLessThan(9);
    expect(r.warnings.some((w) => w[0] === "bad" && w[1].includes("не подтверждена"))).toBe(true);
    expect(r.status).not.toBe("user");
  });
  it("титрационная кривая: только интерполяция внутри диапазона", () => {
    const curve: [number, number][] = [[0, 7.1], [10, 7.7]];
    const inside = calculateCoagulation(demo({ ph: { mode: "base", reagent: "NaOH", method: "curve", target: 7.4, curve, massFraction: 0.46, density: 1.49, working100: 50 } }));
    expect(inside.ph?.dose100).toBeCloseTo(5, 9);
    const outside = calculateCoagulation(demo({ ph: { mode: "base", reagent: "NaOH", method: "curve", target: 8, curve, massFraction: 0.46, density: 1.49, working100: 50 } }));
    expect(Number.isNaN(outside.ph?.dose100)).toBe(true);
  });
});

describe("безопасные выражения методик", () => {
  it("вычисляет выражение с переменными", () => {
    expect(evaluate(parse("a + b*color + c*turb"), { a: 0.5, b: 0.05, c: 0.1, color: 35, turb: 6 })).toBeCloseTo(2.85, 12);
    expect([...identifiers(parse("max(a, sqrt(x))"))].sort()).toEqual(["a", "x"]);
  });
  it("отклоняет произвольный код", () => {
    expect(() => parse("process.exit(1)")).toThrow();
    expect(() => parse("a; b")).toThrow();
  });
});
