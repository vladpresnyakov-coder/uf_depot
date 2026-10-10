import { PUBLIC_METHODS, PENDING_METHODS } from "@/core/coagulation/methods";
import { PROFILES, type CoagulantType } from "@/core/coagulation/profiles";

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
      <p className="lead">Методики — версионируемые неизменяемые записи. В общем реестре v0.1 только ручная доза и шаблоны без коэффициентов: методик предварительной оценки нет до получения источников. Персональные копии и редактор — следующий этап.</p>
      <div className="panel" style={{ marginBottom: 20 }}>
        <h2>Профили коагулянтов</h2>
        <div className="tw"><table><thead><tr><th>Профиль</th><th>Металл</th><th>Щёлочность</th><th>Особые проверки</th></tr></thead><tbody>
          {(Object.keys(PROFILES) as CoagulantType[]).map((k) => { const p = PROFILES[k]; return <tr key={k}><td>{p.label}</td><td className="mono">{p.oxidation}</td><td className="mono small">{p.alkalinityEqPerMmol} мг-экв/ммоль{p.usesBasicity ? " × (1 − B)" : ""}</td><td className="small">{p.checks.join("; ")}</td></tr>; })}
        </tbody></table></div>
      </div>
      <div className="panel" style={{ marginBottom: 20 }}>
        <h2>Общий реестр</h2>
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
