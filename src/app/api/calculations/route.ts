import { db } from "@/server/db";
import { currentUser, unauthorized } from "@/server/auth";
import { errorResponse, InputError, oneOf, readJson, str } from "@/lib/validate";

export const dynamic = "force-dynamic";

/** Список сохранённых расчётов пользователя (без тел). */
export async function GET() {
  const u = await currentUser();
  if (!u) return unauthorized();
  const r = await db().query("SELECT id, kind, title, engine, created_at FROM calculations WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500", [u.id]);
  return Response.json({ items: r.rows.map((x) => ({ ...x, id: Number(x.id) })) }, { headers: { "cache-control": "no-store" } });
}

/** Сохранение неизменяемого снимка: входы + результат + версия ядра. */
export async function POST(req: Request) {
  const u = await currentUser();
  if (!u) return unauthorized();
  try {
    const b = await readJson(req, 2_000_000);
    const kind = oneOf(b.kind, "тип расчёта", ["coagulation", "uf"] as const);
    const title = str(b.title, 160).trim() || (kind === "uf" ? "Расчёт UF" : "Расчёт коагуляции");
    if (!b.input || typeof b.input !== "object" || !b.result || typeof b.result !== "object") throw new InputError("Нет входных данных или результата.");
    const r = await db().query(
      "INSERT INTO calculations (user_id, kind, title, engine, input, result) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
      [u.id, kind, title, str(b.engine, 60) || "unknown", JSON.stringify(b.input), JSON.stringify(b.result)],
    );
    return Response.json({ id: Number(r.rows[0].id) }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
