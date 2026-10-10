/**
 * Событийное ядро UF Calc. Детерминированно, без UI.
 * Единицы: время — с, расход — м³/ч, объём — м³, доза — мг/л действующего вещества, масса — кг.
 */
import { vol, volPart, qAt, kP1, kP2, roBalance } from "./balance";
import type { SimParams, StageDef } from "./types";

export const UF_ENGINE_VERSION = "uf-core 0.1.0";
const DAY = 86400;
const EPS = 1e-9;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export const LIMITS = { maxTrains: 40, maxDays: 366, maxWarmup: 30, maxEvents: 8_000_000 };

interface RStage extends StageDef { q0: number; q1: number; ceb?: string | null }

interface DayAcc {
  raw: number; rawFilt: number; uf: number; ff: number; bw: number;
  src: { UF: number; RO1: number; RO2: number };
  drain: Record<string, number>; chem: Record<string, number>; ceb: Record<string, number>;
  cycles: number; wait: number; ext: number; stops: number;
  pieces: [string, number, number, number, number, number][] | null;
  feedMax: number; feedMin: number; bwMax: Record<number, number>;
}

export interface DetailPiece { tr: number; t0: number; t1: number; name: string; kind: string; tag: string; q0: number; q1: number; ceb: string | null }
export interface LogEntry { t: number; tr: number; ceb: string | null; wait: number }

function resolve(s: StageDef, ctx: { A_unit: number; Qf: number; Qff: number }): RStage {
  const f = s.flow;
  let q0 = 0, q1 = 0;
  if (f.u === "filt") { q0 = f.from0 ? 0 : ctx.Qf; q1 = f.to0 ? 0 : ctx.Qf; }
  else if (f.u === "ff") { q0 = f.from0 ? 0 : ctx.Qff; q1 = f.to0 ? 0 : ctx.Qff; }
  else if (f.u === "lmh") { q0 = (f.v0 * ctx.A_unit) / 1000; q1 = (f.v1 * ctx.A_unit) / 1000; }
  else { q0 = f.v0; q1 = f.v1; }
  return { ...s, q0, q1 };
}

export function validate(P: SimParams): string[] {
  const e: string[] = [];
  if (!Number.isInteger(P.N) || P.N < 1) e.push("N — целое не меньше 1.");
  if (P.N > LIMITS.maxTrains) e.push(`N не больше ${LIMITS.maxTrains} в этой версии.`);
  if (!(P.A_unit > 0)) e.push("Площадь установки должна быть положительной.");
  if (!(P.J > 0)) e.push("J должен быть положительным.");
  if (!(P.rec.tFilt > 0)) e.push("Длительность фильтрации должна быть положительной.");
  if (!(P.maxExt >= 0)) e.push("Максимум продления — неотрицательный.");
  if (!(P.eta1 > 0 && P.eta1 <= 1) || !(P.eta2 > 0 && P.eta2 <= 1)) e.push("Выходы ОО: 0 < η ≤ 1 (75 % вводится как 0,75).");
  if (!P.supercycle.length || P.supercycle.some((r) => !Number.isInteger(r.n) || r.n < 1)) e.push("Общий цикл: число обычных циклов — целое ≥ 1 в каждой строке.");
  if (P.supercycle.some((r) => r.ceb && !P.rec.ceb[r.ceb])) e.push("Общий цикл ссылается на отсутствующую программу CEB.");
  const seen = new Set<number>();
  P.groups.forEach((g) => g.forEach((i) => { if (seen.has(i)) e.push(`Установка ${i + 1} входит в несколько групп.`); seen.add(i); }));
  for (let i = 0; i < P.N; i++) if (!seen.has(i)) e.push(`Установка ${i + 1} не входит ни в одну группу BW.`);
  if (!(P.days >= 1 && P.days <= LIMITS.maxDays)) e.push(`Период: 1…${LIMITS.maxDays} сут.`);
  if (!(P.warmupDays >= 0 && P.warmupDays <= LIMITS.maxWarmup)) e.push(`Прогон: 0…${LIMITS.maxWarmup} сут.`);
  const all = [P.rec.filtRamp, P.rec.filtStop, P.rec.preService, P.rec.restart, P.rec.bw, ...Object.values(P.rec.ceb).map((c) => c.stages)].flat();
  if (all.some((s) => !(s.t >= 0))) e.push("Времена стадий неотрицательны.");
  return e;
}

export function simulate(P: SimParams) {
  const errs = validate(P);
  if (errs.length) throw new Error(errs.join(" "));
  const ctx = { A_unit: P.A_unit, Qf: (P.J * P.A_unit) / 1000, Qff: 0 };
  ctx.Qff = P.ffLinked ? ctx.Qf : P.Qff ?? ctx.Qf;
  const R = (l: StageDef[]) => l.map((s) => resolve(s, ctx));
  const T = { FR: R(P.rec.filtRamp), FS: R(P.rec.filtStop), PRE: R(P.rec.preService), RS: R(P.rec.restart), BW: R(P.rec.bw) };
  const CEB: Record<string, RStage[]> = {};
  for (const k in P.rec.ceb) CEB[k] = R(P.rec.ceb[k].stages);
  const tF = P.rec.tFilt;
  const SC = P.supercycle;
  const scLen = SC.reduce((a, r) => a + r.n, 0);
  const totalDays = P.warmupDays + P.days;
  const tEnd = totalDays * DAY;
  const days: DayAcc[] = Array.from({ length: totalDays }, () => ({
    raw: 0, rawFilt: 0, uf: 0, ff: 0, bw: 0, src: { UF: 0, RO1: 0, RO2: 0 }, drain: {}, chem: {}, ceb: {},
    cycles: 0, wait: 0, ext: 0, stops: 0, pieces: [], feedMax: 0, feedMin: 0, bwMax: {},
  }));
  const detailIdx = isNum(P.detailDay) ? P.warmupDays + P.detailDay : -1;
  const detail: DetailPiece[] = [];
  const groupOf: number[] = [];
  P.groups.forEach((g, gi) => g.forEach((i) => (groupOf[i] = gi)));
  const dosingMax: Record<number, Record<string, number>> = {};
  const log: LogEntry[] = [];

  function emit(tr: number, t0: number, s: RStage, a: number, b: number, tag: string) {
    if (b <= a) return;
    let x = a;
    const dur = s.t || b - a;
    while (x < b - EPS) {
      const d = Math.floor((t0 + x) / DAY + 1e-12);
      if (d >= totalDays) break;
      const y = Math.min(b, (d + 1) * DAY - t0);
      const v = volPart(s.q0, s.q1, dur, x, y);
      const D = days[d];
      if (s.from === "raw") { D.raw += v; if (s.produces) D.rawFilt += v; }
      if (s.produces) D.uf += v;
      if (s.from === "UF" || s.from === "RO1" || s.from === "RO2") D.src[s.from] += v;
      if (s.to && s.to !== "UF") D.drain[s.to] = (D.drain[s.to] || 0) + v;
      if (s.kind === "FF") D.ff += v;
      if (s.kind === "BW") D.bw += v;
      if (s.dose) for (const r in s.dose) {
        const g = groupOf[tr];
        const key = `${g}|${r}`;
        D.chem[key] = (D.chem[key] || 0) + (v * s.dose[r]) / 1000;
        const qmax = Math.max(qAt(s.q0, s.q1, dur, x), qAt(s.q0, s.q1, dur, y));
        (dosingMax[g] ??= {})[r] = Math.max(dosingMax[g][r] || 0, (s.dose[r] * qmax) / 1000);
      }
      if (tag === "ext") D.ext += y - x;
      if (tag === "wait") D.wait += y - x;
      const q0 = qAt(s.q0, s.q1, dur, x), q1 = qAt(s.q0, s.q1, dur, y);
      if (s.from === "raw") D.pieces!.push(["F", -1, t0 + x, t0 + y, q0, q1]);
      if (s.station === "bw") D.pieces!.push(["B", groupOf[tr], t0 + x, t0 + y, q0, q1]);
      if (d === detailIdx) detail.push({ tr, t0: t0 + x - d * DAY, t1: t0 + y - d * DAY, name: s.name, kind: s.kind, tag, q0, q1, ceb: s.ceb ?? null });
      x = y;
    }
  }
  const play = (tr: number, t: number, list: RStage[], tag: string) => { for (const s of list) { emit(tr, t, s, 0, s.t, tag); t += s.t; } return t; };
  const filt: RStage = { id: "F", name: "Фильтрация", kind: "F", from: "raw", to: "UF", produces: true, q0: ctx.Qf, q1: ctx.Qf, t: 0, flow: { u: "filt" } };
  const waitS: RStage = { id: "W", name: "Ожидание", kind: "W", from: "none", to: null, q0: 0, q1: 0, t: 0, flow: { u: "m3h", v0: 0, v1: 0 } };

  type Train = { i: number; row: number; cDone: number; state: "F" | "SVC" | "STOP" | "WAIT"; filtStart: number; reqTime: number | null; stopEnd: number; token: number; pending?: { L: RStage[]; willCeb: boolean; ceb: string | null } };
  const trains: Train[] = [];
  for (let i = 0; i < P.N; i++) {
    const pos = P.startPos && isNum(P.startPos[i]) ? P.startPos[i] : Math.floor((i * scLen) / P.N);
    let row = 0, c = pos % scLen;
    while (c >= SC[row].n) { c -= SC[row].n; row++; }
    const ph = P.phase && isNum(P.phase[i]) ? P.phase[i] : 0;
    trains.push({ i, row, cDone: c, state: "F", filtStart: -ph, reqTime: null, stopEnd: 0, token: 0 });
  }
  type Ev = { t: number; type: "END" | "REQ" | "STOPEND" | "EXT"; tr: number; token: number };
  const ORDER = { END: 0, REQ: 1, STOPEND: 2, EXT: 3 };
  let EV: Ev[] = [];
  const push = (t: number, type: Ev["type"], tr: number, token: number) => EV.push({ t, type, tr, token });
  const busy = P.groups.map(() => false);
  const queue: number[][] = P.groups.map(() => []);
  trains.forEach((tr) => push(tr.filtStart + tF, "REQ", tr.i, 0));

  const serviceList = (tr: Train) => {
    const row = SC[tr.row];
    const willCeb = tr.cDone + 1 >= row.n;
    let L = [...T.PRE, ...T.BW];
    if (willCeb && row.ceb && CEB[row.ceb]) L = L.concat(CEB[row.ceb].map((s) => ({ ...s, ceb: row.ceb })));
    return { L, willCeb, ceb: willCeb ? row.ceb : null };
  };
  const emitFilt = (tr: Train, tAbs: number) => {
    const a0 = Math.max(0, -tr.filtStart), len = tAbs - tr.filtStart;
    emit(tr.i, tr.filtStart, filt, a0, Math.min(tF, len), "");
    if (len > tF) emit(tr.i, tr.filtStart, filt, Math.max(a0, tF), len, "ext");
  };
  function grant(gi: number, t: number) {
    const tr = trains[queue[gi].shift() as number];
    busy[gi] = true;
    tr.token++;
    let start = t;
    let pre: RStage[] = [];
    if (tr.state === "F") emitFilt(tr, t);
    else if (tr.state === "STOP") { start = Math.max(t, tr.stopEnd); pre = T.RS; }
    else if (tr.state === "WAIT") { emit(tr.i, tr.stopEnd, waitS, 0, t - tr.stopEnd, "wait"); pre = T.RS; }
    const sv = serviceList(tr);
    let te = play(tr.i, start, pre, "");
    te = play(tr.i, te, pre.length ? sv.L.filter((s) => s.kind !== "FX") : sv.L, "");
    if (t >= P.warmupDays * DAY && log.length < 500) log.push({ t: t - P.warmupDays * DAY, tr: tr.i, ceb: sv.ceb, wait: Math.max(0, t - (tr.reqTime ?? t)) });
    tr.state = "SVC";
    tr.pending = sv;
    push(te, "END", tr.i, tr.token);
  }
  const tryGrant = (t: number) => { for (let gi = 0; gi < P.groups.length; gi++) if (!busy[gi] && queue[gi].length) grant(gi, t); };
  let guard = 0;
  function handle(ev: Ev) {
    const tr = trains[ev.tr], gi = groupOf[ev.tr];
    if (ev.type === "END") {
      busy[gi] = false;
      const sv = tr.pending!;
      const D = days[Math.min(totalDays - 1, Math.floor(ev.t / DAY))];
      D.cycles++;
      if (sv.ceb) D.ceb[sv.ceb] = (D.ceb[sv.ceb] || 0) + 1;
      if (sv.willCeb) { tr.cDone = 0; tr.row = (tr.row + 1) % SC.length; } else tr.cDone++;
      const te = play(tr.i, ev.t, T.FR, "");
      tr.state = "F"; tr.filtStart = te; tr.reqTime = null;
      push(te + tF, "REQ", tr.i, tr.token);
    } else if (ev.type === "REQ") {
      if (ev.token !== tr.token || tr.state !== "F") return;
      tr.reqTime = ev.t;
      queue[gi].push(tr.i);
      queue[gi].sort((a, b) => (trains[a].reqTime as number) - (trains[b].reqTime as number) || a - b);
      push(ev.t + P.maxExt, "EXT", tr.i, tr.token);
    } else if (ev.type === "EXT") {
      if (ev.token !== tr.token || tr.state !== "F") return;
      emitFilt(tr, ev.t);
      const te = play(tr.i, ev.t, T.FS, "");
      days[Math.min(totalDays - 1, Math.floor(ev.t / DAY))].stops++;
      tr.state = te > ev.t ? "STOP" : "WAIT";
      tr.stopEnd = te;
      if (tr.state === "STOP") push(te, "STOPEND", tr.i, tr.token);
    } else if (ev.type === "STOPEND") {
      if (ev.token === tr.token && tr.state === "STOP") tr.state = "WAIT";
    }
    if (++guard > LIMITS.maxEvents) throw new Error("Превышен лимит событий расчёта.");
  }
  // В один момент: завершения → заявки → окончания остановов → разрешения → пределы продления → разрешения.
  while (EV.length) {
    let t = Infinity;
    for (const x of EV) if (x.t < t) t = x.t;
    if (t >= tEnd) break;
    const take = (pred: (x: Ev) => boolean) => {
      const sel = EV.filter((x) => Math.abs(x.t - t) <= EPS && pred(x));
      EV = EV.filter((x) => !(Math.abs(x.t - t) <= EPS && pred(x)));
      return sel;
    };
    take((x) => x.type !== "EXT").sort((a, b) => ORDER[a.type] - ORDER[b.type] || a.tr - b.tr).forEach(handle);
    tryGrant(t);
    // пределы продления этого момента, включая созданные только что (maxExt = 0)
    take((x) => x.type === "EXT").sort((a, b) => a.tr - b.tr).forEach(handle);
    tryGrant(t);
  }
  trains.forEach((tr) => {
    if (tr.state === "F" && tr.filtStart < tEnd) emitFilt(tr, tEnd);
    else if (tr.state === "WAIT" && tr.stopEnd < tEnd) emit(tr.i, tr.stopEnd, waitS, 0, tEnd - tr.stopEnd, "wait");
  });
  for (const D of days) {
    const st = sweep(D.pieces!.filter((p) => p[0] === "F"));
    D.feedMax = st.max; D.feedMin = st.min;
    P.groups.forEach((_, gi) => { D.bwMax[gi] = sweep(D.pieces!.filter((p) => p[0] === "B" && p[1] === gi)).max; });
    D.pieces = null;
  }
  return { days: days.slice(P.warmupDays), detail, dosingMax, ctx, cebStages: CEB, log, engine: UF_ENGINE_VERSION };
}

/** Максимум и минимум суммы кусочно-линейных функций (мгновенный расход станции). */
function sweep(ps: [string, number, number, number, number, number][]) {
  if (!ps.length) return { max: 0, min: 0 };
  const ev: [number, number, number, number][] = [];
  for (const p of ps) { const k = (p[5] - p[4]) / Math.max(EPS, p[3] - p[2]); ev.push([p[2], 1, p[4] - k * p[2], k], [p[3], -1, p[4] - k * p[2], k]); }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let A = 0, B = 0, mx = -Infinity, mn = Infinity, i = 0;
  const t0 = ev[0][0];
  while (i < ev.length) {
    const t = ev[i][0];
    if (i > 0) { const before = A + B * t; mx = Math.max(mx, before); if (t > t0) mn = Math.min(mn, before); }
    while (i < ev.length && ev[i][0] === t) { A += ev[i][1] * ev[i][2]; B += ev[i][1] * ev[i][3]; i++; }
    if (i < ev.length) { const after = A + B * t; mx = Math.max(mx, after); mn = Math.min(mn, after); }
  }
  return { max: Math.max(0, mx), min: Number.isFinite(mn) ? Math.max(0, mn) : 0 };
}

export function summarize(sim: ReturnType<typeof simulate>, P: SimParams) {
  const ds = sim.days;
  const T = { raw: 0, rawFilt: 0, uf: 0, ff: 0, bw: 0, src: { UF: 0, RO1: 0, RO2: 0 }, drain: {} as Record<string, number>, chem: {} as Record<string, number>, ceb: {} as Record<string, number>, cycles: 0, wait: 0, ext: 0, stops: 0 };
  for (const D of ds) {
    T.raw += D.raw; T.rawFilt += D.rawFilt; T.uf += D.uf; T.ff += D.ff; T.bw += D.bw;
    T.cycles += D.cycles; T.wait += D.wait; T.ext += D.ext; T.stops += D.stops;
    T.src.UF += D.src.UF; T.src.RO1 += D.src.RO1; T.src.RO2 += D.src.RO2;
    for (const k in D.drain) T.drain[k] = (T.drain[k] || 0) + D.drain[k];
    for (const k in D.chem) T.chem[k] = (T.chem[k] || 0) + D.chem[k];
    for (const k in D.ceb) T.ceb[k] = (T.ceb[k] || 0) + D.ceb[k];
  }
  const k1 = kP1(P.eta1), k2 = kP2(P.eta1, P.eta2);
  const net = (V: { uf: number; src: { UF: number; RO1: number; RO2: number } }) => V.uf - (V.src.UF + k1 * V.src.RO1 + k2 * V.src.RO2);
  const hours = ds.length * 24;
  const daily = ds.map((D) => ({ net: net(D), raw: D.raw, uf: D.uf, feedMax: D.feedMax, feedMin: D.feedMin }));
  const Vnet = net(T);
  return {
    totals: T, hours, days: ds.length, Vnet, Qnet: Vnet / hours, Q2: T.raw / hours, Q2filt: T.rawFilt / hours,
    Q1unit: sim.ctx.Qf, Q1N: sim.ctx.Qf * P.N,
    daily, dayNetMin: Math.min(...daily.map((d) => d.net)), dayNetMax: Math.max(...daily.map((d) => d.net)),
    feedMax: Math.max(...daily.map((d) => d.feedMax)), feedMin: Math.min(...daily.map((d) => d.feedMin)),
    bwMax: P.groups.map((_, gi) => Math.max(...ds.map((d) => d.bwMax[gi] || 0))),
    ro: roBalance(T.src.RO1, T.src.RO2, P.eta1, P.eta2),
    ownNeeds: { UF: T.src.UF, RO1eq: k1 * T.src.RO1, RO2eq: k2 * T.src.RO2 },
  };
}

export function forward(P: SimParams) {
  const sim = simulate(P);
  return { sim, sum: summarize(sim, P) };
}

/** Один обычный цикл без очередей (тест D и проверки шаблона). */
export function cycleVolumes(P: Pick<SimParams, "A_unit" | "J" | "ffLinked" | "Qff" | "rec">) {
  const ctx = { A_unit: P.A_unit, Qf: (P.J * P.A_unit) / 1000, Qff: 0 };
  ctx.Qff = P.ffLinked ? ctx.Qf : P.Qff ?? ctx.Qf;
  const R = (l: StageDef[]) => l.map((s) => resolve(s, ctx));
  const L: RStage[] = [...R(P.rec.filtRamp), { ...resolve({ id: "F", name: "F", kind: "F", from: "raw", to: "UF", produces: true, t: P.rec.tFilt, flow: { u: "filt" } }, ctx) }, ...R(P.rec.preService), ...R(P.rec.bw)];
  let T = 0, UF = 0, FF = 0, BW = 0, raw = 0;
  for (const s of L) { const v = vol(s.q0, s.q1, s.t); T += s.t; if (s.produces) UF += v; if (s.kind === "FF") FF += v; if (s.from === "UF") BW += v; if (s.from === "raw") raw += v; }
  return { T, UF, FF, BW, raw, net: UF - BW, Qraw: (raw / T) * 3600, Qnet: ((UF - BW) / T) * 3600 };
}

/** U-07: предварительная площадь по нормативному общему циклу одной установки, без очередей. */
export function prelimArea(P: SimParams, targetQnet: number) {
  const all = [P.rec.filtRamp, P.rec.filtStop, P.rec.preService, P.rec.bw, ...Object.values(P.rec.ceb).map((c) => c.stages)].flat();
  const linear = all.every((s) => s.flow.u !== "m3h" || (s.flow.v0 === 0 && s.flow.v1 === 0));
  const A = 1000;
  const ctx = { A_unit: A, Qf: (P.J * A) / 1000, Qff: 0 };
  ctx.Qff = P.ffLinked ? ctx.Qf : P.Qff ?? ctx.Qf;
  const R = (l: StageDef[]) => l.map((s) => resolve(s, ctx));
  let t = 0, uf = 0, UFd = 0, RO1 = 0, RO2 = 0;
  const add = (l: RStage[]) => l.forEach((s) => { const v = vol(s.q0, s.q1, s.t); t += s.t; if (s.produces) uf += v; if (s.from === "UF") UFd += v; if (s.from === "RO1") RO1 += v; if (s.from === "RO2") RO2 += v; });
  for (const r of P.supercycle) {
    for (let k = 0; k < r.n; k++) { add(R(P.rec.filtRamp)); t += P.rec.tFilt; uf += (ctx.Qf * P.rec.tFilt) / 3600; add(R(P.rec.preService)); add(R(P.rec.bw)); }
    if (r.ceb && P.rec.ceb[r.ceb]) add(R(P.rec.ceb[r.ceb].stages));
  }
  const net = uf - (UFd + kP1(P.eta1) * RO1 + kP2(P.eta1, P.eta2) * RO2);
  const specific = net / (t / 3600) / A; // м³/ч нетто на м²
  return { linear, specificNetM3hPerM2: specific, cycleSeconds: t, area: specific > 0 ? targetQnet / specific : NaN, feasible: specific > 0 };
}

/** U-06: обратный решатель J при заданном Qnet. Бисекция с проверкой знака и повторным forward-расчётом. */
export function solveJ(P: SimParams, target: number, opt: { lo?: number; hi?: number; tol?: number; maxIt?: number } = {}) {
  const lo0 = opt.lo ?? 5, hi0 = opt.hi ?? 250, tol = opt.tol ?? 0.02, maxIt = opt.maxIt ?? 40;
  const iterations: { J: number; Qnet: number }[] = [];
  const f = (J: number) => { const r = forward({ ...P, J }).sum; iterations.push({ J, Qnet: r.Qnet }); return r.Qnet - target; };
  let lo = lo0, hi = hi0;
  let flo = f(lo);
  const fhi = f(hi);
  if (flo * fhi > 0) return { status: fhi < 0 ? ("unreachable" as const) : ("belowRange" as const), bounds: [lo0, hi0], deficit: fhi < 0 ? -fhi : null, iterations, tol };
  let J = NaN, fJ = NaN;
  for (let k = 0; k < maxIt; k++) {
    J = (lo + hi) / 2;
    fJ = f(J);
    if (Math.abs(fJ) <= tol) break;
    if (flo * fJ < 0) hi = J; else { lo = J; flo = fJ; }
  }
  const check = forward({ ...P, J }).sum;
  return { status: Math.abs(check.Qnet - target) <= tol ? ("converged" as const) : ("notConverged" as const), J, residual: check.Qnet - target, check, bounds: [lo0, hi0], iterations, tol };
}
