"use client";
import { useState } from "react";
import { JAR_PARAMS, NORMS_GOST_MODEL, NORMS_SANPIN, SEASONS, optimalDose, workingSolutionMass, type JarKey, type JarTest, type NormSet, type Season } from "@/core/coagulation/jar";
import type { CoagulantType } from "@/core/coagulation/profiles";
import { fmt, toNum } from "@/components/ui";
import { newId, type Catalog } from "@/lib/catalog";

const KEYS = Object.keys(JAR_PARAMS) as JarKey[];
const s2 = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? "" : String(x).replace(".", ","));
const seasonLabel = (s: Season) => SEASONS.find((x) => x[0] === s)?.[1] ?? s;

type Draft = { id: string; date: string; season: Season; temperature: string; productName: string; note: string; rows: { dose: string; v: Record<JarKey, string> }[] };
const emptyRow = (dose: number | string) => ({ dose: String(dose), v: Object.fromEntries(KEYS.map((k) => [k, ""])) as Record<JarKey, string> });
const toDraft = (t: JarTest): Draft => ({ id: t.id, date: t.date, season: t.season, temperature: s2(t.temperature), productName: t.productName, note: t.note, rows: t.rows.map((r) => ({ dose: s2(r.dose), v: Object.fromEntries(KEYS.map((k) => [k, s2(r.values[k])])) as Record<JarKey, string> })) });
const fromDraft = (d: Draft, coag: CoagulantType, source: JarTest["source"]): JarTest => ({
  id: d.id, date: d.date, season: d.season, temperature: toNum(d.temperature), coagulantType: coag, productName: d.productName, note: d.note, source,
  rows: d.rows.filter((r) => r.dose.trim() !== "").map((r) => ({ dose: toNum(r.dose), values: Object.fromEntries(KEYS.map((k) => [k, toNum(r.v[k])])) })),
});

/** Пробное коагулирование по ГОСТ Р 51642-2000, прил. А: нормативы, протокол, опыты по периодам года. */
export function JarPanel({ cat, coag, productName, cPct, source, onCommit }: {
  cat: Catalog; coag: CoagulantType; productName: string; cPct: number; source: JarTest["source"]; onCommit: (c: Catalog) => void;
}) {
  const norms = cat.norms ?? NORMS_SANPIN;
  const tests = (cat.jarTests ?? []).filter((t) => t.coagulantType === coag);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [nDraft, setNDraft] = useState<NormSet | null>(null);
  const m = workingSolutionMass(cPct);

  const saveTest = () => {
    if (!draft) return;
    const t = fromDraft(draft, coag, tests.find((x) => x.id === draft.id)?.source ?? source);
    const all = cat.jarTests ?? [];
    onCommit({ ...cat, jarTests: all.some((x) => x.id === t.id) ? all.map((x) => (x.id === t.id ? t : x)) : [...all, t] });
    setDraft(null);
  };

  return (
    <div className="panel">
      <h2>Пробное коагулирование</h2>
      <p className="small muted" style={{ marginTop: 0 }}>ГОСТ Р 51642-2000, прил. А. Оптимальная доза — наименьшая доза Al₂O₃, при которой выполнены все нормативы (п. 3.7, А.5). В проект — максимальная из оптимальных по периодам года (СП 31.13330.2021, п. 9.15).</p>

      <details className="small" style={{ marginBottom: 10 }}>
        <summary style={{ cursor: "pointer" }}>Протокол испытания</summary>
        <ol style={{ paddingLeft: 18, margin: "6px 0", display: "grid", gap: 3 }}>
          <li>Рабочий раствор (п. 5.4.2): навеска товарного продукта с 1,0 г Al₂O₃ на 1 дм³{Number.isFinite(m) ? <> — <b>{fmt(m, 2)} г</b> при {fmt(cPct, 2)} % Al₂O₃</> : " — нужна доля Al₂O₃ в паспорте продукта"}. 1 см³ на 1 дм³ пробы = 1 мг/дм³ Al₂O₃.</li>
          <li>Температура испытания (4 ± 1) °C и (20 ± 1) °C или фактическая температура воды (А.3). Перед испытанием в исходной воде определяют мутность, цветность, Fe, Al, ПО и pH.</li>
          <li>В стаканы по 1,0 дм³ воды при 140 об/мин вводят 1, 2, 3 … n см³ рабочего раствора; перемешивание 3 мин, затем 40 об/мин — 15 мин (А.4.2–А.4.3).</li>
          <li>Отстаивание 30 мин, фильтрование осветлённой части через бумажный фильтр (А.4.4–А.4.5).</li>
          <li>В фильтрате — мутность, цветность, Fe, Al, ПО, pH (А.4.6).</li>
        </ol>
      </details>

      <h3>Нормативы</h3>
      {!nDraft ? (
        <>
          <div className="tw"><table><thead><tr><th>Показатель</th><th className="n">min</th><th className="n">max</th><th>Проверка</th></tr></thead><tbody>
            {KEYS.map((k) => { const L = norms.limits[k]; return <tr key={k}><td>{JAR_PARAMS[k].label} <span className="basis">{JAR_PARAMS[k].unit}</span></td><td className="n">{fmt(L.min ?? NaN, 2)}</td><td className="n">{fmt(L.max ?? NaN, 2)}</td><td className="small">{L.active ? "да" : "нет"}</td></tr>; })}
          </tbody></table></div>
          <p className="footnote">{norms.name}. {norms.source}</p>
          <div className="btns" style={{ marginTop: 6 }}><button type="button" className="btn ghost" onClick={() => setNDraft(structuredClone(norms))}>Изменить нормативы</button></div>
        </>
      ) : (
        <>
          <div className="btns" style={{ marginTop: 0 }}>
            <button type="button" className="btn ghost" onClick={() => setNDraft(structuredClone(NORMS_SANPIN))}>Подставить СанПиН 1.2.3685-21</button>
            <button type="button" className="btn ghost" onClick={() => setNDraft(structuredClone(NORMS_GOST_MODEL))}>Подставить ГОСТ Р 51642, табл. 1</button>
          </div>
          <div className="tw"><table><thead><tr><th>Показатель</th><th>min</th><th>max</th><th>Проверять</th></tr></thead><tbody>
            {KEYS.map((k) => { const L = nDraft.limits[k]; const up = (p: Partial<typeof L>) => setNDraft({ ...nDraft, name: "Свои нормативы", source: "задано пользователем", limits: { ...nDraft.limits, [k]: { ...L, ...p } } }); return (
              <tr key={k}><td>{JAR_PARAMS[k].label} <span className="basis">{JAR_PARAMS[k].unit}</span></td>
                <td><input aria-label={`${JAR_PARAMS[k].label} min`} style={{ width: 70 }} value={s2(L.min)} onChange={(e) => up({ min: toNum(e.target.value) })} /></td>
                <td><input aria-label={`${JAR_PARAMS[k].label} max`} style={{ width: 70 }} value={s2(L.max)} onChange={(e) => up({ max: toNum(e.target.value) })} /></td>
                <td><input type="checkbox" aria-label={`Проверять ${JAR_PARAMS[k].label}`} checked={L.active} onChange={(e) => up({ active: e.target.checked })} /></td></tr>); })}
          </tbody></table></div>
          <div className="btns"><button type="button" className="btn" onClick={() => { onCommit({ ...cat, norms: nDraft }); setNDraft(null); }}>Сохранить нормативы</button><button type="button" className="btn ghost" onClick={() => setNDraft(null)}>Отмена</button></div>
        </>
      )}

      <h3 style={{ marginTop: 16 }}>Опыты</h3>
      {tests.length === 0 && !draft && <p className="small muted">Опытов нет. Без них доза показывается как предварительная оценка, не проектная.</p>}
      {tests.length > 0 && (
        <div className="tw"><table><thead><tr><th>Дата</th><th>Период</th><th className="n">T, °C</th><th className="n">Доз</th><th className="n">Dопт, мг/л Al₂O₃</th><th /></tr></thead><tbody>
          {tests.map((t) => { const r = optimalDose(t, norms); return (
            <tr key={t.id}><td>{t.date || "—"}</td><td>{seasonLabel(t.season)}</td><td className="n">{fmt(t.temperature ?? NaN, 1)}</td><td className="n">{r.checks.length}</td>
              <td className="n">{r.optimal !== null ? fmt(r.optimal) : <span className="small" style={{ color: "var(--bad)" }}>не найдена</span>}</td>
              <td style={{ whiteSpace: "nowrap" }}><button type="button" className="btn ghost" style={{ padding: "2px 8px" }} onClick={() => setDraft(toDraft(t))}>Изменить</button> <button type="button" className="btn ghost" style={{ padding: "2px 8px" }} onClick={() => { if (confirm("Удалить опыт?")) onCommit({ ...cat, jarTests: (cat.jarTests ?? []).filter((x) => x.id !== t.id) }); }}>×</button></td></tr>); })}
        </tbody></table></div>
      )}
      {!draft && <div className="btns"><button type="button" className="btn ghost" onClick={() => setDraft({ id: newId("jar"), date: new Date().toISOString().slice(0, 10), season: "other", temperature: "", productName, note: "", rows: [1, 2, 3, 4, 5, 6, 7, 8].map(emptyRow) })}>+ Опыт</button></div>}

      {draft && (
        <div style={{ borderTop: "1px solid var(--line)", marginTop: 12, paddingTop: 12 }}>
          <div className="fields">
            <div className="f"><label>Дата</label><input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></div>
            <div className="f"><label>Период года</label><select value={draft.season} onChange={(e) => setDraft({ ...draft, season: e.target.value as Season })}>{SEASONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div className="f"><label>Температура испытания, °C</label><input value={draft.temperature} onChange={(e) => setDraft({ ...draft, temperature: e.target.value })} placeholder="4 / 20 / факт." /></div>
            <div className="f"><label>Продукт</label><input value={draft.productName} onChange={(e) => setDraft({ ...draft, productName: e.target.value })} /></div>
          </div>
          <div className="tw" style={{ marginTop: 10 }}><table><thead><tr><th>D, мг/л Al₂O₃</th>{KEYS.map((k) => <th key={k}>{JAR_PARAMS[k].label}{JAR_PARAMS[k].unit ? <><br /><span className="small muted">{JAR_PARAMS[k].unit}</span></> : null}</th>)}<th /></tr></thead><tbody>
            {draft.rows.map((r, i) => {
              const upd = (p: Partial<typeof r>) => setDraft({ ...draft, rows: draft.rows.map((x, j) => (j === i ? { ...x, ...p } : x)) });
              return (
                <tr key={i}>
                  <td><input aria-label={`Доза ${i + 1}`} style={{ width: 60 }} value={r.dose} onChange={(e) => upd({ dose: e.target.value })} /></td>
                  {KEYS.map((k) => <td key={k}><input aria-label={`${JAR_PARAMS[k].label} при дозе ${i + 1}`} style={{ width: 58 }} value={r.v[k]} onChange={(e) => upd({ v: { ...r.v, [k]: e.target.value } })} /></td>)}
                  <td><button type="button" className="btn ghost" style={{ padding: "2px 8px" }} onClick={() => setDraft({ ...draft, rows: draft.rows.filter((_, j) => j !== i) })}>×</button></td>
                </tr>
              );
            })}
          </tbody></table></div>
          {(() => { const r = optimalDose(fromDraft(draft, coag, source), norms); return <p className="small" style={{ margin: "8px 0 0" }}>{r.optimal !== null ? <>Оптимальная доза по текущим нормативам: <b>{fmt(r.optimal)} мг/л Al₂O₃</b>.</> : "Оптимальная доза пока не найдена: ни одна заполненная доза не выполняет все нормативы (неизмеренный показатель — не выполнен)."}</p>; })()}
          <div className="btns">
            <button type="button" className="btn ghost" onClick={() => setDraft({ ...draft, rows: [...draft.rows, emptyRow((toNum(draft.rows[draft.rows.length - 1]?.dose ?? "0") ?? 0) + 1)] })}>+ доза</button>
            <button type="button" className="btn" onClick={saveTest}>Сохранить опыт</button>
            <button type="button" className="btn ghost" onClick={() => setDraft(null)}>Отмена</button>
          </div>
        </div>
      )}
    </div>
  );
}
