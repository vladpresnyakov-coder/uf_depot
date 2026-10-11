import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/server/auth";
import { db } from "@/server/db";
import { DeleteCalc } from "../DeleteCalc";

export const dynamic = "force-dynamic";

export default async function CalcView({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const u = await currentUser();
  if (!u) redirect(`/login?returnTo=/calculations/${encodeURIComponent(raw)}`);
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const r = await db().query("SELECT kind, title, engine, input, result, created_at FROM calculations WHERE id = $1 AND user_id = $2", [id, u.id]);
  const c = r.rows[0];
  if (!c) notFound();
  const json = (v: unknown) => JSON.stringify(v, null, 2);
  return (
    <div className="page">
      <div className="eyebrow"><Link href="/calculations">Мои расчёты</Link> · {c.kind === "uf" ? "UF Calc" : "Коагуляция"} · {c.engine}</div>
      <h1>{c.title}</h1>
      <p className="lead">Сохранён {new Date(c.created_at).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}. Снимок не изменяется; для нового варианта выполните расчёт заново и сохраните его.</p>
      <div className="grid2">
        <div className="panel"><h2>Входные данные</h2><pre className="code">{json(c.input)}</pre></div>
        <div className="panel"><h2>Результат</h2><pre className="code">{json(c.result)}</pre></div>
      </div>
      <div className="btns"><a className="btn ghost" href={`/api/calculations/${id}`} download={`uf-depot-calc-${id}.json`}>Скачать JSON</a><DeleteCalc id={id} then="/calculations" /></div>
    </div>
  );
}
