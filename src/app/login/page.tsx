import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { TelegramLogin } from "@/components/TelegramLogin";
import { authConfigured, currentUser } from "@/server/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Вход — UF Depot" };

const safe = (v: string | undefined) => (v && /^\/(?!\/)[\w\-./?=&%]*$/.test(v) ? v : "/");

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const back = safe(sp.returnTo);
  if (await currentUser()) redirect(back);
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = (h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")).split(",")[0];
  const authUrl = `${proto}://${host}/api/auth/telegram?returnTo=${encodeURIComponent(back)}`;
  const bot = (process.env.TELEGRAM_BOT_USERNAME ?? "").replace(/^@/, "");
  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <div className="eyebrow">Аккаунт</div>
      <h1>Вход через Telegram</h1>
      <p className="lead">Вход нужен, чтобы справочники коагулянтов и методик, а также сохранённые расчёты хранились в аккаунте и были доступны с любого устройства. Расчёты работают и без входа.</p>
      {sp.error && <div className="msg bad">{sp.error}</div>}
      <div className="panel">
        {authConfigured() && bot ? (
          <>
            <TelegramLogin bot={bot} authUrl={authUrl} />
            <p className="muted small" style={{ marginTop: 12 }}>Telegram передаёт сайту только имя, имя пользователя, фото профиля и числовой идентификатор. Номер телефона сайту не передаётся. Пароли не используются.</p>
          </>
        ) : (
          <div className="msg warn">Вход через Telegram ещё не настроен на сервере: администратору нужно задать переменные <code>TELEGRAM_BOT_TOKEN</code> и <code>TELEGRAM_BOT_USERNAME</code>{process.env.DATABASE_URL ? "" : " и подключить базу данных (DATABASE_URL)"}.</div>
        )}
      </div>
      <p className="small"><Link href={back}>← Вернуться без входа</Link></p>
    </div>
  );
}
