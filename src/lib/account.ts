"use client";
import { useEffect, useState } from "react";

export interface MeUser { id: number; firstName: string; lastName: string; username: string | null }

/** Текущий пользователь (null — не вошёл); undefined — ещё загружается. */
export function useMe(): MeUser | null | undefined {
  const [me, setMe] = useState<MeUser | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    fetch("/api/me", { cache: "no-store" }).then((r) => r.json()).then((j) => live && setMe(j.user ?? null)).catch(() => live && setMe(null));
    return () => { live = false; };
  }, []);
  return me;
}

export async function saveCalculation(kind: "coagulation" | "uf", title: string, input: unknown, result: unknown, engine: string): Promise<{ id?: number; error?: string }> {
  try {
    const r = await fetch("/api/calculations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, title, input, result, engine }) });
    const j = await r.json();
    return r.ok ? { id: j.id } : { error: j.error ?? "Не удалось сохранить." };
  } catch { return { error: "Сервер недоступен." }; }
}
