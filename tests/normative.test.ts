import { describe, expect, it } from "vitest";
import { builtinAsMethod, builtinById, builtinsFor, eqMass, recommendedBuiltin, BUILTIN_METHODS } from "@/core/coagulation/normative";
import { evaluateMethod } from "@/core/coagulation/doseMethod";
import { calculateCoagulation, type CoagInput } from "@/core/coagulation/calculate";
import type { CoagulantType } from "@/core/coagulation/profiles";

const run = (id: string, t: CoagulantType, w: Record<string, number>, o: Record<string, string> = {}) =>
  evaluateMethod(builtinAsMethod(builtinById(id)!, t), w, {}, o);
const SNIP = "snip-2.04.02-84-6.16", RD = "rd-153-34.1-37.502-2000-7.4";

describe("СНиП 2.04.02-84*, п. 6.16", () => {
  it("Ц = 64 → 32 мг/л (формула 6)", () => {
    const r = run(SNIP, "Al2(SO4)3", { color: 64 }, { mode: "color" });
    expect(r.status).toBe("ok");
    expect(r.central).toBeCloseTo(32, 12);
    expect(r.basis).toBe("salt");
  });
  it("М = 250, Ц = 25 → max(35–45; 20) = 35–45 мг/л", () => {
    const r = run(SNIP, "Al2(SO4)3", { color: 25, turbidityMg: 250 }, { mode: "max", bound: "mid" });
    expect(r.status).toBe("ok");
    expect(r.low).toBe(35);
    expect(r.high).toBe(45);
    expect(r.central).toBe(40);
  });
  it("цветность больше табличной дозы — принимается большая", () => {
    const r = run(SNIP, "FeCl3", { color: 100, turbidityMg: 50 }, { mode: "max" }); // Dц = 40 > 25–35
    expect(r.low).toBe(40); expect(r.high).toBe(40);
  });
  it("контактный осветлитель: −10…15 %", () => {
    const r = run(SNIP, "Al2(SO4)3", { color: 64 }, { mode: "color", facility: "contact" });
    expect(r.low).toBeCloseTo(32 * 0.85, 12);
    expect(r.high).toBeCloseTo(32 * 0.9, 12);
  });
  it("границы табл. 16: 100 мг/л — строка «до 100», нижняя граница по выбору", () => {
    expect(run(SNIP, "Al2(SO4)3", { turbidityMg: 100 }, { mode: "turbidity", bound: "low" }).central).toBe(25);
    expect(run(SNIP, "Al2(SO4)3", { turbidityMg: 1500 }, { mode: "turbidity", bound: "high" }).central).toBe(80);
  });
  it("мутность > 1500 мг/л — вне таблицы, доза не выдаётся", () => {
    const r = run(SNIP, "Al2(SO4)3", { turbidityMg: 1600 }, { mode: "turbidity" });
    expect(r.status).toBe("outside");
    expect(Number.isNaN(r.central)).toBe(true);
  });
  it("нет данных → nodata, ноль не подставляется", () => {
    expect(run(SNIP, "Al2(SO4)3", { color: 30 }, { mode: "max" }).status).toBe("nodata");
  });
  it("предупреждение об отменённом документе и Св по п. 6.65", () => {
    const r = run(SNIP, "Al2(SO4)3", { color: 25, turbidityMg: 250 }, { mode: "max", kk: "purified" });
    expect(r.warnings!.some((x) => x.includes("отменённого документа"))).toBe(true);
    expect(r.info!.some((x) => x.includes("Св ≈ 276,3"))).toBe(true); // 250 + 0,5·40 + 0,25·25
  });
  it("не применяется к ПОХА и FeSO₄", () => {
    expect(builtinsFor("PACl").some((d) => d.id === SNIP)).toBe(false);
    expect(builtinsFor("FeSO4").length).toBe(0);
  });
});

describe("РД 153-34.1-37.502-2000, п. 7.4", () => {
  it("ПО = 10 → 0,7 мг-экв/л ≈ 11,9 мг/л Al₂O₃ ≈ 39,9 мг/л Al₂(SO₄)₃", () => {
    const r = run(RD, "Al2(SO4)3", { permanganate: 10 });
    expect(r.status).toBe("ok");
    expect(r.basis).toBe("Al2O3");
    expect(r.central).toBeCloseTo(11.9, 1);
    expect(0.7 * eqMass("Al2(SO4)3", "salt")).toBeCloseTo(39.9, 1);
    expect(r.warnings!.some((x) => x.includes("вне типового"))).toBe(false);
  });
  it("эквиваленты солей железа: FeCl₃ × 54,1; Fe₂(SO₄)₃ × 66,6", () => {
    expect(eqMass("FeCl3", "salt")).toBeCloseTo(54.07, 1);
    expect(eqMass("Fe2(SO4)3", "salt")).toBeCloseTo(66.65, 1);
    const r = run(RD, "FeCl3", { permanganate: 10 });
    expect(r.basis).toBe("salt");
    expect(r.central).toBeCloseTo(0.7 * 54.1, 0);
    expect(r.warnings!.some((x) => x.includes("пересчёт по эквиваленту"))).toBe(true);
  });
  it("вне диапазона 0,3–1,5 мг-экв/л — предупреждение", () => {
    expect(run(RD, "Al2(SO4)3", { permanganate: 30 }).warnings!.some((x) => x.includes("вне типового"))).toBe(true);
    expect(run(RD, "Al2(SO4)3", { permanganate: 3 }).warnings!.some((x) => x.includes("вне типового"))).toBe(true);
  });
  it("рабочий pH 5,5–7,5 по п. 6.4 для Al", () => {
    expect(builtinAsMethod(builtinById(RD)!, "Al2(SO4)3").phWindow).toEqual({ min: 5.5, max: 7.5 });
    expect(builtinAsMethod(builtinById(RD)!, "FeCl3").phWindow).toBeNull();
  });
});

describe("справочные методики", () => {
  it("Rodriguez: 3,25 + 0,8·TOC + 2,5·HCO₃ + 0,25·pH", () => {
    const r = run("ref-rodriguez-2000", "Al2(SO4)3", { toc: 5, alkalinity: 2, pH: 7 });
    expect(r.central).toBeCloseTo(3.25 + 4 + 5 + 1.75, 12);
  });
  it("ЗХР: 0,9·(ПОисх − ПОкон), шлам 3,5 мг/мг", () => {
    const r = run("ref-zxr-2020-po", "Al2(SO4)3", { permanganate: 10 }, { poTarget: "4" });
    expect(r.central).toBeCloseTo(5.4, 12);
    expect(run("ref-zxr-2020-po", "Al2(SO4)3", { permanganate: 10 }).status).toBe("nodata");
    expect(run("ref-zxr-2020-po", "Al2(SO4)3", { permanganate: 10 }, { poTarget: "12" }).status).toBe("outside");
  });
  it("у всех методик есть документ, пункт, статус и предупреждение «не окончательная»", () => {
    for (const d of BUILTIN_METHODS) {
      expect(d.doc && d.clause && d.status).toBeTruthy();
      const t = Object.keys(d.coagulants)[0] as CoagulantType;
      const w = { color: 30, turbidityMg: 50, permanganate: 8, toc: 4, alkalinity: 2, pH: 7 };
      const r = run(d.id, t, w, { poTarget: "3", dSA: "40", k: "1" });
      expect(r.status).toBe("ok");
      expect(r.warnings!.some((x) => x.includes("пробной коагуляцией"))).toBe(true);
    }
  });
  it("рекомендация: ВОС → СНиП, ТЭС → РД", () => {
    expect(recommendedBuiltin("vos", "Al2(SO4)3")?.id).toBe(SNIP);
    expect(recommendedBuiltin("tes", "Al2(SO4)3")?.id).toBe(RD);
  });
});

describe("встроенная методика в полном расчёте", () => {
  it("доза СНиП идёт в расходы по безводной соли", () => {
    const inp: CoagInput = {
      coagulant: "Al2(SO4)3",
      passport: { name: "т", form: "solid", hydrateN: 18, concentration: 98, concentrationBasis: "hydrate", workingConcentration: 50, workingBasis: "hydrate" },
      flow: { mode: "coag", nom: 100, min: null, max: null },
      dose: { mode: "method", method: builtinAsMethod(builtinById(SNIP)!, "Al2(SO4)3"), options: { mode: "color" }, accepted: null, min: null, nom: null, max: null, basis: "salt" },
      water: { color: 64, pH: 7, alkalinity: 3 },
      ph: { mode: "none", curve: [] },
      contact: { calc: "timeToVolume", time: 60, timeBasis: "", volume: null, flowBasis: "max", k: null, kBasis: "" },
      pipe: { flowBasis: "max", velocity: 1.5, velocityBasis: "", actualInnerDiameterMm: null },
      pumps: { pointPressureBar: 2, extraLossBar: 0.5, marginPct: null },
    } as unknown as CoagInput;
    const r = calculateCoagulation(inp);
    expect(r.doseInput.nom).toBe(32);
    expect(r.doseMetal.nom).toBeCloseTo((32 * 2 * 26.982) / 342.15, 2);
    expect(r.warnings.some((w) => w[1].includes("отменённого документа"))).toBe(true);
  });
});
