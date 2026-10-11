import { db, tx } from "@/server/db";
import { currentUser, unauthorized } from "@/server/auth";
import { errorResponse, InputError, readJson } from "@/lib/validate";

export const dynamic = "force-dynamic";
const MAX_BYTES = 1_000_000;
const MAX_ITEMS = 1000;

/** Справочник пользователя (продукты, методики, «по умолчанию»). null — в аккаунте ещё нет справочника. */
export async function GET() {
  const u = await currentUser();
  if (!u) return unauthorized();
  const r = await db().query("SELECT data, updated_at FROM user_catalogs WHERE user_id = $1", [u.id]);
  return Response.json({ catalog: r.rows[0]?.data ?? null, updatedAt: r.rows[0]?.updated_at ?? null }, { headers: { "cache-control": "no-store" } });
}

/** Сохранение справочника. Каждая версия методики дополнительно фиксируется неизменяемой записью. */
export async function PUT(req: Request) {
  const u = await currentUser();
  if (!u) return unauthorized();
  try {
    const body = await readJson(req, MAX_BYTES);
    const c = body.catalog as Record<string, unknown> | undefined;
    if (!c || c.version !== 1 || !Array.isArray(c.products) || !Array.isArray(c.methods)) throw new InputError("Неверный формат справочника.");
    if (c.products.length > MAX_ITEMS || c.methods.length > MAX_ITEMS) throw new InputError(`Не более ${MAX_ITEMS} записей в справочнике.`);
    const methods = c.methods as Record<string, unknown>[];
    for (const m of methods) if (!m || typeof m.id !== "string" || !Number.isInteger(m.version)) throw new InputError("У методики нет идентификатора или версии.");
    await tx(async (q) => {
      await q.query(
        `INSERT INTO user_catalogs (user_id, data, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [u.id, JSON.stringify(c)],
      );
      for (const m of methods) {
        if (m.model === "manual") continue;
        await q.query("INSERT INTO method_versions (user_id, method_id, version, data) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING", [u.id, String(m.id).slice(0, 80), m.version, JSON.stringify(m)]);
      }
    });
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
