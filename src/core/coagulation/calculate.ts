import { ATOMIC, isNum } from "../units/chem";
import { PROFILES, metalFraction, basisLabel, type Basis, type CoagulantType } from "./profiles";
import { evaluateMethod, assessPhCorrection, type DoseMethod, type WaterQuality, type MethodResult } from "./doseMethod";

export const COAG_ENGINE_VERSION = "coag-core 0.1.0";

export type Status = "user" | "prelim" | "clarify" | "incomplete" | "nodata";
export type Origin = "input" | "user" | "balance" | "rule" | "assumption" | "note" | "nodata";

export interface FlowInput {
  mode: "coag" | "uf";
  /** coag: Qном задаёт пользователь, Qmin/Qmax необязательны. */
  nom?: number | null; min?: number | null; max?: number | null;
  /** uf: число рабочих установок и подача исходной воды на одну. */
  trains?: number | null; perTrain?: number | null;
  minOverride?: number | null; maxOverride?: number | null;
}

export interface Passport {
  name: string;
  form: "liquid" | "solid";
  hydrateN?: number | null;
  concentration: number | null; // % масс.
  concentrationBasis: Basis | null;
  density?: number | null; // кг/л
  basicity?: number | null; // %
  basicityDefinition?: string;
  freeAcidity?: number | null;
  workingConcentration?: number | null; // г/л
  workingBasis?: Basis | null;
}

export interface CoagInput {
  coagulant: CoagulantType;
  passport: Passport;
  flow: FlowInput;
  dose: { mode?: "manual" | "method"; method?: DoseMethod | null; options?: Record<string, string>; accepted?: number | null; min: number | null; nom: number | null; max: number | null; basis: Basis; hydrateN?: number | null };
  water: WaterQuality & { oxidant?: string | null };
  ph: {
    mode: "none" | "acid" | "base" | "unknown";
    reagent?: "HCl" | "H2SO4" | "NaOH";
    method?: "manual" | "curve";
    dose100?: number | null;
    target?: number | null;
    curve?: [number, number][];
    massFraction?: number | null; // доля 0..1
    density?: number | null;
    working100?: number | null; // г/л по 100 %
  };
  contact: { calc: "timeToVolume" | "volumeToTime"; time?: number | null; timeBasis?: string; volume?: number | null; flowBasis: "min" | "nom" | "max"; k?: number | null; kBasis?: string };
  pipe: { flowBasis: "min" | "nom" | "max"; velocity?: number | null; velocityBasis?: string; actualInnerDiameterMm?: number | null };
  pumps: { pointPressureBar?: number | null; extraLossBar?: number | null; marginPct?: number | null };
  feso4OxidationStatus?: "unchecked" | "required" | "method" | "test";
}

export interface TraceRow { label: string; formula: string; result: string; origin: Origin }
export interface TraceStage { stage: string; title: string; rows: TraceRow[] }

const f = (x: number, d = 3) => (isNum(x) ? Number(x.toFixed(d)).toLocaleString("ru-RU", { maximumFractionDigits: d }) : "—");

export function effectiveFlows(fl: FlowInput) {
  if (fl.mode === "uf") {
    const one = fl.perTrain ?? NaN;
    const all = isNum(fl.perTrain) && isNum(fl.trains) ? fl.perTrain * fl.trains : NaN;
    return {
      min: isNum(fl.minOverride) ? fl.minOverride : one, nom: all, max: isNum(fl.maxOverride) ? fl.maxOverride : all,
      minSource: isNum(fl.minOverride) ? "задано" : "1 установка", maxSource: isNum(fl.maxOverride) ? "задано" : "= Qном",
    };
  }
  const nom = fl.nom ?? NaN;
  return {
    min: isNum(fl.min) ? fl.min : nom, nom, max: isNum(fl.max) ? fl.max : nom,
    minSource: isNum(fl.min) ? "задано" : "= Qном", maxSource: isNum(fl.max) ? "задано" : "= Qном",
  };
}

export function calculateCoagulation(inp: CoagInput) {
  const W: ["warn" | "bad" | "info", string][] = [];
  const A: string[] = [];
  const trace: TraceStage[] = [];
  const P = PROFILES[inp.coagulant];
  const pp = inp.passport;
  const Q = effectiveFlows(inp.flow);
  const qOk = [Q.min, Q.nom, Q.max].every((x) => isNum(x) && x > 0) && Q.min <= Q.nom && Q.nom <= Q.max;
  if (!qOk) W.push(["bad", "Расходы: нужно Qmin ≤ Qном ≤ Qmax, все больше нуля."]);
  if (inp.flow.mode === "uf" && qOk && (inp.flow.trains ?? 1) > 1)
    W.push(["warn", `Работа одной установки (${f(Q.min, 1)} м³/ч): насос-дозатор должен обеспечивать равномерный впрыск при минимальной подаче; проверить смешение и скорость в трубопроводе.`]);
  trace.push({ stage: "IN", title: "Исходные данные", rows: [
    { label: "Коагулянт", formula: `${P.label} · ${P.oxidation}`, result: pp.name || "—", origin: "input" },
    { label: "Расход", formula: `Qmin (${Q.minSource}) / Qном / Qmax (${Q.maxSource})`, result: `${f(Q.min, 1)} / ${f(Q.nom, 1)} / ${f(Q.max, 1)} м³/ч`, origin: "input" },
  ] });

  // Паспорт
  let wProd = NaN;
  if (isNum(pp.concentration) && pp.concentration > 0 && pp.concentrationBasis && pp.concentrationBasis !== "product")
    wProd = (pp.concentration / 100) * metalFraction(inp.coagulant, pp.concentrationBasis, pp.hydrateN);
  const passportOk = isNum(wProd) && wProd > 0 && wProd <= 1;
  if (!passportOk) W.push(["bad", "Паспорт: укажите концентрацию и её базу. Концентрация без базы не принимается."]);
  if (isNum(pp.concentration) && pp.concentration > 100) W.push(["bad", "Концентрация больше 100 % масс."]);
  if (pp.form === "liquid" && !isNum(pp.density)) W.push(["warn", "Нет плотности товарного раствора — л/ч товарного продукта не рассчитываются."]);
  if (pp.form === "liquid" && isNum(pp.density) && (pp.density < 0.8 || pp.density > 2)) W.push(["warn", "Плотность вне 0,8–2,0 кг/л — проверьте паспорт."]);

  // Этап 1 — выбор дозы: заданная пользователем или по методике
  const dIn = inp.dose;
  let method: MethodResult | null = null;
  let d = { ...dIn };
  const stage1: TraceRow[] = [];
  if (dIn.mode === "method" && dIn.method && dIn.method.model !== "manual") {
    method = evaluateMethod(dIn.method, inp.water, { w_me: wProd, basicity: pp.basicity ?? null, density: pp.density ?? null }, dIn.options ?? {});
    for (const x of method.warnings ?? []) W.push(["warn", x]);
    for (const x of method.info ?? []) W.push(["info", x]);
    stage1.push(...method.rows.map((r) => ({ label: r.label, formula: r.formula, result: r.result, origin: "rule" as Origin })));
    if (method.status === "ok") {
      const acc = isNum(dIn.accepted) ? dIn.accepted : method.central;
      d = { ...dIn, basis: method.basis, nom: isNum(acc) ? acc : null, min: isNum(acc) ? Math.min(method.low, acc) : method.low, max: isNum(acc) ? Math.max(method.high, acc) : method.high };
      stage1.push({ label: "Доза, принятая пользователем", formula: isNum(dIn.accepted) ? "задана пользователем" : "= центральная оценка методики", result: isNum(acc) ? `${f(acc)} мг/л ${basisLabel(inp.coagulant, method.basis)}` : "не выбрана", origin: isNum(dIn.accepted) ? "user" : "rule" });
      if (!isNum(acc)) W.push(["bad", "Методика не задаёт центральную оценку: примите расчётную дозу внутри диапазона."]);
      else if (acc < method.low || acc > method.high) W.push(["warn", "Принятая доза вне диапазона методики."]);
      W.push(["info", dIn.method.model === "builtin" ? "Доза рассчитана по встроенной методике — расчётная (ориентировочная) доза, не окончательная проектная." : "Доза рассчитана по методике пользователя — предварительная оценка, не подтверждённый оптимум."]);
    } else {
      d = { ...dIn, min: null, nom: null, max: null };
      if (method.status === "nodata") W.push(["bad", `Недостаточно данных для методики: ${method.missing.join(", ")}.`]);
      if (method.status === "outside") W.push(["bad", `Вне области применимости методики: ${method.outside.join("; ")}. Доза по методике не выдаётся.`]);
      if (method.status === "invalid") W.push(["bad", `Методика некорректна: ${method.errors.join(" ")}`]);
    }
  } else {
    stage1.push({ label: "Методика", formula: "ручная доза (опубликована)", result: "", origin: "user" });
  }
  const toMe = (x: number | null) => {
    if (!isNum(x)) return NaN;
    return d.basis === "product" ? x * wProd : x * metalFraction(inp.coagulant, d.basis, d.hydrateN);
  };
  const dMe = { min: toMe(d.min), nom: toMe(d.nom), max: toMe(d.max) };
  const doseOk = [dMe.min, dMe.nom, dMe.max].every(isNum);
  if (!doseOk && !method) W.push(["bad", "Нужны Dmin, Dном, Dmax с базой (и паспорт при базе «товарный продукт»)."]);
  else if (doseOk && !(dMe.min <= dMe.nom && dMe.nom <= dMe.max)) W.push(["bad", "Дозы: нужно Dmin ≤ Dном ≤ Dmax."]);
  const bl = basisLabel(inp.coagulant, d.basis, d.hydrateN);
  stage1.push({ label: "Диапазон и расчётная доза", formula: "Dmin / Dном / Dmax", result: `${f(d.min ?? NaN)} / ${f(d.nom ?? NaN)} / ${f(d.max ?? NaN)} мг/л ${bl}`, origin: method ? "rule" : "user" });
  trace.push({ stage: "1", title: "Выбор дозы", rows: stage1 });

  // Этап 2 — конверсия базы
  const conv: { basis: string; min: number; nom: number; max: number }[] = [];
  for (const b of P.bases) {
    const hn = b === "hydrate" ? (d.basis === "hydrate" ? d.hydrateN : pp.hydrateN ?? (inp.coagulant === "FeSO4" ? 7 : inp.coagulant === "FeCl3" ? 6 : 18)) : null;
    const w = b === "product" ? wProd : metalFraction(inp.coagulant, b, hn);
    conv.push({ basis: basisLabel(inp.coagulant, b, hn), min: dMe.min / w, nom: dMe.nom / w, max: dMe.max / w });
  }
  trace.push({ stage: "2", title: "Конверсия базы дозирования", rows: [
    { label: "Внутренняя база", formula: `мг/л ${P.metal}; w(${bl}) = ${f(d.basis === "product" ? wProd : metalFraction(inp.coagulant, d.basis, d.hydrateN), 4)}`, result: `Dном = ${f(dMe.nom)} мг/л ${P.metal}`, origin: "balance" },
  ] });

  // Этап 3 — товарный и рабочий растворы
  let cWorkMe = NaN;
  if (isNum(pp.workingConcentration) && pp.workingConcentration > 0 && pp.workingBasis)
    cWorkMe = pp.workingBasis === "product" ? pp.workingConcentration * wProd : pp.workingConcentration * metalFraction(inp.coagulant, pp.workingBasis, pp.hydrateN);
  if (!isNum(cWorkMe)) W.push(["warn", "Не задана концентрация рабочего раствора с базой — подача насоса не рассчитывается."]);
  const flowAt = (dm: number, q: number) => {
    const Mme = (dm * q) / 1000, Dp = dm / wProd, Mp = (Dp * q) / 1000;
    return { q, Mme, Dp, Mp, Lp: pp.form === "liquid" && isNum(pp.density) ? Mp / pp.density : NaN, Lw: isNum(cWorkMe) ? (dm * q) / cWorkMe : NaN };
  };
  const flows = (["min", "nom", "max"] as const).map((k) => ({ k, ...flowAt(dMe.nom, Q[k]) }));
  trace.push({ stage: "3", title: "Товарный и рабочий растворы", rows: [
    { label: "Доля металла в товарном продукте", formula: `${f(pp.concentration ?? NaN)} % × w`, result: `${f(wProd * 100, 4)} % ${P.metal}`, origin: "balance" },
    { label: "Товарный продукт при Qном", formula: `D_прод × Q / 1000 = ${f(flows[1].Dp)} × ${f(Q.nom, 1)} / 1000`, result: `${f(flows[1].Mp)} кг/ч`, origin: "balance" },
    { label: "Рабочий раствор при Qном", formula: `D × Q / C (одна база ${P.metal})`, result: `${f(flows[1].Lw)} л/ч`, origin: "balance" },
  ] });
  if (P.type === "PACl") A.push("Для ПОХА расход показан отдельно по Al, Al₂O₃ и товарному продукту; поле «100 % ПОХА» не используется.");

  // Этап 4 — теоретический кислотно-основной баланс
  let alkF = P.alkalinityEqPerMmol / ATOMIC[P.metal];
  let alkNote = `${P.alkalinityEqPerMmol} мг-экв/ммоль ÷ ${f(ATOMIC[P.metal], 3)}`;
  if (P.usesBasicity) {
    if (isNum(pp.basicity) && pp.basicityDefinition) { alkF *= 1 - pp.basicity / 100; alkNote += ` × (1 − ${f(pp.basicity)} %)`; }
    else { alkF = NaN; W.push(["warn", "Для баланса щёлочности ПОХА нужны основность и её определение."]); }
  }
  const alk = { factor: alkF, atNom: dMe.nom * alkF, atMax: dMe.max * alkF, water: inp.water.alkalinity ?? NaN };
  if (isNum(alk.atMax) && isNum(alk.water) && alk.atMax > alk.water)
    W.push(["warn", "Теоретический расход щёлочности при Dmax превышает щёлочность исходной воды — требуется уточнение (стехиометрия, не прогноз pH)."]);
  if (!isNum(pp.freeAcidity)) A.push("Свободная кислотность продукта не задана и не учтена в балансе щёлочности.");
  A.push("Баланс щёлочности: принят полный гидролиз до M(OH)₃; pH по нему не прогнозируется.");
  trace.push({ stage: "4", title: "Теоретический кислотно-основной баланс", rows: [
    { label: "Удельный расход щёлочности", formula: alkNote, result: `${f(alkF, 4)} мг-экв/мг ${P.metal}`, origin: "balance" },
    { label: "При Dном / Dmax", formula: "D × удельный расход", result: `${f(alk.atNom)} / ${f(alk.atMax)} мг-экв/л`, origin: "balance" },
    { label: "Ограничение", formula: "не прогноз pH и не расчёт дозы кислоты/щёлочи", result: "", origin: "note" },
  ] });

  const phNeed = assessPhCorrection(inp.water, dIn.mode === "method" ? dIn.method?.phWindow ?? null : null, alk.atMax);

  // Этап 5 — коррекция pH
  const ph = inp.ph;
  let phRes: { mode: string; dose100: number; source: string; flows: { k: string; q: number; M100: number; Mc: number; Lc: number; Lw: number }[] } | null = null;
  if (ph.mode === "acid" || ph.mode === "base") {
    let dose = NaN, src = "";
    if (ph.method === "curve") {
      const c = [...(ph.curve ?? [])].filter((p) => isNum(p[0]) && isNum(p[1])).sort((a, b) => a[1] - b[1]);
      const tg = ph.target;
      if (isNum(tg) && c.length >= 2 && tg >= c[0][1] && tg <= c[c.length - 1][1]) {
        for (let i = 1; i < c.length; i++) if (tg <= c[i][1]) { const [a, b] = [c[i - 1], c[i]]; dose = a[0] + ((tg - a[1]) * (b[0] - a[0])) / (b[1] - a[1]); break; }
        src = "интерполяция титрационной кривой";
      } else W.push(["warn", "Целевой pH вне диапазона титрационной кривой — доза не определяется (экстраполяция запрещена)."]);
    } else { dose = ph.dose100 ?? NaN; src = "задано пользователем"; }
    if (!isNum(dose)) W.push(["warn", "Доза кислоты/щёлочи не определена: точный расход по разности pH не рассчитывается."]);
    const w = ph.massFraction ?? NaN;
    phRes = { mode: ph.mode, dose100: dose, source: src, flows: (["min", "nom", "max"] as const).map((k) => {
      const M100 = (dose * Q[k]) / 1000, Mc = M100 / w;
      return { k, q: Q[k], M100, Mc, Lc: isNum(ph.density) ? Mc / ph.density : NaN, Lw: isNum(ph.working100) ? (dose * Q[k]) / ph.working100 : NaN };
    }) };
  } else if (ph.mode === "unknown") W.push(["warn", "Необходимость коррекции pH не определена: недостаточно данных."]);
  trace.push({ stage: "5", title: "Определение коррекции pH", rows: [
    { label: "Решение", formula: { none: "коррекция не предусмотрена", unknown: "недостаточно данных", acid: `кислота ${ph.reagent ?? ""}`, base: `щёлочь ${ph.reagent ?? ""}` }[ph.mode], result: phRes ? `${f(phRes.dose100)} мг/л 100 %` : "—", origin: phRes && isNum(phRes.dose100) ? "user" : ph.mode === "none" ? "user" : "nodata" },
  ] });

  // FeSO4
  let fe: { o2Need: number; o2: number; status: string; missing: string[] } | null = null;
  if (inp.coagulant === "FeSO4") {
    const miss: string[] = [];
    if (!isNum(inp.water.o2) && !inp.water.oxidant) miss.push("растворённый кислород или окислитель");
    if (!isNum(inp.water.pH)) miss.push("pH");
    if (!isNum(inp.water.temperature)) miss.push("температура");
    if (!isNum(inp.contact.time) && !isNum(inp.contact.volume)) miss.push("контактное время");
    const o2Need = (dMe.max * (2 * ATOMIC.O)) / (4 * ATOMIC.Fe);
    const st = inp.feso4OxidationStatus ?? (miss.length ? "unchecked" : "required");
    fe = { o2Need, o2: inp.water.o2 ?? NaN, status: st, missing: miss };
    if (isNum(inp.water.o2) && o2Need > inp.water.o2) W.push(["warn", `Стехиометрическая потребность в O₂ при Dmax (${f(o2Need)} мг/л) больше растворённого O₂.`]);
    if (st !== "method" && st !== "test") W.push(["bad", "FeSO₄ (железо II): завершённость окисления Fe²⁺ не подтверждена. Стехиометрическая обеспеченность O₂ не является подтверждением. Безусловная рекомендация не выдаётся."]);
  }

  // Этап 6 — расходы и оборудование
  const c = inp.contact;
  const qd = Q[c.flowBasis];
  const Ve = c.calc === "timeToVolume" ? (isNum(c.time) && isNum(qd) ? (qd * c.time) / 3600 : NaN) : c.volume ?? NaN;
  const kOk = isNum(c.k) && c.k > 0 && c.k <= 1;
  if (isNum(c.k) && !kOk) W.push(["bad", "Коэффициент k должен быть в (0; 1]."]);
  if (kOk && !c.kBasis) W.push(["warn", "Для k не указано основание — применён как допущение пользователя."]);
  const Vg = kOk ? Ve / (c.k as number) : Ve;
  if (!isNum(Ve)) W.push(["bad", "Задайте контактное время или объём."]);
  if (!c.timeBasis) W.push(["warn", "Контактное время не обосновано. Объём рассчитан по заданному времени; технологическая достаточность не подтверждена."]);
  A.push("Камеры: 1 рабочая + 1 резервная, каждая на 100 % расчётного расхода; резервная не входит в контактный объём.");
  if (!kOk) A.push("Коэффициент использования объёма k не применяется: Vгеом = Vэфф.");
  const chambers = { flowBasis: c.flowBasis, q: qd, Veff: Ve, Vgeom: Vg, k: kOk ? c.k : null, times: (["min", "nom", "max"] as const).map((k) => ({ k, q: Q[k], t: (3600 * Ve) / Q[k] })) };

  const pq = Q[inp.pipe.flowBasis];
  const v = inp.pipe.velocity;
  const dCalc = isNum(pq) && isNum(v) && v > 0 ? Math.sqrt((4 * (pq / 3600)) / (Math.PI * v)) * 1000 : NaN;
  const din = inp.pipe.actualInnerDiameterMm;
  const vAt = (q: number) => (isNum(din) && din > 0 ? (4 * (q / 3600)) / (Math.PI * (din / 1000) ** 2) : NaN);
  if (!isNum(din)) W.push(["warn", "Стандартный типоразмер не выбран: показан расчётный внутренний диаметр; нужен каталог трубы."]);
  A.push("Потери давления в трубопроводе не рассчитываются.");
  const pipe = { flowBasis: inp.pipe.flowBasis, q: pq, dCalcMm: dCalc, actualMm: din ?? null, velocities: (["min", "nom", "max"] as const).map((k) => ({ k, q: Q[k], v: vAt(Q[k]) })) };

  const pr = (inp.pumps.pointPressureBar ?? NaN) + (inp.pumps.extraLossBar ?? 0);
  const mk = (qmin: number, qnom: number, qmax: number) => ({ qmin, qnom, qmax, top: isNum(inp.pumps.marginPct) ? qmax * (1 + inp.pumps.marginPct / 100) : NaN, turndown: qmax / qmin, pressureBar: pr });
  const pumps = [{ tag: "P-101A/B", name: `Насос-дозатор коагулянта (${P.label})`, ...mk((dMe.min * Q.min) / cWorkMe, (dMe.nom * Q.nom) / cWorkMe, (dMe.max * Q.max) / cWorkMe) }];
  if (phRes && isNum(phRes.dose100) && isNum(inp.ph.working100)) {
    const L = (q: number) => (phRes!.dose100 * q) / (inp.ph.working100 as number);
    pumps.push({ tag: "P-102A/B", name: `Насос-дозатор ${inp.ph.mode === "acid" ? "кислоты" : "щёлочи"} (${inp.ph.reagent ?? ""})`, ...mk(L(Q.min), L(Q.nom), L(Q.max)) });
  }
  if (!isNum(inp.pumps.marginPct)) W.push(["warn", "Проектный запас насосов не задан — верх рекомендуемого диапазона не определён."]);
  if (!isNum(inp.pumps.pointPressureBar)) W.push(["warn", "Давление в точке ввода не задано — требуемое давление насосов не определено."]);
  trace.push({ stage: "6", title: "Расходы и оборудование", rows: [
    { label: "Насос коагулянта qmin", formula: `Dmin × Qmin / C = ${f(dMe.min)} × ${f(Q.min, 1)} / ${f(cWorkMe)}`, result: `${f(pumps[0].qmin)} л/ч`, origin: "balance" },
    { label: "Насос коагулянта qmax", formula: `Dmax × Qmax / C = ${f(dMe.max)} × ${f(Q.max, 1)} / ${f(cWorkMe)}`, result: `${f(pumps[0].qmax)} л/ч`, origin: "balance" },
    { label: "Контактная камера Vэфф", formula: c.calc === "timeToVolume" ? `Q × t / 3600 = ${f(qd, 1)} × ${f(c.time ?? NaN)} / 3600` : "задан пользователем", result: `${f(Ve)} м³`, origin: c.timeBasis ? "balance" : "assumption" },
    { label: "Трубопровод dвн расч.", formula: `√(4·(${f(pq, 1)}/3600)/(π·${f(v ?? NaN)}))`, result: `${f(dCalc, 1)} мм`, origin: "balance" },
  ] });

  const hasBad = W.some((w) => w[0] === "bad");
  const status: Status = method && (method.status === "nodata" || method.status === "outside") ? "nodata" : !qOk || !passportOk || !doseOk ? "incomplete" : hasBad || W.some((w) => w[0] !== "info") ? "clarify" : method ? "prelim" : "user";

  return {
    engine: COAG_ENGINE_VERSION, status, flows: Q, flowOk: qOk, metal: P.metal, wProduct: wProd,
    doseMetal: dMe, doseInput: d, method, phNeed, conversion: conv, product: flows, alkalinity: alk, ph: phRes, feso4: fe,
    chambers, pipe, pumps, warnings: W, assumptions: A, trace,
    qualityNote: "Требования к качеству заданы. Достижение расчётом не подтверждено; требуется проверка.",
  };
}

export type CoagResult = ReturnType<typeof calculateCoagulation>;
