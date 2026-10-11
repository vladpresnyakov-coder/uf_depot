import { STATUS_LABEL, SECONDARY_NOTE, type BuiltinDef } from "@/core/coagulation/normative";
import { PROFILES, type CoagulantType } from "@/core/coagulation/profiles";
import { WATER_PARAMS, type WaterKey } from "@/core/coagulation/doseMethod";

const PILL: Record<BuiltinDef["status"], string> = { normative: "s-balance", reference: "s-user", superseded: "s-clarify" };

/** Карточка встроенной методики: документ, пункт, статус, формула, входы, предупреждения, цитаты из приложенного файла. */
export function BuiltinCard({ d, compact = false }: { d: BuiltinDef; compact?: boolean }) {
  const inputs = [...new Set(d.options.length ? ["max", "turbidity", "color"].flatMap((m) => d.required({ mode: m })) : d.required({}))] as WaterKey[];
  return (
    <div className="small" style={{ marginTop: 10 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
        <span className={`pill ${PILL[d.status]}`}>{STATUS_LABEL[d.status]}</span>
        {d.formulaCheck === "secondary" && <span className="pill s-clarify">формула: требуется сверка</span>}
      </div>
      <dl className="kv">
        <dt>Документ</dt><dd style={{ fontFamily: "var(--f-body)", textAlign: "right" }}>{d.doc}</dd>
        <dt>Пункт</dt><dd style={{ fontFamily: "var(--f-body)", textAlign: "right" }}>{d.clause}</dd>
        <dt>Коагулянты</dt><dd style={{ fontFamily: "var(--f-body)", textAlign: "right" }}>{(Object.entries(d.coagulants) as [CoagulantType, string][]).map(([t, h]) => `${PROFILES[t].label}${h === "equivalent" ? " (пересчёт по эквиваленту)" : ""}`).join("; ")}</dd>
        <dt>Входы</dt><dd style={{ fontFamily: "var(--f-body)", textAlign: "right" }}>{inputs.map((k) => `${WATER_PARAMS[k].label}${WATER_PARAMS[k].unit ? `, ${WATER_PARAMS[k].unit}` : ""}`).join("; ")}</dd>
        {d.fileRef && <><dt>Файл</dt><dd style={{ textAlign: "right" }}>{d.fileRef.file}<br /><span className="muted">источник текста: {d.fileRef.origin}</span></dd></>}
      </dl>
      <p style={{ margin: "8px 0 4px" }}><b>Формула:</b> <span className="mono">{d.formula}</span></p>
      {d.formulaCheck === "secondary" && <p className="muted" style={{ margin: "0 0 4px" }}>{SECONDARY_NOTE}</p>}
      {!compact && <p className="muted" style={{ margin: "0 0 4px" }}>{d.area}</p>}
      <details style={{ marginTop: 6 }}>
        <summary style={{ cursor: "pointer" }}>Цитаты из документа и предупреждения</summary>
        <ul style={{ paddingLeft: 18, margin: "6px 0" }}>{d.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        {d.quotes.map((q, i) => (
          <blockquote key={i} style={{ margin: "8px 0", padding: "6px 10px", borderLeft: `3px solid ${q.check === "text" ? "var(--accent)" : "var(--warn)"}`, background: "var(--soft)" }}>
            <div className="mono" style={{ fontSize: 11, marginBottom: 4 }}>{q.clause} · {q.check === "text" ? "по тексту приложенного файла" : "по вторичному источнику"}</div>
            {q.text}
          </blockquote>
        ))}
      </details>
    </div>
  );
}
