import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth";
import { db } from "@/server/db";
import { DeleteCalc } from "./DeleteCalc";

export const dynamic = "force-dynamic";
export const metadata = { title: "Мои расчёты — UF Depot" };
const KIND: Record<string, string> = { coagulation: "Коагуляция", uf: "UF Calc" };

export default async function Calculations() {
  const u = await currentUser();
  if (!u) redirect("/login?returnTo=/calculations");
  const r = await db().query("SELECT id, kind, title, engine, created_at FROM calculations WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500", [u.id]);
  return (
    <div className="page">
      <div className="eyebrow">Аккаунт · {u.firstName} {u.lastName}</div>
      <h1>Мои расчёты</h1>
      <p className="lead">Сохранённый расчёт — неизменяемый снимок: входные данные, результат и версия расчётного ядра на момент сохранения.</p>
      <div className="panel">
        {r.rows.length === 0 ? <p className="muted">Пока нет сохранённых расчётов. Кнопка «Сохранить расчёт» есть на страницах <Link href="/coagulation">Коагуляция</Link> и <Link href="/uf">UF Calc</Link>.</p> : (
          <table>
            <thead><tr><th>Дата</th><th>Раздел</th><th>Название</th><th>Ядро</th><th /></tr></thead>
            <tbody>
              {r.rows.map((x) => (
                <tr key={x.id}>
                  <td className="n">{new Date(x.created_at).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}</td>
                  <td>{KIND[x.kind] ?? x.kind}</td>
                  <td><Link href={`/calculations/${x.id}`}>{x.title}</Link></td>
                  <td className="muted small">{x.engine}</td>
                  <td><DeleteCalc id={Number(x.id)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
