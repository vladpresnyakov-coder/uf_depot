"use client";
import { t } from "@/i18n/ru";

export const fmt = (x: number | null | undefined, d?: number) => {
  if (typeof x !== "number" || !Number.isFinite(x)) return "—";
  const a = Math.abs(x);
  const dd = d ?? (a >= 1000 ? 0 : a >= 100 ? 1 : a >= 10 ? 2 : 3);
  return x.toLocaleString("ru-RU", { maximumFractionDigits: dd });
};

/** Число из строки поля: пусто → null (отсутствие данных не равно нулю). */
export const toNum = (s: string): number | null => {
  const v = s.trim().replace(",", ".");
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const STATUS_CLASS: Record<string, string> = { user: "s-user", prelim: "s-prelim", clarify: "s-clarify", incomplete: "s-incomplete", nodata: "s-nodata", balance: "s-balance" };
export function StatusPill({ status, label }: { status: string; label?: string }) {
  return <span className={`pill ${STATUS_CLASS[status] ?? "s-user"}`}>{label ?? (t.status as Record<string, string>)[status] ?? status}</span>;
}

export function NumField({ id, label, unit, value, onChange, hint, required, placeholder }: {
  id: string; label: string; unit?: string; value: string; onChange: (v: string) => void; hint?: string; required?: boolean; placeholder?: string;
}) {
  const missing = required && value.trim() === "";
  return (
    <div className={`f${missing ? " missing" : ""}`}>
      <label htmlFor={id}>{label}{required && <span className="req"> *</span>}</label>
      <div className="row">
        <input id={id} className="num" inputMode="decimal" value={value} placeholder={placeholder ?? "нет данных"} onChange={(e) => onChange(e.target.value)} />
        {unit && <span className="u">{unit}</span>}
      </div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function TextField({ id, label, value, onChange, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <div className="f">
      <label htmlFor={id}>{label}</label>
      <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Select<T extends string>({ id, label, value, options, onChange, hint }: {
  id: string; label: string; value: T; options: [T, string][]; onChange: (v: T) => void; hint?: string;
}) {
  return (
    <div className="f">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Seg<T extends string>({ name, value, options, onChange }: { name: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map(([k, l]) => (
        <label key={k}><input type="radio" name={name} checked={value === k} onChange={() => onChange(k)} />{l}</label>
      ))}
    </div>
  );
}

export function Messages({ items }: { items: [string, string][] }) {
  if (!items.length) return <p className="muted small">Нет</p>;
  return <>{items.map(([c, m], i) => <div key={i} className={`msg ${c}`}>{m}</div>)}</>;
}
