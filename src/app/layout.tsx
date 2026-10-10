import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { t } from "@/i18n/ru";

export const metadata: Metadata = {
  title: "UF Depot — инженерные расчёты ультрафильтрации",
  description: "Узел непосредственной коагуляции перед УФ и расчёт УФ-системы N+X.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
          </nav>
          <div className="spacer" />
          <span className="pill s-clarify">{t.draft}</span>
          <span className="demo-flag">v0.1</span>
        </header>
        <main>{children}</main>
        <footer className="foot">{t.footer}</footer>
      </body>
    </html>
  );
}
