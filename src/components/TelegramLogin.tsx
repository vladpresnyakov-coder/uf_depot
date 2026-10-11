"use client";
import { useEffect, useRef } from "react";

/** Кнопка Telegram Login Widget. Скрипт вставляется вручную, чтобы работать и при клиентской навигации. */
export function TelegramLogin({ bot, authUrl }: { bot: string; authUrl: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.innerHTML = "";
    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-widget.js?22";
    s.async = true;
    s.setAttribute("data-telegram-login", bot);
    s.setAttribute("data-size", "large");
    s.setAttribute("data-radius", "6");
    s.setAttribute("data-auth-url", authUrl);
    s.setAttribute("data-request-access", "write");
    s.setAttribute("data-lang", "ru");
    el.appendChild(s);
    return () => { el.innerHTML = ""; };
  }, [bot, authUrl]);
  return <div ref={box} style={{ minHeight: 48 }} />;
}
