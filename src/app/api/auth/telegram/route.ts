import { NextResponse } from "next/server";
import { verifyTelegramAuth } from "@/lib/telegram";
import { authConfigured, loginWithTelegram, SESSION_COOKIE } from "@/server/auth";
import { publicOrigin, safeReturnTo } from "@/server/http";

export const dynamic = "force-dynamic";

/** Сюда Telegram Login Widget перенаправляет после подтверждения входа (data-auth-url). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = publicOrigin(req);
  const back = safeReturnTo(url.searchParams.get("returnTo"));
  const fail = (reason: string) => NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(reason)}&returnTo=${encodeURIComponent(back)}`, 303);
  if (!authConfigured()) return fail("Вход через Telegram ещё не настроен на сервере.");
  const params = Object.fromEntries(url.searchParams.entries());
  const v = verifyTelegramAuth(params, process.env.TELEGRAM_BOT_TOKEN as string);
  if (!v.ok) return fail(v.reason);
  try {
    const { token, expires } = await loginWithTelegram(v.user);
    const res = NextResponse.redirect(`${origin}${back}`, 303);
    res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: origin.startsWith("https"), sameSite: "lax", path: "/", expires });
    return res;
  } catch (e) {
    console.error("[auth] login failed", e);
    return fail("Не удалось открыть сессию. Попробуйте ещё раз.");
  }
}
