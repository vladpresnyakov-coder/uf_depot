import Link from "next/link";

export default function Home() {
  return (
    <div className="page">
      <section className="hero">
        <div>
          <div className="eyebrow">Инженерная платформа по ультрафильтрации</div>
          <h1>Расчёт коагуляции перед УФ и УФ-системы N+X с прослеживаемыми допущениями</h1>
          <p className="lead">Дозы и расходы коагулянта, контактные камеры, трубопровод, насосы-дозаторы. Годовое моделирование установок УФ с промывками BW и CEB, очередями общей станции и балансом обратного осмоса. Каждое число показывает своё происхождение.</p>
          <div className="btns">
            <Link className="btn" href="/coagulation">Рассчитать коагуляцию</Link>
            <Link className="btn ghost" href="/uf">Рассчитать УФ-систему</Link>
          </div>
        </div>
        <div className="panel">
          <h3>Принципы расчёта</h3>
          <ul className="small" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
            <li>Детерминированное ядро без генеративных моделей, покрытое тестами.</li>
            <li>Предварительная оценка не выдаётся за оптимум; без методики — «недостаточно данных».</li>
            <li>Отсутствие данных не равно нулю.</li>
            <li>Требования к качеству — требования, а не прогноз.</li>
          </ul>
        </div>
      </section>
      <h2>Инструменты</h2>
      <div className="grid3">
        <Link href="/coagulation" className="panel tool-card" style={{ textDecoration: "none", color: "inherit" }}>
          <span className="st" style={{ color: "var(--good)" }}>Доступно</span>
          <h3>Узел непосредственной коагуляции</h3>
          <p className="small muted" style={{ margin: 0 }}>ПОХА, FeCl₃, Fe₂(SO₄)₃, Al₂(SO₄)₃, FeSO₄. Заданная доза, пересчёт баз, камеры, труба, насосы.</p>
        </Link>
        <Link href="/uf" className="panel tool-card" style={{ textDecoration: "none", color: "inherit" }}>
          <span className="st" style={{ color: "var(--good)" }}>Доступно</span>
          <h3>UF Calc</h3>
          <p className="small muted" style={{ margin: 0 }}>Q1, Q2, Qnet; поиск J по требуемой производительности; группы BW, продление, реагенты CEB, баланс ОО.</p>
        </Link>
        <div className="panel tool-card">
          <span className="st muted">Аккаунт · следующий этап</span>
          <h3>Проекты, версии, документы</h3>
          <p className="small muted" style={{ margin: 0 }}>Уже работает: вход через Telegram, справочники в аккаунте, сохранённые расчёты. Далее: проекты и версии, ТКП, схема, DOCX/PDF/Excel.</p>
        </div>
      </div>
    </div>
  );
}
