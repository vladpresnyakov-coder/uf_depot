import { PUBLIC_METHODS, PENDING_METHODS } from "@/core/coagulation/methods";
import { PROFILES, type CoagulantType } from "@/core/coagulation/profiles";
import { BUILTIN_METHODS } from "@/core/coagulation/normative";
import { BuiltinCard } from "@/components/BuiltinCard";

export const metadata = { title: "Расчётные методики — UF Depot" };

const STATUS: Record<string, [string, string]> = {
  published: ["s-balance", "Опубликована"], template: ["s-user", "Шаблон без коэффициентов"],
  "personal-unverified": ["s-clarify", "Личная, не верифицирована"], "personal-validated": ["s-prelim", "Личная, тесты пройдены"],
};

export default function Methods() {
  return (
    <div className="page">
      <div className="eyebrow">Реестр расчётных методик</div>
      <h1>Методики</h1>
      <p className="lead">Методики — версионируемые неизменяемые записи. Встроенные методики взяты из нормативных документов и справочных источников с указанием пункта и цитатами; коэффициенты не придумываются. Свои методики (выражение или таблица) пользователь заводит в справочнике на странице «Коагуляция». Любая расчётная доза уточняется пробной коагуляцией и при наладке.</p>
      <div className="panel" style={{ marginBottom: 20 }}>
        <h2>Нормативные и справочные методики дозы коагулянта</h2>
        <p className="small muted" style={{ marginTop: 0 }}>Рекомендуемая по типу объекта: ВОС — СНиП 2.04.02-84*, п. 6.16 (действующий документ — СП 31.13330.2021, пп. 9.1, 9.2, 9.15: дозы по исследованиям и опыту эксплуатации, по сезонам); ТЭС и котельные — РД 153-34.1-37.502-2000, п. 7.4.</p>
        {BUILTIN_METHODS.map((d) => (
          <div key={d.id} style={{ borderTop: "1px solid var(--line)", paddingTop: 12, marginTop: 12 }}>
            <h3 style={{ margin: 0 }}>{d.title} <span className="mono small muted">v{d.version}</span></h3>
            <BuiltinCard d={d} />
          </div>
        ))}
      </div>
      <div className="panel" style={{ marginBottom: 20 }}>
        <h2>Профили коагулянтов</h2>
        <div className="tw"><table><thead><tr><th>Профиль</th><th>Металл</th><th>Щёлочность</th><th>Особые проверки</th></tr></thead><tbody>
          {(Object.keys(PROFILES) as CoagulantType[]).map((k) => { const p = PROFILES[k]; return <tr key={k}><td>{p.label}</td><td className="mono">{p.oxidation}</td><td className="mono small">{p.alkalinityEqPerMmol} мг-экв/ммоль{p.usesBasicity ? " × (1 − B)" : ""}</td><td className="small">{p.checks.join("; ")}</td></tr>; })}
        </tbody></table></div>
      </div>
      <div className="panel" style={{ marginBottom: 20 }}>
        <h2>Общий реестр: ручная доза и шаблоны</h2>
        <div className="tw"><table><thead><tr><th>ID</th><th className="n">Версия</th><th>Методика</th><th>Тип модели</th><th>Основание</th><th>Статус</th></tr></thead><tbody>
          {PUBLIC_METHODS.map((m) => <tr key={m.id}><td className="mono small">{m.id}</td><td className="n">v{m.version}</td><td>{m.note}</td><td className="mono small">{m.modelType}</td><td className="small">{m.source}</td><td><span className={`pill ${STATUS[m.validationStatus][0]}`}>{STATUS[m.validationStatus][1]}</span></td></tr>)}
        </tbody></table></div>
      </div>
      <div className="panel">
        <h2>Требуют подтверждения источниками</h2>
        <div className="tw"><table><thead><tr><th>Код</th><th>Методика</th><th>Область</th><th>Без неё сейчас</th></tr></thead><tbody>
          {PENDING_METHODS.map((m) => <tr key={m.code}><td className="mono">{m.code}</td><td>{m.name}</td><td className="small">{m.scope}</td><td className="small">{m.fallback}</td></tr>)}
        </tbody></table></div>
      </div>
    </div>
  );
}
