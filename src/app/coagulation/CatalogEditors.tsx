"use client";
import { useState } from "react";
import { PROFILES, basisLabel, type Basis, type CoagulantType } from "@/core/coagulation/profiles";
import { WATER_PARAMS, PRODUCT_PARAMS, validateMethod, type DoseMethod, type WaterKey, type ProductKey } from "@/core/coagulation/doseMethod";
import type { Product } from "@/lib/catalog";
import { toNum } from "@/components/ui";

/** Числовое поле, хранящее набранный текст локально (запятая, пустое значение = нет данных). */
export function NumInput({ id, value, onChange, width = 90, label }: { id?: string; value: number | null | undefined; onChange: (v: number | null) => void; width?: number; label?: string }) {
  const [text, setText] = useState(value == null ? "" : String(value).replace(".", ","));
  return <input id={id} aria-label={label} className="num" style={{ width, textAlign: "right", fontFamily: "var(--f-mono)" }} value={text} placeholder="—" onChange={(e) => { setText(e.target.value); onChange(toNum(e.target.value)); }} />;
}

const F = ({ label, children, hint, wide }: { label: string; children: React.ReactNode; hint?: string; wide?: boolean }) => (
  <div className="f" style={wide ? { gridColumn: "1 / -1" } : undefined}><label>{label}</label>{children}{hint && <div className="hint">{hint}</div>}</div>
);

export function productErrors(p: Product): string[] {
  const e: string[] = [];
  if (!p.name.trim()) e.push("Укажите название продукта.");
  if (p.concentration == null || !p.concentrationBasis) e.push("Концентрация принимается только вместе с базой.");
  if (p.concentration != null && (p.concentration <= 0 || p.concentration > 100)) e.push("Концентрация — от 0 до 100 % масс.");
  if (p.concentrationBasis === "hydrate" && !(p.hydrateN && p.hydrateN > 0)) e.push("Для базы «кристаллогидрат» укажите n.");
  if (p.form === "liquid" && p.density == null) e.push("Для жидкого продукта нужна плотность.");
  if (p.density != null && (p.density < 0.8 || p.density > 2)) e.push("Плотность вне 0,8–2,0 кг/л — проверьте паспорт.");
  if (p.workingConcentration != null && !p.workingBasis) e.push("Концентрация рабочего раствора — только с базой.");
  return e;
}

export function ProductEditor({ initial, onSave, onCancel }: { initial: Product; onSave: (p: Product) => void; onCancel: () => void }) {
  const [p, setP] = useState<Product>(initial);
  const P = PROFILES[p.coagulantType];
  const set = <K extends keyof Product>(k: K, v: Product[K]) => setP((s) => ({ ...s, [k]: v }));
  const bases: [Basis, string][] = P.bases.filter((b) => b !== "product").map((b) => [b, basisLabel(p.coagulantType, b, p.hydrateN)]);
  const errs = productErrors(p);
  return (
    <div className="calc" style={{ marginTop: 12 }}>
      <h3>{initial.name ? `Продукт: ${initial.name}` : "Новый продукт"} · {P.label}</h3>
      <div className="fields">
        <F label="Название *"><input value={p.name} onChange={(e) => set("name", e.target.value)} /></F>
        <F label="Производитель"><input value={p.manufacturer} onChange={(e) => set("manufacturer", e.target.value)} /></F>
        <F label="Марка"><input value={p.grade} onChange={(e) => set("grade", e.target.value)} /></F>
        <F label="Партия"><input value={p.batch} onChange={(e) => set("batch", e.target.value)} placeholder="опционально" /></F>
        <F label="Форма"><select value={p.form} onChange={(e) => set("form", e.target.value as Product["form"])}><option value="liquid">жидкий</option><option value="solid">твёрдый</option></select></F>
        {P.salt && <F label="n в кристаллогидрате ·nH₂O"><NumInput value={p.hydrateN} onChange={(v) => set("hydrateN", v)} /></F>}
        <F label="Концентрация, % масс. *"><NumInput value={p.concentration} onChange={(v) => set("concentration", v)} /></F>
        <F label="База концентрации *"><select value={p.concentrationBasis ?? ""} onChange={(e) => set("concentrationBasis", (e.target.value || null) as Basis | null)}><option value="">— не задана —</option>{bases.map(([b, l]) => <option key={b} value={b}>{l}</option>)}</select></F>
        {p.form === "liquid" && <F label="Плотность товарного раствора, кг/л *"><NumInput value={p.density} onChange={(v) => set("density", v)} /></F>}
        {P.usesBasicity && <F label="Основность, %"><NumInput value={p.basicity} onChange={(v) => set("basicity", v)} /></F>}
        {P.usesBasicity && <F label="Определение основности"><input value={p.basicityDefinition} onChange={(e) => set("basicityDefinition", e.target.value)} placeholder="напр. [OH]/(3·[Al]), мольн. %" /></F>}
        <F label="Свободная кислотность" hint="если указана в паспорте"><NumInput value={p.freeAcidity} onChange={(v) => set("freeAcidity", v)} /></F>
        {P.metal === "Fe" && <F label="Доля Fe²⁺ от Fe общ., %"><NumInput value={p.fe2Share} onChange={(v) => set("fe2Share", v)} /></F>}
        <F label="Приготовление рабочего раствора"><input value={p.workingPreparation} onChange={(e) => set("workingPreparation", e.target.value)} /></F>
        <F label="Рабочий раствор, г/л"><NumInput value={p.workingConcentration} onChange={(v) => set("workingConcentration", v)} /></F>
        <F label="База рабочего раствора"><select value={p.workingBasis ?? ""} onChange={(e) => set("workingBasis", (e.target.value || null) as Basis | null)}><option value="">— не задана —</option>{[...bases, ["product", "товарный продукт"] as [Basis, string]].map(([b, l]) => <option key={b} value={b}>{l}</option>)}</select></F>
        <F label="Источник данных (паспорт, сертификат)" wide><input value={p.source} onChange={(e) => set("source", e.target.value)} /></F>
      </div>
      {errs.map((e, i) => <div key={i} className="msg warn small">{e}</div>)}
      <div className="btns">
        <button className="btn" type="button" disabled={!p.name.trim() || p.concentration == null || !p.concentrationBasis} onClick={() => onSave({ ...p, demo: false })}>Сохранить продукт</button>
        <button className="btn ghost" type="button" onClick={onCancel}>Отмена</button>
      </div>
    </div>
  );
}

const ALL_INPUTS: [WaterKey | ProductKey, string][] = [
  ...(Object.entries(WATER_PARAMS) as [WaterKey, { label: string; unit: string }][]).map(([k, v]) => [k, `${v.label}${v.unit ? ", " + v.unit : ""}`] as [WaterKey, string]),
  ...(Object.entries(PRODUCT_PARAMS) as [ProductKey, { label: string; unit: string }][]).map(([k, v]) => [k, `Продукт: ${v.label}, ${v.unit}`] as [ProductKey, string]),
];

export function MethodEditor({ initial, onSave, onCancel }: { initial: DoseMethod; onSave: (m: DoseMethod) => void; onCancel: () => void }) {
  const [m, setM] = useState<DoseMethod>(initial);
  const t = m.coagulantType;
  const P = PROFILES[t];
  const set = <K extends keyof DoseMethod>(k: K, v: DoseMethod[K]) => setM((s) => ({ ...s, [k]: v }));
  const errs = validateMethod(m);
  const bases: [Basis, string][] = P.bases.map((b) => [b, basisLabel(t, b)]);
  return (
    <div className="calc" style={{ marginTop: 12 }}>
      <h3>{initial.name ? `Методика: ${initial.name} (сохранится как v${initial.version + (initial.name ? 1 : 0)})` : "Новая методика"} · {P.label}</h3>
      <div className="fields">
        <F label="Название *"><input value={m.name} onChange={(e) => set("name", e.target.value)} /></F>
        <F label="Тип модели"><select value={m.model} onChange={(e) => set("model", e.target.value as DoseMethod["model"])}><option value="expression">параметрическое выражение</option><option value="lookup">таблица по одному показателю</option></select></F>
        <F label="База результата (мг/л …)"><select value={m.outputBasis} onChange={(e) => set("outputBasis", e.target.value as Basis)}>{bases.map(([b, l]) => <option key={b} value={b}>{l}</option>)}</select></F>
        <F label="Источник / основание *" wide><input value={m.source} onChange={(e) => set("source", e.target.value)} placeholder="публикация, протокол испытаний, опыт объекта" /></F>
      </div>

      <h3 style={{ marginTop: 14 }}>Входы и область применимости</h3>
      <div className="tw"><table><thead><tr><th>Показатель</th><th className="n">min</th><th className="n">max</th><th></th></tr></thead><tbody>
        {m.inputs.map((inp, i) => (
          <tr key={i}>
            <td><select aria-label={`вход ${i + 1}`} value={inp.key} onChange={(e) => set("inputs", m.inputs.map((x, j) => (j === i ? { ...x, key: e.target.value as WaterKey } : x)))}>{ALL_INPUTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
            <td className="n"><NumInput label={`min ${i + 1}`} value={inp.min} onChange={(v) => set("inputs", m.inputs.map((x, j) => (j === i ? { ...x, min: v } : x)))} width={80} /></td>
            <td className="n"><NumInput label={`max ${i + 1}`} value={inp.max} onChange={(v) => set("inputs", m.inputs.map((x, j) => (j === i ? { ...x, max: v } : x)))} width={80} /></td>
            <td><button type="button" className="btn ghost" style={{ padding: "1px 8px" }} onClick={() => set("inputs", m.inputs.filter((_, j) => j !== i))}>×</button></td>
          </tr>
        ))}
      </tbody></table></div>
      <div className="btns"><button type="button" className="btn ghost" onClick={() => set("inputs", [...m.inputs, { key: "color", min: null, max: null }])}>+ вход</button></div>
      <p className="footnote">Имена для выражения: {m.inputs.map((i) => i.key).join(", ") || "—"}. Вне области применимости доза по методике не выдаётся.</p>

      {m.model === "expression" ? (
        <>
          <h3 style={{ marginTop: 14 }}>Выражение центральной оценки</h3>
          <input className="mono" style={{ width: "100%" }} value={m.expression ?? ""} onChange={(e) => set("expression", e.target.value)} placeholder="например: a + b*color + c*turbidity" aria-label="выражение" />
          <p className="footnote">Допустимо: + − * / ^, скобки, min, max, sqrt, ln, exp, abs. Произвольный код не выполняется.</p>
          <div className="tw"><table><thead><tr><th>Коэффициент</th><th className="n">Значение</th><th>Единица</th><th>Основание</th><th></th></tr></thead><tbody>
            {m.coefficients.map((c, i) => (
              <tr key={i}>
                <td><input aria-label={`имя ${i + 1}`} className="mono" style={{ width: 80 }} value={c.name} onChange={(e) => set("coefficients", m.coefficients.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></td>
                <td className="n"><NumInput label={`значение ${i + 1}`} value={c.value} onChange={(v) => set("coefficients", m.coefficients.map((x, j) => (j === i ? { ...x, value: v ?? NaN } : x)))} /></td>
                <td><input aria-label={`единица ${i + 1}`} style={{ width: 140 }} value={c.unit} onChange={(e) => set("coefficients", m.coefficients.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} /></td>
                <td><input aria-label={`основание ${i + 1}`} style={{ width: 160 }} value={c.basis} onChange={(e) => set("coefficients", m.coefficients.map((x, j) => (j === i ? { ...x, basis: e.target.value } : x)))} /></td>
                <td><button type="button" className="btn ghost" style={{ padding: "1px 8px" }} onClick={() => set("coefficients", m.coefficients.filter((_, j) => j !== i))}>×</button></td>
              </tr>
            ))}
          </tbody></table></div>
          <div className="btns"><button type="button" className="btn ghost" onClick={() => set("coefficients", [...m.coefficients, { name: `k${m.coefficients.length + 1}`, value: NaN, unit: "", basis: "" }])}>+ коэффициент</button></div>
          <div className="fields" style={{ marginTop: 10 }}>
            <F label="Диапазон вниз, доля" hint="0,2 = −20 % от центральной оценки"><NumInput value={m.band?.lower ?? null} onChange={(v) => set("band", { lower: v ?? 0, upper: m.band?.upper ?? 0 })} /></F>
            <F label="Диапазон вверх, доля"><NumInput value={m.band?.upper ?? null} onChange={(v) => set("band", { lower: m.band?.lower ?? 0, upper: v ?? 0 })} /></F>
          </div>
        </>
      ) : (
        <>
          <h3 style={{ marginTop: 14 }}>Таблица</h3>
          <F label="Ключевой показатель"><select value={m.lookup?.key ?? "color"} onChange={(e) => set("lookup", { key: e.target.value as WaterKey, rows: m.lookup?.rows ?? [] })}>{ALL_INPUTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></F>
          <div className="tw" style={{ marginTop: 8 }}><table><thead><tr><th className="n">от</th><th className="n">до</th><th className="n">низ дозы</th><th className="n">верх дозы</th><th className="n">центр (необяз.)</th><th></th></tr></thead><tbody>
            {(m.lookup?.rows ?? []).map((r, i) => (
              <tr key={i}>
                {(["from", "to", "low", "high", "central"] as const).map((k) => (
                  <td key={k} className="n"><NumInput label={`${k} ${i + 1}`} width={70} value={r[k] ?? null} onChange={(v) => set("lookup", { key: m.lookup!.key, rows: m.lookup!.rows.map((x, j) => (j === i ? { ...x, [k]: k === "central" ? v : v ?? NaN } : x)) })} /></td>
                ))}
                <td><button type="button" className="btn ghost" style={{ padding: "1px 8px" }} onClick={() => set("lookup", { key: m.lookup!.key, rows: m.lookup!.rows.filter((_, j) => j !== i) })}>×</button></td>
              </tr>
            ))}
          </tbody></table></div>
          <div className="btns"><button type="button" className="btn ghost" onClick={() => set("lookup", { key: m.lookup?.key ?? "color", rows: [...(m.lookup?.rows ?? []), { from: NaN, to: NaN, low: NaN, high: NaN, central: null }] })}>+ строка</button></div>
          <p className="footnote">Центральная оценка не вычисляется как середина: если она не задана, пользователь принимает дозу сам.</p>
        </>
      )}

      <h3 style={{ marginTop: 14 }}>Рабочий диапазон pH коагуляции</h3>
      <div className="fields">
        <F label="pH min"><NumInput value={m.phWindow?.min ?? null} onChange={(v) => set("phWindow", { min: v, max: m.phWindow?.max ?? null })} /></F>
        <F label="pH max" hint="используется для решения о коррекции pH; пусто — критерия нет"><NumInput value={m.phWindow?.max ?? null} onChange={(v) => set("phWindow", { min: m.phWindow?.min ?? null, max: v })} /></F>
      </div>

      {errs.length ? errs.map((e, i) => <div key={i} className="msg warn small">{e}</div>) : <div className="msg info small">Запись методики полная: единицы, область применимости и основание заданы.</div>}
      <div className="btns">
        <button className="btn" type="button" disabled={errs.length > 0} onClick={() => onSave({ ...m, status: m.status === "verified" ? "verified" : "user", version: initial.name ? initial.version + 1 : 1 })}>Сохранить методику</button>
        <button className="btn ghost" type="button" onClick={onCancel}>Отмена</button>
      </div>
    </div>
  );
}

export function typeLabel(t: CoagulantType) {
  return `${PROFILES[t].label.split(" ").slice(-1)[0]} · ${PROFILES[t].oxidation}`;
}
