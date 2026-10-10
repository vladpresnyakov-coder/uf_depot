/** Лёгкая проверка входов API: числа, перечисления, границы. Значения из запроса — данные, не команды. */
export class InputError extends Error {}

export const num = (v: unknown, name: string, o: { min?: number; max?: number; int?: boolean; optional?: boolean } = {}): number | null => {
  if (v === null || v === undefined || v === "") {
    if (o.optional) return null;
    throw new InputError(`Не задано поле «${name}».`);
  }
  const x = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(x)) throw new InputError(`Поле «${name}» должно быть числом.`);
  if (o.int && !Number.isInteger(x)) throw new InputError(`Поле «${name}» должно быть целым.`);
  if (o.min !== undefined && x < o.min) throw new InputError(`«${name}» не меньше ${o.min}.`);
  if (o.max !== undefined && x > o.max) throw new InputError(`«${name}» не больше ${o.max}.`);
  return x;
};

export const oneOf = <T extends string>(v: unknown, name: string, allowed: readonly T[]): T => {
  if (typeof v !== "string" || !allowed.includes(v as T)) throw new InputError(`Поле «${name}»: допустимо ${allowed.join(", ")}.`);
  return v as T;
};

export const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");

export async function readJson(req: Request, maxBytes = 64_000): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > maxBytes) throw new InputError("Слишком большой запрос.");
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new InputError("Тело запроса должно быть JSON-объектом.");
  }
}

export function errorResponse(e: unknown) {
  if (e instanceof InputError) return Response.json({ error: e.message }, { status: 400 });
  console.error(e);
  return Response.json({ error: e instanceof Error ? e.message : "Внутренняя ошибка расчёта." }, { status: 422 });
}
