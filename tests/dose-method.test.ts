import { describe, it, expect } from "vitest";
import { evaluateMethod, validateMethod, assessPhCorrection, type DoseMethod } from "@/core/coagulation/doseMethod";
import { calculateCoagulation, type CoagInput } from "@/core/coagulation/calculate";

/** Синтетическая методика для тестов механизма; коэффициенты условные, не рекомендация. */
const expr: DoseMethod = {
  id: "t1", name: "Тестовая", coagulantType: "PACl", model: "expression", version: 1,
  inputs: [{ key: "color", min: 5, max: 80 }, { key: "turbidity", min: 0.5, max: 20 }],
  expression: "a + b*color + c*turbidity",
  coefficients: [{ name: "a", value: 0.5, unit: "мг/л Al", basis: "тест" }, { name: "b", value: 0.05, unit: "мг/л Al на град.", basis: "тест" }, { name: "c", value: 0.1, unit: "мг/л Al на NTU", basis: "тест" }],
  outputBasis: "metal", band: { lower: 0.3, upper: 0.3 }, phWindow: { min: 6.5, max: 7.8 },
  source: "unit-test", status: "user", createdAt: "2026-10-11",
};

describe("методика по выражению", () => {
  it("центральная оценка и диапазон", () => {
    const r = evaluateMethod(expr, { color: 35, turbidity: 6 }, {});
    expect(r.status).toBe("ok");
    expect(r.central).toBeCloseTo(2.85, 12);
    expect(r.low).toBeCloseTo(1.995, 12);
    expect(r.high).toBeCloseTo(3.705, 12);
  });
  it("нет данных → nodata, ноль не подставляется", () => {
    const r = evaluateMethod(expr, { color: 35 }, {});
    expect(r.status).toBe("nodata");
    expect(r.missing).toContain("Мутность");
  });
  it("вне области применимости → оценка не выдаётся", () => {
    const r = evaluateMethod(expr, { color: 120, turbidity: 6 }, {});
    expect(r.status).toBe("outside");
    expect(Number.isNaN(r.central)).toBe(true);
  });
  it("валидация: без единиц, основания и области — ошибка", () => {
    const bad: DoseMethod = { ...expr, source: "", inputs: [{ key: "color", min: null, max: null }], coefficients: [{ name: "a", value: 1, unit: "", basis: "" }], expression: "a + x" };
    const e = validateMethod(bad);
    expect(e.some((x) => x.includes("основание"))).toBe(true);
    expect(e.some((x) => x.includes("область"))).toBe(true);
    expect(e.some((x) => x.includes("единицы"))).toBe(true);
    expect(e.some((x) => x.includes("«x»"))).toBe(true);
  });
  it("продуктовая переменная доступна выражению", () => {
    const m: DoseMethod = { ...expr, inputs: [{ key: "w_me", min: 0, max: 1 }], expression: "k / w_me", coefficients: [{ name: "k", value: 1, unit: "мг/л", basis: "тест" }], band: null };
    expect(evaluateMethod(m, {}, { w_me: 0.5 }).central).toBeCloseTo(2, 12);
  });
});

describe("методика по таблице", () => {
  const tbl: DoseMethod = { ...expr, model: "lookup", expression: undefined, coefficients: [], inputs: [{ key: "color", min: 5, max: 80 }], lookup: { key: "color", rows: [{ from: 5, to: 20, low: 2, high: 4 }, { from: 20, to: 80, low: 4, high: 7, central: 5 }] } };
  it("строка таблицы и центральная оценка только если задана", () => {
    const a = evaluateMethod(tbl, { color: 10 }, {});
    expect([a.low, a.high]).toEqual([2, 4]);
    expect(Number.isNaN(a.central)).toBe(true);
    expect(evaluateMethod(tbl, { color: 35 }, {}).central).toBe(5);
  });
});

describe("необходимость коррекции pH", () => {
  it("ниже окна → щёлочь, выше → кислота", () => {
    expect(assessPhCorrection({ pH: 6.0, alkalinity: 2 }, { min: 6.5, max: 7.8 }, 0.1).need).toBe("base");
    expect(assessPhCorrection({ pH: 8.4, alkalinity: 2 }, { min: 6.5, max: 7.8 }, 0.1).need).toBe("acid");
    expect(assessPhCorrection({ pH: 7.2, alkalinity: 2 }, { min: 6.5, max: 7.8 }, 0.1).need).toBe("none");
  });
  it("нехватка щёлочности по стехиометрии → щёлочь", () => {
    expect(assessPhCorrection({ pH: 7.2, alkalinity: 0.3 }, { min: 6.5, max: 7.8 }, 0.5).need).toBe("base");
  });
  it("без окна и без pH → не определено", () => {
    expect(assessPhCorrection({ alkalinity: 2 }, { min: 6.5, max: 7.8 }, 0.1).need).toBe("unknown");
    expect(assessPhCorrection({ pH: 7.2, alkalinity: 2 }, null, 0.1).need).toBe("unknown");
  });
});

describe("расчёт с дозой по методике", () => {
  const base: CoagInput = {
    coagulant: "PACl",
    passport: { name: "T", form: "liquid", concentration: 17, concentrationBasis: "Al2O3", density: 1.37, basicity: 70, basicityDefinition: "x", workingConcentration: 10, workingBasis: "Al2O3" },
    flow: { mode: "coag", nom: 100 },
    dose: { mode: "method", method: expr, min: null, nom: null, max: null, basis: "metal" },
    water: { pH: 7.2, alkalinity: 2.1, color: 35, turbidity: 6 },
    ph: { mode: "none" }, contact: { calc: "timeToVolume", time: 60, flowBasis: "max" }, pipe: { flowBasis: "max", velocity: 1.5 }, pumps: {},
  };
  it("доза методики идёт в расходы; насос по max(верх; принятая)", () => {
    const r = calculateCoagulation(base);
    expect(r.doseMetal.nom).toBeCloseTo(2.85, 12);
    expect(r.doseMetal.max).toBeCloseTo(3.705, 12);
    expect(r.phNeed.need).toBe("none");
    const r2 = calculateCoagulation({ ...base, dose: { ...base.dose, accepted: 4 } });
    expect(r2.doseMetal.nom).toBe(4);
    expect(r2.doseMetal.max).toBe(4);
  });
  it("нет данных для методики → статус «недостаточно данных»", () => {
    const r = calculateCoagulation({ ...base, water: { pH: 7.2 } });
    expect(r.status).toBe("nodata");
  });
});
