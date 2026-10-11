import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db, dbConfigured } from "./db";
import type { TelegramAuth } from "@/lib/telegram";

export const SESSION_COOKIE = "ufd_session";
const SESSION_DAYS = 30;

export interface SessionUser { id: number; telegramId: number; firstName: string; lastName: string; username: string | null; photoUrl: string | null }

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export const authConfigured = () => dbConfigured() && Boolean(process.env.TELEGRAM_BOT_TOKEN) && Boolean(process.env.TELEGRAM_BOT_USERNAME);

/** Создаёт или обновляет пользователя по Telegram и открывает сессию. Возвращает токен для cookie. */
export async function loginWithTelegram(tg: TelegramAuth): Promise<{ token: string; expires: Date }> {
  const u = await db().query(
    `INSERT INTO users (telegram_id, first_name, last_name, username, photo_url, last_login_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (telegram_id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
       username = EXCLUDED.username, photo_url = EXCLUDED.photo_url, last_login_at = now()
     RETURNING id`,
    [tg.id, tg.first_name ?? "", tg.last_name ?? "", tg.username ?? null, tg.photo_url ?? null],
  );
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db().query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)", [hashToken(token), u.rows[0].id, expires]);
  await db().query("DELETE FROM sessions WHERE expires_at < now()");
  return { token, expires };
}

/** Текущий пользователь по cookie; null — не вошёл или база не настроена. */
export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !dbConfigured()) return null;
  try {
    const r = await db().query(
      `SELECT u.id, u.telegram_id, u.first_name, u.last_name, u.username, u.photo_url
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [hashToken(token)],
    );
    const x = r.rows[0];
    return x ? { id: Number(x.id), telegramId: Number(x.telegram_id), firstName: x.first_name, lastName: x.last_name, username: x.username, photoUrl: x.photo_url } : null;
  } catch (e) {
    console.error("[auth] session lookup failed", e);
    return null;
  }
}

export async function logout(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token && dbConfigured()) await db().query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
}

export function unauthorized() {
  return Response.json({ error: "Нужно войти через Telegram." }, { status: 401 });
}
