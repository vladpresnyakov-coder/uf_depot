"use client";
import { useCallback, useEffect, useState } from "react";
import { PROFILES, basisLabel, type Basis, type CoagulantType } from "@/core/coagulation/profiles";
import type { CoagResult } from "@/core/coagulation/calculate";
import { fmt, toNum, NumField, TextField, Select, Seg, StatusPill, Messages } from "@/components/ui";
import { t } from "@/i18n/ru";

type S = Record<string, string>;
const DEMO: Record<CoagulantType, S> = {
  PACl: { name: "ДЕМО-ПОХА-17", form: "liquid", c: "17", cb: "Al2O3", rho: "1,37", basicity: "70", bdef: "[OH]/(3·[Al]), мольн. %", hn: "", wc: "10", wcb: "Al2O3", dmin: "1,5", dnom: "2,5", dmax: "4" },
  FeCl3: { name: "ДЕМО-FeCl₃-40", form: "liquid", c: "40", cb: "salt", rho: "1,42", basicity: "", bdef: "", hn: "", wc: "20", wcb: "salt", dmin: "3", dnom: "5", dmax: "8" },
  "Fe2(SO4)3": { name: "", form: "liquid", c: "", cb: "salt", rho: "", basicity: "", bdef: "", hn: "", wc: "", wcb: "salt", dmin: "", dnom: "", dmax: "" },
  "Al2(SO4)3": { name: "", form: "solid", c: "", cb: "hydrate", rho: "", basicity: "", bdef: "", hn: "18", wc: "", wcb: "hydrate", dmin: "", dnom: "", dmax: "" },
  FeSO4: { name: "ДЕМО-FeSO₄·7H₂O", form: "solid", c: "98", cb: "hydrate", rho: "", basicity: "", bdef: "", hn: "7", wc: "100", wcb: "hydrate", dmin: "3", dnom: "5", dmax: "8" },
};

export default function CoagulationCalculator() {
  const [coag, setCoag] = useState<CoagulantType>("PACl");
  const [pp, setPp] = useState<S>(DEMO.PACl);
  const [doseBasis, setDoseBasis] = useState<Basis>("metal");
  const [flow, setFlow] = useState<S>({ mode: "uf", trains: "3", perTrain: "40", nom: "120", min: "", max: "", minO: "", maxO: "" });
  const [water, setWater] = useState<S>({ pH: "7,4", alk: "2,1", T: "8", o2: "" });
  const [ph, setPh] = useState<S>({ mode: "none", reagent: "NaOH", method: "manual", d100: "", target: "", w: "0,46", rho: "1,49", wc: "50" });
  const [contact, setContact] = useState<S>({ calc: "timeToVolume", time: "60", timeBasis: "", volume: "", flowBasis: "max", k: "", kBasis: "" });
  const [pipe, setPipe] = useState<S>({ flowBasis: "max", v: "1,5", din: "" });
  const [pumps, setPumps] = useState<S>({ p: "2,5", dp: "0,5", margin: "" });
  const [ox, setOx] = useState("auto");
  const [res, setRes] = useState<CoagResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const P = PROFILES[coag];
  const up = (set: (f: (s: S) => S) => void, k: string) => (v: string) => set((s) => ({ ...s, [k]: v }));
  const basisOpts: [Basis, string][] = P.bases.map((b) => [b, basisLabel(coag, b, b === "hydrate" ? toNum(pp.hn) : null)]);

  const run = useCallback(async () => {
    setBusy(true); setErr(null);
    const body = {
      coagulant: coag,
      passport: { name: pp.name, form: pp.form, hydrateN: toNum(pp.hn), concentration: toNum(pp.c), concentrationBasis: pp.cb || null, density: toNum(pp.rho), basicity: toNum(pp.basicity), basicityDefinition: pp.bdef, workingConcentration: toNum(pp.wc), workingBasis: pp.wcb || null },
      flow: flow.mode === "uf" ? { mode: "uf", trains: toNum(flow.trains), perTrain: toNum(flow.perTrain), minOverride: toNum(flow.minO), maxOverride: toNum(flow.maxO) } : { mode: "coag", nom: toNum(flow.nom), min: toNum(flow.min), max: toNum(flow.max) },
      dose: { min: toNum(pp.dmin), nom: toNum(pp.dnom), max: toNum(pp.dmax), basis: doseBasis, hydrateN: toNum(pp.hn) },
      water: { pH: toNum(water.pH), alkalinity: toNum(water.alk), temperature: toNum(water.T), o2: toNum(water.o2) },
      ph: { mode: ph.mode, reagent: ph.reagent, method: ph.method, dose100: toNum(ph.d100), target: toNum(ph.target), curve: [[0, 7.1], [5, 7.4], [10, 7.7], [15, 7.95]], massFraction: toNum(ph.w), density: toNum(ph.rho), working100: toNum(ph.wc) },
      contact: { calc: contact.calc, time: toNum(contact.time), timeBasis: contact.timeBasis, volume: toNum(contact.volume), flowBasis: contact.flowBasis, k: toNum(contact.k), kBasis: contact.kBasis },
      pipe: { flowBasis: pipe.flowBasis, velocity: toNum(pipe.v), actualInnerDiameterMm: toNum(pipe.din) },
      pumps: { pointPressureBar: toNum(pumps.p), extraLossBar: toNum(pumps.dp), marginPct: toNum(pumps.margin) },
      feso4OxidationStatus: ox === "auto" ? undefined : ox,
    };
    try {
      const r = await fetch("/api/coagulation/calculate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? "Ошибка расчёта"); setRes(null); } else setRes(j.result);
    } catch { setErr("Сервер расчёта недоступен."); }
    setBusy(false);
  }, [coag, pp, doseBasis, flow, water, ph, contact, pipe, pumps, ox]);

  useEffect(() => { run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- первый расчёт на демо-данных

  const pickCoag = (c: CoagulantType) => { setCoag(c); setPp(DEMO[c]); setDoseBasis("metal"); setRes(null); };

  return (
    <div className="page">
      <div className="eyebrow">Инструмент 1 · узел непосредственной коагуляции перед УФ</div>
      <h1>Коагуляция перед УФ</h1>
      <p className="lead">Последовательность: исходная вода → предфильтр и насос подачи → коррекция pH → коагулянт → смешение и контакт → УФ. Предфильтр и насос стоят до ввода реагентов. Значения по умолчанию — <b>{t.demo}</b>.</p>

      <div className="panel" style={{ marginBottom: 20 }}>
        <h2>Коагулянт</h2>
        <Seg name="coag" value={coag} options={(Object.keys(PROFILES) as CoagulantType[]).map((k) => [k, `${PROFILES[k].label.split(" ").slice(-1)[0]} · ${PROFILES[k].oxidation}`])} onChange={pickCoag} />
        <p className="footnote">Степень окисления железа указана всегда: Fe₂(SO₄)₃ — железо(III), FeSO₄ — железо(II). Для Fe₂(SO₄)₃ и Al₂(SO₄)₃ демо-паспорт не заполнен.</p>
      </div>

      <div className="grid2">
        <div className="stack">
          <div className="panel">
            <h2>Расход исходной воды</h2>
            <Seg name="flowmode" value={flow.mode} options={[["coag", "Только коагуляция"], ["uf", "С установками УФ"]]} onChange={up(setFlow, "mode")} />
            {flow.mode === "coag" ? (
              <div className="fields" style={{ marginTop: 12 }}>
                <NumField id="qn" label="Qном" unit="м³/ч" value={flow.nom} onChange={up(setFlow, "nom")} required hint="задаётся пользователем" />
                <NumField id="qmin" label="Qmin" unit="м³/ч" value={flow.min} onChange={up(setFlow, "min")} placeholder="= Qном" hint="необязательно" />
                <NumField id="qmax" label="Qmax" unit="м³/ч" value={flow.max} onChange={up(setFlow, "max")} placeholder="= Qном" hint="необязательно" />
              </div>
            ) : (
              <div className="fields" style={{ marginTop: 12 }}>
                <NumField id="tr" label="Рабочих установок УФ" unit="шт." value={flow.trains} onChange={up(setFlow, "trains")} required />
                <NumField id="pt" label="Подача исходной воды на одну установку" unit="м³/ч" value={flow.perTrain} onChange={up(setFlow, "perTrain")} required hint="из расчёта УФ (ДЕМО)" />
                <NumField id="qmo" label="Qmin вручную" unit="м³/ч" value={flow.minO} onChange={up(setFlow, "minO")} placeholder="1 установка" />
                <NumField id="qxo" label="Qmax вручную" unit="м³/ч" value={flow.maxO} onChange={up(setFlow, "maxO")} placeholder="= Qном" />
              </div>
            )}
          </div>

          <div className="panel">
            <h2>Паспорт продукта</h2>
            <div className="fields">
              <TextField id="pn" label="Название" value={pp.name} onChange={up(setPp, "name")} />
              <Select id="pf" label="Форма" value={pp.form as "liquid" | "solid"} options={[["liquid", "жидкий"], ["solid", "твёрдый"]]} onChange={up(setPp, "form")} />
              <NumField id="pc" label="Концентрация" unit="% масс." value={pp.c} onChange={up(setPp, "c")} required />
              <Select id="pcb" label="База концентрации" value={pp.cb as Basis} options={basisOpts.filter(([b]) => b !== "product")} onChange={up(setPp, "cb")} />
              {P.salt && <NumField id="phn" label="n в кристаллогидрате ·nH₂O" value={pp.hn} onChange={up(setPp, "hn")} />}
              {pp.form === "liquid" && <NumField id="prho" label="Плотность товарного раствора" unit="кг/л" value={pp.rho} onChange={up(setPp, "rho")} required />}
              {P.usesBasicity && <NumField id="pbas" label="Основность" unit="%" value={pp.basicity} onChange={up(setPp, "basicity")} />}
              {P.usesBasicity && <TextField id="pbdef" label="Определение основности" value={pp.bdef} onChange={up(setPp, "bdef")} />}
              <NumField id="pwc" label="Рабочий раствор" unit="г/л" value={pp.wc} onChange={up(setPp, "wc")} />
              <Select id="pwcb" label="База рабочего раствора" value={pp.wcb as Basis} options={basisOpts} onChange={up(setPp, "wcb")} />
            </div>
          </div>

          <div className="panel">
            <h2>Доза — заданная пользователем</h2>
            <div className="fields">
              <Select id="db" label="База дозы" value={doseBasis} options={basisOpts} onChange={setDoseBasis} />
              <NumField id="dmin" label="Dmin" unit="мг/л" value={pp.dmin} onChange={up(setPp, "dmin")} required />
              <NumField id="dnom" label="Dном (расчётная)" unit="мг/л" value={pp.dnom} onChange={up(setPp, "dnom")} required />
              <NumField id="dmax" label="Dmax" unit="мг/л" value={pp.dmax} onChange={up(setPp, "dmax")} required />
            </div>
            <div className="msg info small">Предварительная оценка дозы: <b>недостаточно данных</b> — согласованная методика для {P.label} не зарегистрирована. Работает заданная доза.</div>
          </div>

          <div className="panel">
            <h2>Вода и коррекция pH</h2>
            <div className="fields">
              <NumField id="wph" label="pH" value={water.pH} onChange={up(setWater, "pH")} />
              <NumField id="walk" label="Общая щёлочность" unit="мг-экв/л" value={water.alk} onChange={up(setWater, "alk")} />
              <NumField id="wt" label="Температура" unit="°C" value={water.T} onChange={up(setWater, "T")} />
              {coag === "FeSO4" && <NumField id="wo2" label="Растворённый O₂" unit="мг/л" value={water.o2} onChange={up(setWater, "o2")} />}
            </div>
            <div style={{ marginTop: 14 }}><Seg name="phm" value={ph.mode as "none"} options={[["none", "Без коррекции"], ["acid", "Кислота"], ["base", "Щёлочь"], ["unknown", "Недостаточно данных"]]} onChange={up(setPh, "mode")} /></div>
            {(ph.mode === "acid" || ph.mode === "base") && (
              <div className="fields" style={{ marginTop: 12 }}>
                <Select id="phr" label="Реагент" value={ph.reagent as "NaOH"} options={ph.mode === "acid" ? [["HCl", "HCl"], ["H2SO4", "H₂SO₄"]] : [["NaOH", "NaOH"]]} onChange={up(setPh, "reagent")} />
                <Select id="phmeth" label="Способ дозы" value={ph.method as "manual"} options={[["manual", "заданная доза 100 %"], ["curve", "титрационная кривая (ДЕМО)"]]} onChange={up(setPh, "method")} />
                {ph.method === "manual" ? <NumField id="phd" label="Доза 100 % вещества" unit="мг/л" value={ph.d100} onChange={up(setPh, "d100")} required /> : <NumField id="pht" label="Целевой pH" value={ph.target} onChange={up(setPh, "target")} hint="кривая ДЕМО: pH 7,1–7,95" />}
                <NumField id="phw" label="Массовая доля в товарном" unit="доля" value={ph.w} onChange={up(setPh, "w")} />
                <NumField id="phrho" label="Плотность товарного" unit="кг/л" value={ph.rho} onChange={up(setPh, "rho")} />
                <NumField id="phwc" label="Рабочий раствор по 100 %" unit="г/л" value={ph.wc} onChange={up(setPh, "wc")} />
              </div>
            )}
            {coag === "FeSO4" && (
              <div className="fields" style={{ marginTop: 12 }}>
                <Select id="ox" label="Статус проверки окисления Fe²⁺" value={ox} options={[["auto", "по наличию данных"], ["required", "требуется проверка"], ["test", "подтверждено испытанием"]]} onChange={setOx} hint="«подтверждено методикой» недоступно: методика не зарегистрирована" />
              </div>
            )}
          </div>

          <div className="panel">
            <h2>Камеры, труба, насосы</h2>
            <Seg name="cc" value={contact.calc as "timeToVolume"} options={[["timeToVolume", "время → объём"], ["volumeToTime", "объём → время"]]} onChange={up(setContact, "calc")} />
            <div className="fields" style={{ marginTop: 12 }}>
              <Select id="cfb" label="Расход подбора камер" value={contact.flowBasis as "max"} options={[["max", "Qmax"], ["nom", "Qном"], ["min", "Qmin"]]} onChange={up(setContact, "flowBasis")} />
              {contact.calc === "timeToVolume" ? <NumField id="ct" label="Контактное время" unit="с" value={contact.time} onChange={up(setContact, "time")} required hint="ДЕМО; без значения по умолчанию" /> : <NumField id="cv" label="Эффективный объём камеры" unit="м³" value={contact.volume} onChange={up(setContact, "volume")} required />}
              <TextField id="ctb" label="Основание контактного времени" value={contact.timeBasis} onChange={up(setContact, "timeBasis")} />
              <NumField id="ck" label="k использования объёма" value={contact.k} onChange={up(setContact, "k")} placeholder="не применяется" />
              <Select id="pfb" label="Расход для трубы" value={pipe.flowBasis as "max"} options={[["max", "Qmax"], ["nom", "Qном"], ["min", "Qmin"]]} onChange={up(setPipe, "flowBasis")} />
              <NumField id="pv" label="Расчётная скорость" unit="м/с" value={pipe.v} onChange={up(setPipe, "v")} required hint="ДЕМО" />
              <NumField id="pdin" label="Факт. dвн выбранного типоразмера" unit="мм" value={pipe.din} onChange={up(setPipe, "din")} />
              <NumField id="pup" label="Давление в точке ввода" unit="бар изб." value={pumps.p} onChange={up(setPumps, "p")} />
              <NumField id="pudp" label="Доп. потери" unit="бар" value={pumps.dp} onChange={up(setPumps, "dp")} />
              <NumField id="pum" label="Проектный запас подачи" unit="%" value={pumps.margin} onChange={up(setPumps, "margin")} placeholder="не задан" />
            </div>
          </div>
          <div className="btns"><button className="btn" type="button" onClick={run} disabled={busy}>{busy ? "Расчёт…" : "Рассчитать"}</button></div>
        </div>

        <div className="stack">{err ? <div className="msg bad">{err}</div> : res ? <Results r={res} coag={coag} /> : <div className="panel muted">Расчёт…</div>}</div>
      </div>
    </div>
  );
}

function Results({ r, coag }: { r: CoagResult; coag: CoagulantType }) {
  const P = PROFILES[coag];
  const QL: Record<string, string> = { min: "Qmin", nom: "Qном", max: "Qmax" };
  return (
    <>
      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>Результаты</h2><StatusPill status={r.status} />
        </div>
        <p className="footnote">Ядро {r.engine}. Доза — {t.status.user.toLowerCase()}; пересчёты — материальный баланс.</p>
        <div className="tw"><table><thead><tr><th></th>{r.product.map((f) => <th key={f.k} className="n">{QL[f.k]}</th>)}</tr></thead><tbody>
          <tr><td>Q, м³/ч</td>{r.product.map((f) => <td key={f.k} className="n">{fmt(f.q, 1)}</td>)}</tr>
          <tr><td>Доза Dном <span className="basis">мг/л {P.metal}</span></td>{r.product.map((f) => <td key={f.k} className="n">{fmt(r.doseMetal.nom)}</td>)}</tr>
          <tr><td>Доза товарного продукта, мг/л</td>{r.product.map((f) => <td key={f.k} className="n">{fmt(f.Dp)}</td>)}</tr>
          <tr><td>{P.metal} (100 %), кг/ч</td>{r.product.map((f) => <td key={f.k} className="n">{fmt(f.Mme)}</td>)}</tr>
          <tr><td>Товарный продукт, кг/ч</td>{r.product.map((f) => <td key={f.k} className="n">{fmt(f.Mp)}</td>)}</tr>
          <tr><td>Товарный продукт, л/ч</td>{r.product.map((f) => <td key={f.k} className="n">{fmt(f.Lp)}</td>)}</tr>
          <tr><td>Рабочий раствор, л/ч</td>{r.product.map((f) => <td key={f.k} className="n">{fmt(f.Lw)}</td>)}</tr>
        </tbody></table></div>
      </div>

      <div className="panel">
        <h3>Пересчёт дозы по базам</h3>
        <div className="tw"><table><thead><tr><th>База</th><th className="n">Dmin</th><th className="n">Dном</th><th className="n">Dmax</th></tr></thead><tbody>
          {r.conversion.map((c) => <tr key={c.basis}><td><span className="basis">мг/л {c.basis}</span></td><td className="n">{fmt(c.min)}</td><td className="n">{fmt(c.nom)}</td><td className="n">{fmt(c.max)}</td></tr>)}
        </tbody></table></div>
        <h3 style={{ marginTop: 14 }}>Теоретический расход щёлочности</h3>
        <dl className="kv"><dt>При Dном / Dmax</dt><dd>{fmt(r.alkalinity.atNom)} / {fmt(r.alkalinity.atMax)} мг-экв/л</dd><dt>Щёлочность воды</dt><dd>{fmt(r.alkalinity.water)} мг-экв/л</dd></dl>
        <p className="footnote">Стехиометрический баланс, не прогноз pH и не расчёт дозы кислоты/щёлочи.</p>
      </div>

      <div className="panel">
        <h3>Оборудование</h3>
        <dl className="kv">
          <dt>CT-101/102: Vэфф одной камеры ({QL[r.chambers.flowBasis]})</dt><dd>{fmt(r.chambers.Veff)} м³</dd>
          <dt>Vгеом одной / двух камер</dt><dd>{fmt(r.chambers.Vgeom)} / {fmt(2 * r.chambers.Vgeom)} м³</dd>
          <dt>Время при Qmin / Qном / Qmax</dt><dd>{r.chambers.times.map((x) => fmt(x.t, 0)).join(" / ")} с</dd>
          <dt>L-101: dвн расчётный ({QL[r.pipe.flowBasis]})</dt><dd>{fmt(r.pipe.dCalcMm, 1)} мм</dd>
          <dt>Скорость при Qmin / Qном / Qmax</dt><dd>{r.pipe.actualMm ? r.pipe.velocities.map((x) => fmt(x.v, 2)).join(" / ") + " м/с" : "нужен факт. dвн"}</dd>
        </dl>
        <div className="tw" style={{ marginTop: 10 }}><table><thead><tr><th>Позиция</th><th className="n">qmin, л/ч</th><th className="n">qном</th><th className="n">qmax</th><th className="n">Кратн.</th><th className="n">P, бар</th></tr></thead><tbody>
          {r.pumps.map((p) => <tr key={p.tag}><td><span className="tag">{p.tag}</span><div className="small muted">{p.name}</div></td><td className="n">{fmt(p.qmin)}</td><td className="n">{fmt(p.qnom)}</td><td className="n">{fmt(p.qmax)}</td><td className="n">{Number.isFinite(p.turndown) ? `1:${fmt(p.turndown, 1)}` : "—"}</td><td className="n">≥ {fmt(p.pressureBar, 1)}</td></tr>)}
        </tbody></table></div>
        <p className="footnote">Требуемые характеристики, а не выбор насоса. qmin = q(Dmin, Qmin), qmax = q(Dmax, Qmax).</p>
      </div>

      {r.feso4 && <div className="panel"><h3>FeSO₄: окисление Fe²⁺</h3><dl className="kv"><dt>Стехиометрическая потребность O₂ при Dmax</dt><dd>{fmt(r.feso4.o2Need)} мг/л</dd><dt>Растворённый O₂</dt><dd>{fmt(r.feso4.o2)} мг/л</dd><dt>Статус проверки</dt><dd>{{ unchecked: "не проверено", required: "требуется проверка", method: "подтверждено методикой", test: "подтверждено испытанием" }[r.feso4.status]}</dd></dl>{r.feso4.missing.length > 0 && <div className="msg warn small">Не хватает: {r.feso4.missing.join(", ")}.</div>}</div>}

      <div className="panel"><h3>Предупреждения</h3><Messages items={r.warnings} /></div>
      <div className="panel"><h3>Допущения</h3><ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{r.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul><div className="msg warn small">{r.qualityNote}</div></div>

      <div className="panel"><h3>Протокол расчёта</h3>
        {r.trace.map((s) => <section key={s.stage} className="tstage"><header><b>{s.stage === "IN" ? "ВХОД" : `ЭТАП ${s.stage}`}</b><span>{s.title}</span></header>
          {s.rows.map((x, i) => <div key={i} className="trow"><div>{x.label}</div><div className="sub">{x.formula}</div><div className="res">{x.result}</div></div>)}</section>)}
      </div>
    </>
  );
}
