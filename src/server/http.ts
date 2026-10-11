import "server-only";

/** Публичный адрес сайта за прокси Railway (req.url там внутренний). */
export function publicOrigin(req: Request): string {
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return host ? `${proto.split(",")[0]}://${host.split(",")[0]}` : new URL(req.url).origin;
}

/** Только внутренние пути: защита от открытого редиректа. */
export function safeReturnTo(v: string | null | undefined): string {
  return v && /^\/(?!\/)[\w\-./?=&%]*$/.test(v) ? v : "/";
}
