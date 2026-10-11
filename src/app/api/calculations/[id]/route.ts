import { db } from "@/server/db";
import { currentUser, unauthorized } from "@/server/auth";

export const dynamic = "force-dynamic";
const notFound = () => Response.json({ error: "Расчёт не найден." }, { status: 404 });

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await currentUser();
  if (!u) return unauthorized();
  const id = Number((await ctx.params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return notFound();
  const r = await db().query("SELECT id, kind, title, engine, input, result, created_at FROM calculations WHERE id = $1 AND user_id = $2", [id, u.id]);
  return r.rows[0] ? Response.json({ ...r.rows[0], id }) : notFound();
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await currentUser();
  if (!u) return unauthorized();
  const id = Number((await ctx.params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return notFound();
  const r = await db().query("DELETE FROM calculations WHERE id = $1 AND user_id = $2", [id, u.id]);
  return r.rowCount ? Response.json({ ok: true }) : notFound();
}
