import { NextResponse } from "next/server";
import { logout, SESSION_COOKIE } from "@/server/auth";
import { publicOrigin } from "@/server/http";

export async function POST(req: Request) {
  try { await logout(); } catch (e) { console.error("[auth] logout", e); }
  const res = NextResponse.redirect(`${publicOrigin(req)}/`, 303);
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
