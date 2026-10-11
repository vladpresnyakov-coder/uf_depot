"use client";
import { useRouter } from "next/navigation";

export function DeleteCalc({ id, then }: { id: number; then?: string }) {
  const router = useRouter();
  return (
    <button type="button" className="btn ghost" style={{ padding: "2px 8px" }} onClick={async () => {
      if (!confirm("Удалить сохранённый расчёт? Это действие необратимо.")) return;
      const r = await fetch(`/api/calculations/${id}`, { method: "DELETE" });
      if (r.ok) { if (then) router.push(then); router.refresh(); } else alert("Не удалось удалить.");
    }}>Удалить</button>
  );
}
