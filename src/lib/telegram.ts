import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** Данные Telegram Login Widget. */
export interface TelegramAuth {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

const FIELDS = ["id", "first_name", "last_name", "username", "photo_url", "auth_date"] as const;

/**
 * Проверка подписи по документации Telegram Login Widget:
 * secret = SHA256(bot_token); hash = HMAC_SHA256(data_check_string, secret),
 * data_check_string — пары key=value всех полей кроме hash, по алфавиту, через \n.
 */
export function verifyTelegramAuth(params: Record<string, string | undefined>, botToken: string, nowSec = Math.floor(Date.now() / 1000), maxAgeSec = 86400):
  { ok: true; user: TelegramAuth } | { ok: false; reason: string } {
  const hash = params.hash;
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return { ok: false, reason: "Нет подписи Telegram." };
  const entries = Object.entries(params).filter(([k, v]) => k !== "hash" && v !== undefined && (FIELDS as readonly string[]).includes(k)) as [string, string][];
  const check = entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHash("sha256").update(botToken).digest();
  const calc = createHmac("sha256", secret).update(check).digest("hex");
  const a = Buffer.from(calc, "hex"), b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "Подпись Telegram недействительна." };
  const authDate = Number(params.auth_date);
  if (!Number.isFinite(authDate) || nowSec - authDate > maxAgeSec || authDate - nowSec > 300) return { ok: false, reason: "Данные входа устарели — войдите ещё раз." };
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, reason: "Некорректный идентификатор Telegram." };
  return { ok: true, user: { id, first_name: params.first_name, last_name: params.last_name, username: params.username, photo_url: params.photo_url, auth_date: authDate, hash } };
}

/** Подпись для тестов. */
export function signTelegramAuth(data: Record<string, string>, botToken: string): string {
  const check = Object.keys(data).sort().map((k) => `${k}=${data[k]}`).join("\n");
  return createHmac("sha256", createHash("sha256").update(botToken).digest()).update(check).digest("hex");
}
