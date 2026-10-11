import { describe, expect, it } from "vitest";
import { signTelegramAuth, verifyTelegramAuth } from "@/lib/telegram";

const TOKEN = "123456:TEST-token-not-real";
const NOW = 1_800_000_000;
const base = { id: "42", first_name: "Иван", username: "ivan", auth_date: String(NOW - 60) };
const signed = (d: Record<string, string>, tok = TOKEN) => ({ ...d, hash: signTelegramAuth(d, tok) });

describe("Telegram Login Widget: проверка подписи", () => {
  it("принимает корректную подпись", () => {
    const r = verifyTelegramAuth(signed(base), TOKEN, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.user.id).toBe(42); expect(r.user.first_name).toBe("Иван"); }
  });
  it("отклоняет подпись другого бота", () => {
    expect(verifyTelegramAuth(signed(base, "999:other"), TOKEN, NOW).ok).toBe(false);
  });
  it("отклоняет изменённые данные", () => {
    expect(verifyTelegramAuth({ ...signed(base), id: "43" }, TOKEN, NOW).ok).toBe(false);
  });
  it("отклоняет устаревшие данные (старше суток)", () => {
    const old = { ...base, auth_date: String(NOW - 86_401) };
    const r = verifyTelegramAuth(signed(old), TOKEN, NOW);
    expect(r.ok).toBe(false);
  });
  it("отклоняет отсутствие подписи и посторонние поля не влияют на проверку", () => {
    expect(verifyTelegramAuth(base, TOKEN, NOW).ok).toBe(false);
    expect(verifyTelegramAuth({ ...signed(base), returnTo: "/uf" }, TOKEN, NOW).ok).toBe(true);
  });
});
