import { forward, prelimArea, solveJ, UF_ENGINE_VERSION } from "@/core/uf/engine";
import { applySources, defaultRecipes, DRAIN_LABELS } from "@/core/uf/templates";
import type { SimParams } from "@/core/uf/types";
import { errorResponse, InputError, num, oneOf, readJson } from "@/lib/validate";

export const maxDuration = 120;

const CEB_KEYS = ["CEB1.1A", "CEB1.1B", "CEB1", "CEB2", "CEB3"] as const;

export async function POST(req: Request) {
  try {
    const b = await readJson(req);
    const mode = oneOf(b.mode, "режим", ["A", "C"] as const);
    const N = num(b.N, "N", { min: 1, max: 40, int: true }) as number;
    const X = num(b.X, "X", { min: 0, max: 40, int: true }) as number;
    const a = num(b.moduleArea, "площадь модуля", { min: 0.1, max: 500 }) as number;
    const m = num(b.modules, "модулей в установке", { min: 1, max: 500, int: true }) as number;
    const J = num(b.J, "J", { min: 1, max: 300 }) as number;
    const nGroups = num(b.groups, "групп BW", { min: 1, max: N, int: true }) as number;
    const maxExt = num(b.maxExt, "продление", { min: 0, max: 7200 }) as number;
    const tFilt = num(b.tFilt, "длительность фильтрации", { min: 60, max: 36000 }) as number;
    const eta1 = num(b.eta1, "η1", { min: 0.01, max: 1 }) as number;
    const eta2 = num(b.eta2, "η2", { min: 0.01, max: 1 }) as number;
    const days = num(b.days ?? 365, "период", { min: 1, max: 365, int: true }) as number;
    const target = mode === "C" ? (num(b.target, "требуемый Qnet", { min: 0.1 }) as number) : null;
    const sc = Array.isArray(b.supercycle) ? (b.supercycle as unknown[]) : [];
    if (!sc.length || sc.length > 12) throw new InputError("Общий цикл: от 1 до 12 строк.");
    const supercycle = sc.map((r, i) => {
      const row = r as Record<string, unknown>;
      return { n: num(row.n, `циклов в строке ${i + 1}`, { min: 1, max: 1000, int: true }) as number, ceb: oneOf(row.ceb, `программа в строке ${i + 1}`, CEB_KEYS) };
    });
    const rec = defaultRecipes();
    rec.tFilt = tFilt;
    const src = (b.cebSources ?? {}) as Record<string, unknown>;
    for (const k of CEB_KEYS) if (src[k]) rec.ceb[k].src = oneOf(src[k], `источник ${k}`, ["UF", "RO1", "RO2"] as const);
    applySources(rec);
    const groups: number[][] = Array.from({ length: nGroups }, () => []);
    for (let i = 0; i < N; i++) groups[i % nGroups].push(i);
    const phase: number[] = [];
    groups.forEach((g) => g.forEach((tr, k) => (phase[tr] = (k * tFilt) / g.length)));
    const A_unit = a * m;
    const P: SimParams = { N, groups, phase, A_unit, J, ffLinked: true, rec, supercycle, maxExt, warmupDays: 7, days, eta1, eta2, detailDay: 0 };

    const t0 = Date.now();
    const prelim = target ? prelimArea(P, target) : null;
    let solver: Record<string, unknown> | null = null;
    let Jfinal = J;
    if (mode === "C" && target) {
      const s = solveJ({ ...P, days: 28, warmupDays: 3 }, target, { lo: 5, hi: 250, tol: 0.02 });
      solver = { status: s.status, bounds: s.bounds, iterations: s.iterations.length, tol: s.tol, deficit: "deficit" in s ? s.deficit : null, searchDays: 28 };
      if (s.status === "converged" || s.status === "notConverged") {
        let lo = s.J * 0.97, hi = s.J * 1.03, Jb = s.J, res: number;
        for (let k = 0; k < 8; k++) {
          res = forward({ ...P, J: Jb }).sum.Qnet - target;
          if (Math.abs(res) <= 0.02) break;
          if (res < 0) lo = Jb; else hi = Jb;
          Jb = (lo + hi) / 2;
        }
        Jfinal = Jb;
      } else {
        return Response.json({ engine: UF_ENGINE_VERSION, mode, prelim, solver, result: null });
      }
    }
    const F = forward({ ...P, J: Jfinal });
    const s = F.sum;
    if (solver && target) {
      // невязка и статус — по итоговому forward-расчёту на полном периоде
      solver.residualYear = s.Qnet - target;
      solver.statusYear = Math.abs(s.Qnet - target) <= 0.02 ? "converged" : "notConverged";
    }
    const chem: Record<string, number> = {};
    for (const k in s.totals.chem) { const r = k.split("|")[1]; chem[r] = (chem[r] || 0) + s.totals.chem[k]; }
    return Response.json({
      engine: UF_ENGINE_VERSION, mode, ms: Date.now() - t0,
      layout: { N, X, modules: m, moduleArea: a, A_unit, A_work: N * A_unit, A_installed: (N + X) * A_unit, groups },
      J: { initial: J, final: Jfinal },
      prelim, solver,
      result: {
        Q1unit: s.Q1unit, Q1N: s.Q1N, Q2: s.Q2, Q2filt: s.Q2filt, Qnet: s.Qnet, Vnet: s.Vnet, days: s.days,
        dayNetMin: s.dayNetMin, dayNetMax: s.dayNetMax, daily: s.daily.map((d) => Math.round(d.net * 10) / 10),
        feedMin: s.feedMin, feedMax: s.feedMax, bwMax: s.bwMax,
        totals: { raw: s.totals.raw, uf: s.totals.uf, ff: s.totals.ff, bw: s.totals.bw, src: s.totals.src, cycles: s.totals.cycles, ceb: s.totals.ceb, waitH: s.totals.wait / 3600, extH: s.totals.ext / 3600, stops: s.totals.stops },
        drains: Object.entries(s.totals.drain).map(([k, v]) => ({ key: k, label: DRAIN_LABELS[k] ?? k, m3: v })),
        ownNeeds: s.ownNeeds, ro: s.ro, chemicalsKg: chem, dosingMaxKgH: F.sim.dosingMax,
        detail: F.sim.detail.map((d) => ({ tr: d.tr, t0: Math.round(d.t0), t1: Math.round(d.t1), kind: d.tag === "ext" ? "ext" : d.tag === "wait" ? "W" : d.kind })),
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
