// Миграции схемы БД. Выполняются перед стартом сервера; каждая — один раз, в транзакции.
import pg from "pg";

const MIGRATIONS = [
  {
    id: "001_init",
    sql: `
      CREATE TABLE users (
        id            BIGSERIAL PRIMARY KEY,
        telegram_id   BIGINT UNIQUE NOT NULL,
        first_name    TEXT NOT NULL DEFAULT '',
        last_name     TEXT NOT NULL DEFAULT '',
        username      TEXT,
        photo_url     TEXT,
        locale        TEXT NOT NULL DEFAULT 'ru',
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_login_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE sessions (
        token_hash  TEXT PRIMARY KEY,
        user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at  TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX sessions_user_idx ON sessions(user_id);
      -- Справочник пользователя: продукты, текущие методики, отметки «по умолчанию».
      CREATE TABLE user_catalogs (
        user_id    BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        data       JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      -- Неизменяемые версии методик: только вставка.
      CREATE TABLE method_versions (
        user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        method_id  TEXT NOT NULL,
        version    INT NOT NULL,
        data       JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, method_id, version)
      );
      -- Сохранённые расчёты: неизменяемые снимки входов и результатов.
      CREATE TABLE calculations (
        id         BIGSERIAL PRIMARY KEY,
        user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind       TEXT NOT NULL CHECK (kind IN ('coagulation','uf')),
        title      TEXT NOT NULL,
        engine     TEXT NOT NULL,
        input      JSONB NOT NULL,
        result     JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX calculations_user_idx ON calculations(user_id, created_at DESC);
    `,
  },
];

export async function migrate(url = process.env.DATABASE_URL) {
  if (!url) { console.log("[migrate] DATABASE_URL не задан — пропуск"); return; }
  const internal = /\.railway\.internal|localhost|127\.0\.0\.1/.test(url);
  const client = new pg.Client({ connectionString: url, ssl: internal ? false : { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
    await client.query("SELECT pg_advisory_lock(424242)");
    const done = new Set((await client.query("SELECT id FROM schema_migrations")).rows.map((r) => r.id));
    for (const m of MIGRATIONS) {
      if (done.has(m.id)) continue;
      await client.query("BEGIN");
      try {
        await client.query(m.sql);
        await client.query("INSERT INTO schema_migrations(id) VALUES ($1)", [m.id]);
        await client.query("COMMIT");
        console.log(`[migrate] применена ${m.id}`);
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }
    await client.query("SELECT pg_advisory_unlock(424242)");
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // старт с повторами: база может подниматься дольше приложения
  for (let i = 1; i <= 10; i++) {
    try { await migrate(); process.exit(0); }
    catch (e) { console.error(`[migrate] попытка ${i}: ${e.message}`); await new Promise((r) => setTimeout(r, 3000)); }
  }
  process.exit(1);
}
