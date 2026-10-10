"use client";
import { Fragment, useEffect, useState } from "react";
import { fmt, toNum, NumField, Select, Seg, StatusPill } from "@/components/ui";
import { t } from "@/i18n/ru";

type Resp = {
  engine: string; mode: "A" | "C"; ms: number;
  layout: { N: number; X: number; modules: number; moduleArea: number; A_unit: number; A_work: number; A_installed: number; groups: number[][] };
  J: { initial: number; final: number };
  prelim: { feasible: boolean; area: number; specificNetM3hPerM2: number; cycleSeconds: number; linear: boolean } | null;
  solver: { status: string; statusYear?: string; residualYear?: number; bounds: number[]; iterations: number; deficit: number | null; searchDays: number } | null;
  result: null | {
    Q1unit: number; Q1N: number; Q2: number; Q2filt: number; Qnet: number; Vnet: number; days: number; dayNetMin: number; dayNetMax: number; daily: number[];
    feedMin: number; feedMax: number; bwMax: number[];
    totals: { raw: number; uf: number; ff: number; bw: number; src: { UF: number; RO1: number; RO2: number }; cycles: number; ceb: Record<string, number>; waitH: number; extH: number; stops: number };
    drains: { key: string; label: string; m3: number }[]; ownNeeds: { UF: number; RO1eq: number; RO2eq: number };
    ro: { UF: number; C1: number; R2: number; check: number }; chemicalsKg: Record<string, number>; dosingMaxKgH: Record<string, Record<string, number>>;
    detail: { tr: number; t0: number; t1: number; kind: string }[];
  };
  error?: string;
};

const CEB_OPTS: [string, string][] = [["CEB1.1A", "CEB 1.1(A) щелочная"], ["CEB1.1B", "CEB 1.1(B) щелочно-окислит."], ["CEB1", "CEB 1 щелочная + кислотная"], ["CEB2", "CEB 2 кислотная"], ["CEB3", "CEB 3 окислительная"]];
const SRC_OPTS: [string, string][] = [["UF", "ультрафильтрат"], ["RO1", "пермеат ОО-1"], ["RO2", "пермеат ОО-2"]];
const COL: Record<string, string> = { F: "#3d8fc4", ext: "#1f5f8a", FR: "#7fb6dc", FS: "#7fb6dc", RS: "#9aa7b0", FX: "#9aa7b0", FF: "#5b7f99", FFS: "#9aa7b0", BW: "#7356b5", CEB: "#c2417a", SOAK: "#e6a7c2", RINSE: "#a98bd6", W: "#c9d1d6" };

export default function UfCalculator() {
  const [mode, setMode] = useState<"A" | "C">("C");
  const [v, setV] = useState<Record<string, string>>({ target: "250", J: "60", a: "60", m: "24", N: "4", X: "1", groups: "1", maxExt: "300", tFilt: "1800", eta1: "0,75", eta2: "0,90" });
  const [sc, setSc] = useState<{ n: string; ceb: string }[]>([{ n: "15", ceb: "CEB1.1A" }, { n: "10", ceb: "CEB3" }]);
  const [src, setSrc] = useState<Record<string, string>>({ "CEB1.1A": "UF", "CEB1.1B": "UF", CEB1: "UF", CEB2: "UF", CEB3: "UF" });
  const [res, setRes] = useState<Resp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const up = (k: string) => (x: string) => setV((s) => ({ ...s, [k]: x }));

  async function run() {
    setBusy(true); setErr(null);
    const body = {
      mode, target: toNum(v.target), J: toNum(v.J), moduleArea: toNum(v.a), modules: toNum(v.m), N: toNum(v.N), X: toNum(v.X), groups: toNum(v.groups),
      maxExt: toNum(v.maxExt), tFilt: toNum(v.tFilt), eta1: toNum(v.eta1), eta2: toNum(v.eta2), days: 365,
      supercycle: sc.map((r) => ({ n: toNum(r.n), ceb: r.ceb })), cebSources: src,
    };
    try {
      const r = await fetch("/api/uf/calculate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = (await r.json()) as Resp;
      if (!r.ok) { setErr(j.error ?? "Ошибка расчёта"); setRes(null); } else setRes(j);
    } catch { setErr("Сервер расчёта недоступен."); }
    setBusy(false);
  }
  useEffect(() => { run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const usedCeb = [...new Set(sc.map((r) => r.ceb))];
  return (
    <div className="page">
      <div className="eyebrow">Инструмент 2 · UF Calc · событийное ядро, годовое моделирование</div>
      <h1>Расчёт УФ-системы N+X</h1>
      <p className="lead">Обычный цикл: фильтрация → FF исходной водой 30 с → BW ультрафильтратом. CEB — по общему повторяющемуся циклу. Шаблоны времени BW — из ТЗ; времена и дозы CEB — <b>{t.demo}</b> до получения руководства изготовителя. CIP и ремонты не учитываются.</p>
      <div className="grid2">
        <div className="stack">
          <div className="panel">
            <h2>Режим расчёта</h2>
            <Seg name="mode" value={mode} options={[["C", "Найти J по требуемому Qnet"], ["A", "Найти Qnet при заданном J"]]} onChange={setMode} />
            <div className="fields" style={{ marginTop: 12 }}>
              {mode === "C" && <NumField id="tg" label="Требуемый Qnet" unit="м³/ч" value={v.target} onChange={up("target")} required />}
              <NumField id="j" label={mode === "C" ? "Исходный J" : "J"} unit="л/(м²·ч)" value={v.J} onChange={up("J")} required hint="ручной ввод: рекомендатель без источника отсутствует" />
            </div>
          </div>
          <div className="panel">
            <h2>Компоновка</h2>
            <div className="fields">
              <NumField id="a" label="Площадь модуля a" unit="м²" value={v.a} onChange={up("a")} required hint="каталог не получен; пределы «не проверено»" />
              <NumField id="m" label="Модулей в установке m" unit="шт." value={v.m} onChange={up("m")} required />
              <NumField id="n" label="Рабочих установок N" unit="шт." value={v.N} onChange={up("N")} required />
              <NumField id="x" label="Резервных установок X" unit="шт." value={v.X} onChange={up("X")} required hint="не участвует в выработке и промывках" />
              <NumField id="g" label="Групп BW-станций" unit="шт." value={v.groups} onChange={up("groups")} required />
              <NumField id="ext" label="Максимум продления фильтрации" unit="с" value={v.maxExt} onChange={up("maxExt")} hint="0 — без продления" />
              <NumField id="tf" label="Длительность фильтрации" unit="с" value={v.tFilt} onChange={up("tFilt")} hint="ДЕМО" />
            </div>
          </div>
          <div className="panel">
            <h2>Общий цикл CEB</h2>
            <div className="tw"><table><thead><tr><th>#</th><th className="n">Обычных циклов</th><th>Затем программа</th><th>Источник воды</th><th></th></tr></thead><tbody>
              {sc.map((r, i) => (
                <tr key={i}>
                  <td className="mono">{i + 1}</td>
                  <td className="n"><input aria-label={`циклов ${i + 1}`} className="num" style={{ width: 70, textAlign: "right" }} value={r.n} onChange={(e) => setSc((s) => s.map((x, j) => (j === i ? { ...x, n: e.target.value } : x)))} /></td>
                  <td><select aria-label={`программа ${i + 1}`} value={r.ceb} onChange={(e) => setSc((s) => s.map((x, j) => (j === i ? { ...x, ceb: e.target.value } : x)))}>{CEB_OPTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                  <td><select aria-label={`источник ${i + 1}`} value={src[r.ceb]} onChange={(e) => setSrc((s) => ({ ...s, [r.ceb]: e.target.value }))}>{SRC_OPTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                  <td><button type="button" className="btn ghost" style={{ padding: "2px 8px" }} disabled={sc.length < 2} onClick={() => setSc((s) => s.filter((_, j) => j !== i))}>×</button></td>
                </tr>
              ))}
            </tbody></table></div>
            <div className="btns"><button type="button" className="btn ghost" onClick={() => setSc((s) => [...s, { n: "10", ceb: "CEB2" }])}>+ строка</button></div>
            <p className="footnote">Повтор: {sc.map((r) => `${r.n} × C → ${r.ceb}`).join(" → ")} → с начала. Источник CEB действует на подачу и все отмывки программы; обычная BW — на ультрафильтрате. Используются: {usedCeb.join(", ")}.</p>
          </div>
          <div className="panel">
            <h2>Баланс ОО</h2>
            <div className="fields">
              <NumField id="e1" label="η1 — выход ОО-1" unit="доля" value={v.eta1} onChange={up("eta1")} hint="0,75 по ТЗ" />
              <NumField id="e2" label="η2 — выход ОО-2" unit="доля" value={v.eta2} onChange={up("eta2")} hint="0,90 по ТЗ; концентрат ОО-2 возвращается на ОО-1" />
            </div>
          </div>
          <div className="btns"><button className="btn" type="button" onClick={run} disabled={busy}>{busy ? "Годовое моделирование…" : "Рассчитать"}</button></div>
        </div>
        <div className="stack">{err ? <div className="msg bad">{err}</div> : res ? <UfResults r={res} /> : <div className="panel muted">Годовое моделирование…</div>}</div>
      </div>
    </div>
  );
}

function UfResults({ r }: { r: Resp }) {
  if (!r.result) return (
    <div className="panel"><h2>Решение не найдено</h2><div className="msg bad">При J в пределах {r.solver?.bounds.join("–")} л/(м²·ч) требуемый Qnet недостижим{r.solver?.deficit ? `; дефицит при верхней границе ${fmt(r.solver.deficit, 2)} м³/ч` : ""}. Увеличьте N или m или измените режимы.</div></div>
  );
  const s = r.result, L = r.layout;
  const dJ = r.J.final - r.J.initial;
  const chem = Object.entries(s.chemicalsKg);
  return (
    <>
      <div className="statusrow"><StatusPill status="balance" label="Гидравлический расчёт выполнен" /><StatusPill status="clarify" label="Рекомендация J отсутствует" /><StatusPill status="clarify" label="Напор станций не рассчитан" /><StatusPill status="prelim" label="Времена CEB — демо" /></div>
      <div className="cards">
        <div className="kcard"><div className="k">Q1 · ИСХОДНАЯ ВОДА ПРИ ФИЛЬТРАЦИИ</div><div className="v">{fmt(s.Q1N, 1)}</div><div className="u">м³/ч на {L.N} уст.</div><div className="d">{fmt(s.Q1unit, 1)} м³/ч на одну установку</div></div>
        <div className="kcard"><div className="k">Q2 · СРЕДНИЙ ЗАБОР</div><div className="v">{fmt(s.Q2, 1)}</div><div className="u">м³/ч за год</div><div className="d">только фильтрация {fmt(s.Q2filt, 1)} м³/ч</div></div>
        <div className="kcard" style={{ borderColor: "var(--accent)" }}><div className="k">QNET · ПОЛЕЗНАЯ УФ</div><div className="v">{fmt(s.Qnet, 1)}</div><div className="u">м³/ч среднегодовая</div><div className="d">{fmt(s.Vnet / s.days, 0)} м³/сут; сутки {fmt(s.dayNetMin, 0)}–{fmt(s.dayNetMax, 0)}</div></div>
      </div>

      <div className="panel">
        <h2>Компоновка и J</h2>
        <dl className="kv">
          <dt>Установки</dt><dd>{L.N} раб. + {L.X} рез. · {L.modules} × {fmt(L.moduleArea)} м²</dd>
          <dt>A_work / A_installed</dt><dd>{fmt(L.A_work, 0)} / {fmt(L.A_installed, 0)} м²</dd>
          <dt>Группы BW</dt><dd>{L.groups.map((g, i) => `гр.${i + 1}: ${g.map((x) => x + 1).join(",")}`).join(" · ")}</dd>
          <dt>J исходный</dt><dd>{fmt(r.J.initial, 2)} л/(м²·ч)</dd>
          {r.mode === "C" && <><dt>J необходимый</dt><dd>{fmt(r.J.final, 2)} л/(м²·ч) ({dJ >= 0 ? "+" : ""}{fmt(dJ, 2)}; {dJ >= 0 ? "+" : ""}{fmt((dJ / r.J.initial) * 100, 1)} %)</dd>
            <dt>Невязка Qnet (год)</dt><dd>{fmt(r.solver?.residualYear, 4)} м³/ч · допуск ±0,02</dd>
            <dt>Поиск</dt><dd>{r.solver?.iterations} итер. на {r.solver?.searchDays} сут, уточнение на году</dd></>}
          {r.prelim && <><dt>Предварительная площадь (без очередей)</dt><dd>{r.prelim.feasible ? `${fmt(r.prelim.area, 0)} м²` : "не определена"}</dd></>}
        </dl>
        <p className="footnote">Найденный J — математическое решение, не инженерно проверенный режим: рекомендация J и паспортные пределы модуля не определены.</p>
      </div>

      <div className="panel"><h2>Суточная нетто-выработка за год</h2><DayChart d={s.daily} /><p className="footnote">Год не равен первым суткам × 365. Прогон 7 сут не входит в год. CIP, ремонты и переходы на резерв исключены.</p></div>

      <div className="panel"><h2>Временная диаграмма, первые 6 ч</h2><Gantt d={s.detail} n={L.N} /><p className="footnote">Фильтрация, продление, FF, BW, CEB (подача, выдержка, отмывка), ожидание станции.</p></div>

      <div className="grid2">
        <div className="panel"><h3>Собственные нужды за год</h3><dl className="kv">
          <dt>Произведено УФ</dt><dd>{fmt(s.totals.uf, 0)} м³</dd><dt>BW ультрафильтратом</dt><dd>{fmt(s.totals.bw, 0)} м³</dd>
          <dt>CEB (в эквиваленте УФ)</dt><dd>{fmt(s.ownNeeds.UF - s.totals.bw + s.ownNeeds.RO1eq + s.ownNeeds.RO2eq, 0)} м³</dd><dt>FF исходной водой</dt><dd>{fmt(s.totals.ff, 0)} м³</dd>
          <dt>Ожидание / продление</dt><dd>{fmt(s.totals.waitH, 0)} / {fmt(s.totals.extH, 0)} ч</dd><dt>Обычных циклов</dt><dd>{fmt(s.totals.cycles, 0)}</dd>
          {Object.entries(s.totals.ceb).map(([k, n]) => <Fragment key={k}><dt>{k}</dt><dd>{n} шт.</dd></Fragment>)}
        </dl></div>
        <div className="panel"><h3>Станции</h3><dl className="kv">
          <dt>Исходная вода: мин–макс по расписанию</dt><dd>{fmt(s.feedMin, 1)}–{fmt(s.feedMax, 1)} м³/ч</dd>
          {s.bwMax.map((q, i) => <Fragment key={i}><dt>BW-станция гр. {i + 1}: максимум</dt><dd>{fmt(q, 1)} м³/ч</dd></Fragment>)}
          <dt>Свежий УФ на ОО / сброс ОО-1</dt><dd>{fmt(s.ro.UF, 0)} / {fmt(s.ro.C1, 0)} м³</dd>
        </dl><p className="footnote">Напор: граничные давления, отметки и потери не заданы — H не определён. Насос-дозатор коагулянта подбирается на диапазон станции исходной воды.</p></div>
      </div>

      <div className="grid2">
        <div className="panel"><h3>Реагенты CEB за год (ДЕМО-дозы)</h3>{chem.length ? <div className="tw"><table><thead><tr><th>Реагент</th><th className="n">Действ., кг</th><th className="n">кг/сут</th><th className="n">кг/м³ Qnet</th><th className="n">Макс. подача, кг/ч</th></tr></thead><tbody>
          {chem.map(([k, kg]) => <tr key={k}><td className="mono">{k}</td><td className="n">{fmt(kg, 0)}</td><td className="n">{fmt(kg / s.days, 2)}</td><td className="n">{s.Vnet > 0 ? fmt(kg / s.Vnet, 5) : "не опр."}</td><td className="n">{fmt(Math.max(...Object.values(s.dosingMaxKgH).map((g) => g[k] ?? 0)), 2)}</td></tr>)}
        </tbody></table></div> : <p className="muted small">Нет дозирования.</p>}<p className="footnote">Товарный расход — после ввода паспортов продуктов. Дозирование на выдержке и отмывках не начисляется.</p></div>
        <div className="panel"><h3>Стоки за год</h3><dl className="kv">{s.drains.map((d) => <Fragment key={d.key}><dt>{d.label}</dt><dd>{fmt(d.m3, 0)} м³</dd></Fragment>)}</dl><p className="footnote">Кислотные и хлорсодержащие стоки — раздельные маршруты. Метабисульфит: только ручная доза (следующий шаг).</p></div>
      </div>
      <p className="footnote">Ядро {r.engine} · расчёт {fmt(r.ms / 1000, 1)} с.</p>
    </>
  );
}

function DayChart({ d }: { d: number[] }) {
  if (!d.length) return null;
  const W = 900, H = 180, L = 56, B = 22;
  const mn = Math.min(...d), mx = Math.max(...d), pad = (mx - mn) * 0.15 || 1, lo = mn - pad, hi = mx + pad;
  const X = (i: number) => L + (i / Math.max(1, d.length - 1)) * (W - L - 10), Y = (v: number) => 10 + ((hi - v) / (hi - lo)) * (H - B - 10);
  const path = d.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join("");
  const ticks = [mn, (mn + mx) / 2, mx];
  return <div className="chartbox"><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Суточная нетто-выработка">
    {ticks.map((tv, i) => <g key={i}><line x1={L} x2={W - 10} y1={Y(tv)} y2={Y(tv)} stroke="var(--line)" /><text x={L - 6} y={Y(tv) + 4} fontSize="10.5" textAnchor="end" fill="var(--ink2)" fontFamily="IBM Plex Mono,monospace">{fmt(tv, 0)}</text></g>)}
    <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
    <text x={L} y={H - 5} fontSize="10.5" fill="var(--ink2)">сутки 1</text><text x={W - 10} y={H - 5} fontSize="10.5" textAnchor="end" fill="var(--ink2)">сутки {d.length}</text>
    <text x={L + 4} y={20} fontSize="10.5" fill="var(--ink2)">м³/сут нетто</text>
  </svg></div>;
}

function Gantt({ d, n }: { d: { tr: number; t0: number; t1: number; kind: string }[]; n: number }) {
  const w0 = 0, w1 = 6 * 3600, W = 900, L = 56, rowH = 20, top = 22, H = top + n * rowH + 8;
  const X = (t: number) => L + ((t - w0) / (w1 - w0)) * (W - L - 10);
  return <div className="chartbox"><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Состояния установок во времени">
    {[0, 1, 2, 3, 4, 5, 6].map((h) => <g key={h}><line x1={X(h * 3600)} x2={X(h * 3600)} y1={top - 4} y2={H - 4} stroke="var(--line)" /><text x={X(h * 3600)} y={top - 8} fontSize="10.5" textAnchor="middle" fill="var(--ink2)" fontFamily="IBM Plex Mono,monospace">{String(h).padStart(2, "0")}:00</text></g>)}
    {Array.from({ length: n }, (_, i) => <text key={i} x={6} y={top + i * rowH + 14} fontSize="11" fill="var(--ink)" fontFamily="IBM Plex Mono,monospace">УФ-{i + 1}</text>)}
    {d.filter((x) => x.t1 > w0 && x.t0 < w1).map((x, i) => { const a = Math.max(x.t0, w0), b = Math.min(x.t1, w1); return <rect key={i} x={X(a)} y={top + x.tr * rowH + 3} width={Math.max(0.6, X(b) - X(a))} height={rowH - 6} fill={COL[x.kind] ?? "#999"} />; })}
  </svg></div>;
}
