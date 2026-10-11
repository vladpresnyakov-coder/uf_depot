import { describe, it, expect } from "vitest";
import { vol, volPart, dosing, roBalance, kP1, kP2, head } from "@/core/uf/balance";
import { cycleVolumes, forward, solveJ, prelimArea, validate } from "@/core/uf/engine";
import { defaultRecipes, applySources, testDRecipes } from "@/core/uf/templates";
import type { SimParams } from "@/core/uf/types";

const T9 = 1e-9;
const base = (over: Partial<SimParams> = {}): SimParams => ({
  N: 4, groups: [[0, 1, 2, 3]], phase: [0, 450, 900, 1350], A_unit: 1440, J: 60, ffLinked: true,
  rec: applySources(defaultRecipes()), supercycle: [{ n: 15, ceb: "CEB1.1A" }, { n: 10, ceb: "CEB3" }],
  maxExt: 300, warmupDays: 2, days: 14, eta1: 0.75, eta2: 0.9, detailDay: 0, ...over,
});

describe("§24.1 численные проверки", () => {
  it("A — линейный разгон 0→100 м³/ч за 10 с", () => {
    expect(vol(0, 100, 10)).toBeCloseTo(0.1388888889, 9);
    expect(volPart(0, 100, 10, 0, 5)).toBeCloseTo(0.0347222222, 9);
  });
  it("B — дозирование", () => {
    const r = dosing(20, 100, 0.1, 1.2);
    expect(r.activeKgH).toBeCloseTo(2, 12);
    expect(r.commercialKgH).toBeCloseTo(20, 12);
    expect(r.commercialLH).toBeCloseTo(16.6666666667, 9);
  });
  it("C — 1 м³ пермеата ОО-2 при 0,75/0,90", () => {
    const r = roBalance(0, 1, 0.75, 0.9);
    expect(r.F1).toBeCloseTo(1.4814814815, 9);
    expect(r.R2).toBeCloseTo(0.1111111111, 9);
    expect(r.UF).toBeCloseTo(1.3703703704, 9);
    expect(r.C1).toBeCloseTo(0.3703703704, 9);
    expect(Math.abs(r.check)).toBeLessThan(T9);
    expect(kP1(0.75)).toBeCloseTo(1.3333333333, 9);
    expect(kP2(0.75, 0.9)).toBeCloseTo(1.3703703704, 9);
  });
  it("D — синтетический фильтроцикл", () => {
    const d = cycleVolumes({ A_unit: 1000, J: 50, ffLinked: true, rec: testDRecipes() });
    expect(d.T).toBeCloseTo(1904, 9);
    expect(d.UF).toBeCloseTo(25, 9);
    expect(d.FF).toBeCloseTo(0.4166666667, 9);
    expect(d.BW).toBeCloseTo(4.2805555556, 9);
    expect(d.raw).toBeCloseTo(25.4166666667, 9);
    expect(d.net).toBeCloseTo(20.7194444444, 9);
    expect(d.Qraw).toBeCloseTo(48.0567226891, 9);
    expect(d.Qnet).toBeCloseTo(39.1754201681, 9);
  });
});

describe("§24.2 функциональные проверки", () => {
  const F = forward(base());
  const s = F.sum;

  it("общий цикл 15 C → CEB 1.1(A) → 10 C → CEB 3: 12,5 обычных цикла на CEB", () => {
    const a = s.totals.ceb["CEB1.1A"] ?? 0, b = s.totals.ceb["CEB3"] ?? 0;
    expect(Math.abs(s.totals.cycles / (a + b) - 12.5)).toBeLessThan(0.6);
    expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
  });

  it("баланс: вход = выход за период", () => {
    const t = s.totals;
    const drains = Object.values(t.drain).reduce((x, y) => x + y, 0);
    const bal = t.raw + t.src.UF + t.src.RO1 + t.src.RO2 - (t.uf + drains);
    expect(Math.abs(bal)).toBeLessThan(1e-6 * t.raw);
  });

  it("в группе BW/CEB не пересекаются, выдержка держит блокировку", () => {
    const st = F.sim.detail.filter((x) => ["BW", "CEB", "SOAK", "RINSE"].includes(x.kind)).sort((a, b) => a.t0 - b.t0);
    const byTr = new Map<number, { t0: number; t1: number; tr: number }[]>();
    for (const x of st) {
      const L = byTr.get(x.tr) ?? [];
      const last = L[L.length - 1];
      if (last && x.t0 - last.t1 < 1e-6) last.t1 = x.t1; else L.push({ t0: x.t0, t1: x.t1, tr: x.tr });
      byTr.set(x.tr, L);
    }
    const blocks = [...byTr.values()].flat().sort((a, b) => a.t0 - b.t0);
    let overlaps = 0;
    for (let i = 1; i < blocks.length; i++) for (let j = 0; j < i; j++) if (blocks[i].tr !== blocks[j].tr && blocks[i].t0 < blocks[j].t1 - 1e-6) overlaps++;
    expect(blocks.length).toBeGreaterThan(10);
    expect(overlaps).toBe(0);
  });

  it("год не равен первым суткам × число суток", () => {
    expect(s.dayNetMax).not.toBe(s.dayNetMin);
  });

  it("разные группы — отдельные BW-станции", () => {
    const r = forward(base({ groups: [[0, 1], [2, 3]], days: 3 })).sum;
    expect(r.bwMax.length).toBe(2);
  });

  it("продление 0: продления нет, ожидание учитывается", () => {
    const r = forward(base({ maxExt: 0, phase: [0, 0, 0, 0], days: 3 })).sum;
    expect(r.totals.ext).toBeLessThan(1e-6);
    expect(r.totals.wait).toBeGreaterThan(0);
  });

  it("реагенты не дозируются на выдержке и отмывках", () => {
    const stages = F.sim.cebStages["CEB1.1A"];
    expect(stages.filter((x) => x.kind === "SOAK" || x.kind === "RINSE").every((x) => !x.dose)).toBe(true);
  });

  it("CEB 1 без промежуточной фильтрации; самостоятельная щелочная без кислоты", () => {
    const rec = defaultRecipes();
    expect(rec.ceb.CEB1.stages.some((x) => x.kind === "FR" || x.kind === "F")).toBe(false);
    expect(rec.ceb["CEB1.1A"].stages.some((x) => x.dose && "HCl" in x.dose)).toBe(false);
  });

  it("источник CEB действует на подачу и все отмывки; обычная BW остаётся на УФ", () => {
    const rec = defaultRecipes();
    rec.ceb.CEB3.src = "RO2";
    applySources(rec);
    expect(rec.ceb.CEB3.stages.filter((x) => x.from !== "none").every((x) => x.from === "RO2")).toBe(true);
    expect(rec.bw.every((x) => x.from === "UF")).toBe(true);
  });

  it("обратный решатель подтверждается повторным forward-расчётом", () => {
    const P = base({ days: 7 });
    const target = s.Qnet * 0.95;
    const r = solveJ(P, target, { lo: 20, hi: 120, tol: 0.05 });
    expect(r.status).toBe("converged");
    if (r.status === "converged") expect(Math.abs(forward({ ...P, J: r.J }).sum.Qnet - target)).toBeLessThanOrEqual(0.05);
  });

  it("недостижимая цель возвращает дефицит, а не результат за границей", () => {
    const r = solveJ(base({ days: 2 }), 1e6, { lo: 20, hi: 120 });
    expect(r.status).toBe("unreachable");
  });

  it("предварительная площадь: положительная при штатном режиме", () => {
    const p = prelimArea(base(), 250);
    expect(p.feasible).toBe(true);
    expect(p.linear).toBe(true);
  });

  it("проверки входов", () => {
    expect(validate(base({ N: 0 })).length).toBeGreaterThan(0);
    expect(validate(base({ eta1: 75 })).length).toBeGreaterThan(0);
    expect(validate(base({ groups: [[0, 1, 2]] })).some((e) => e.includes("не входит"))).toBe(true);
  });

  it("напор: неполные данные дают перечень полей; TMP учитывается один раз", () => {
    expect(head({ p_in: 0 }).complete).toBe(false);
    const h = head({ p_in: 0, p_out: 0, z_in: 0, z_out: 0, h_loss: 0, dp_membrane_bar: 1.5 });
    expect(h.complete && h.H).toBeCloseTo((1.5e5) / (998 * 9.80665), 6);
  });
});

import { sizeModules } from "@/core/uf/sizing";
describe("режим B: подбор модулей по подаче и J", () => {
  it("расчётное m и округление вверх; подача сохранена — J пересчитан", () => {
    const r = sizeModules({ feedPerUnit: 40, J: 60, moduleArea: 60, keep: "feed" }); // 40000/3600 = 11,11
    expect(r.mCalc).toBeCloseTo(11.111, 3);
    expect(r.m).toBe(12);
    expect(r.J).toBeCloseTo(40000 / 720, 9); // 55,56
    expect(r.feedPerUnit).toBe(40);
  });
  it("вторая итерация: пользователь задаёт чётное число; J сохранён — подача пересчитана", () => {
    const r = sizeModules({ feedPerUnit: 40, J: 60, moduleArea: 60, modules: 14, keep: "J" });
    expect(r.m).toBe(14);
    expect(r.J).toBe(60);
    expect(r.feedPerUnit).toBeCloseTo(50.4, 9);
    expect(r.notes.some((n) => n.includes("изменено пользователем"))).toBe(true);
  });
  it("целое расчётное m не округляется лишний раз", () => {
    expect(sizeModules({ feedPerUnit: 36, J: 50, moduleArea: 60, keep: "feed" }).m).toBe(12);
  });
});
