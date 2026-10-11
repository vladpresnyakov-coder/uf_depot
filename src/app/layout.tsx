import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { t } from "@/i18n/ru";
import { currentUser } from "@/server/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "UF Depot — инженерные расчёты ультрафильтрации",
  description: "Узел непосредственной коагуляции перед УФ и расчёт УФ-системы N+X.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="ru">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Condensed:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" />
      </head>
      <body>
        <header className="top">
          <Link href="/" className="brand" style={{ textDecoration: "none", color: "inherit" }}>{t.brand}<small>· ультрафильтрация</small></Link>
          <nav className="nav" aria-label="Разделы">
            <Link href="/coagulation">{t.nav.coag}</Link>
            <Link href="/uf">{t.nav.uf}</Link>
            <Link href="/methods">{t.nav.methods}</Link>
            {user && <Link href="/calculations">Мои расчёты</Link>}
          </nav>
          <div className="spacer" />
          {user ? (
            <span className="user">
              {user.photoUrl && /^https:\/\/t\.me\//.test(user.photoUrl) && <img src={user.photoUrl} alt="" />}
              <span>{[user.firstName, user.lastName].filter(Boolean).join(" ") || (user.username ? "@" + user.username : "Пользователь")}</span>
              <form action="/api/auth/logout" method="post"><button className="linkbtn" type="submit">Выйти</button></form>
            </span>
          ) : (
            <>
              <span className="pill s-clarify">{t.draft}</span>
              <Link href="/login" className="btn ghost" style={{ padding: "4px 10px" }}>Войти через Telegram</Link>
            </>
          )}
          <span className="demo-flag">v0.2</span>
        </header>
        <main>{children}</main>
        <footer className="foot">{t.footer}</footer>
      </body>
    </html>
  );
}
