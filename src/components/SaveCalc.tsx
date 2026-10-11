"use client";
import Link from "next/link";
import { useState } from "react";
import { saveCalculation, type MeUser } from "@/lib/account";

/** «Сохранить расчёт»: только для вошедших; снимок входов и результата. */
export function SaveCalc({ me, kind, input, result, engine, defaultTitle, returnTo }: { me: MeUser | null | undefined; kind: "coagulation" | "uf"; input: unknown; result: unknown; engine: string; defaultTitle: string; returnTo: string }) {
  const [title, setTitle] = useState("");
  const [state, setState] = useState<{ id?: number; error?: string; busy?: boolean }>({});
  if (me === undefined) return null;
  if (!me) return <p className="muted small">Чтобы сохранять расчёты, <Link href={`/login?returnTo=${encodeURIComponent(returnTo)}`}>войдите через Telegram</Link>.</p>;
  return (
    <div className="btns" style={{ alignItems: "center" }}>
      <input aria-label="Название расчёта" placeholder={defaultTitle} value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} style={{ minWidth: 220 }} />
      <button type="button" className="btn" disabled={!result || state.busy} onClick={async () => {
        setState({ busy: true });
        setState(await saveCalculation(kind, title.trim() || defaultTitle, input, result, engine));
      }}>{state.busy ? "Сохранение…" : "Сохранить расчёт"}</button>
      {state.id && <span className="small">Сохранено · <Link href={`/calculations/${state.id}`}>открыть</Link></span>}
      {state.error && <span className="small" style={{ color: "var(--bad)" }}>{state.error}</span>}
    </div>
  );
}
