import "server-only";
import path from "node:path";
import { SetupError } from "./config";

/**
 * The database.
 *
 * Online it is Postgres (for example Neon, added from Vercel's Storage tab),
 * found through DATABASE_URL. Without DATABASE_URL it is PGlite, the same
 * Postgres running inside this app and saving to `.data/` (or kept in memory
 * when INSIGHTS_DATA_DIR is "memory://", as the tests do). Both speak the
 * same SQL, so the rest of the app only sees `query()`.
 *
 * Every value is stored as text or double precision, and times are numbers
 * of milliseconds, so the two drivers return exactly the same JavaScript.
 */

export type Row = Record<string, unknown>;
export type Db = { query<T extends Row = Row>(text: string, params?: unknown[]): Promise<T[]> };

const TABLES = [
  `CREATE TABLE IF NOT EXISTS channels (
    id text PRIMARY KEY,
    title text NOT NULL DEFAULT '',
    thumbnail text NOT NULL DEFAULT '',
    token text,
    status text NOT NULL DEFAULT 'ok',
    baseline text,
    baseline_at double precision,
    connected_at double precision
  )`,
  `CREATE TABLE IF NOT EXISTS channel_access (
    email text NOT NULL,
    channel_id text NOT NULL,
    PRIMARY KEY (email, channel_id)
  )`,
  `CREATE TABLE IF NOT EXISTS videos (
    id text PRIMARY KEY,
    channel_id text NOT NULL,
    uploaded_by text,
    studio text,
    added_at double precision NOT NULL,
    title text NOT NULL DEFAULT '',
    thumbnail text NOT NULL DEFAULT '',
    published_at double precision,
    state text NOT NULL DEFAULT 'waiting',
    verdict text,
    ratio double precision,
    views double precision,
    next_check_at double precision,
    last_check_at double precision,
    ai_at double precision,
    report text
  )`,
  `CREATE INDEX IF NOT EXISTS videos_channel ON videos (channel_id)`,
  `CREATE INDEX IF NOT EXISTS videos_due ON videos (state, next_check_at)`,
  `CREATE TABLE IF NOT EXISTS snapshots (
    video_id text NOT NULL,
    at double precision NOT NULL,
    views double precision NOT NULL,
    likes double precision NOT NULL,
    comments double precision NOT NULL,
    PRIMARY KEY (video_id, at)
  )`,
  `CREATE TABLE IF NOT EXISTS reports (
    video_id text NOT NULL,
    milestone text NOT NULL,
    created_at double precision NOT NULL,
    report text NOT NULL,
    PRIMARY KEY (video_id, milestone)
  )`,
];

async function migrate(db: Db): Promise<void> {
  for (const statement of TABLES) await db.query(statement);
}

async function openPostgres(url: string): Promise<Db> {
  const { default: postgres } = await import("postgres");
  // prepare: false works with connection poolers such as Neon's "-pooler" address.
  const sql = postgres(url, { max: 3, prepare: false, idle_timeout: 20, connect_timeout: 15, onnotice: () => {} });
  return {
    async query<T extends Row>(text: string, params: unknown[] = []) {
      const rows = await sql.unsafe(text, params as never[]);
      return [...rows] as unknown as T[];
    },
  };
}

async function openPglite(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = process.env.INSIGHTS_DATA_DIR?.trim() || path.join(process.cwd(), ".data", "db");
  const pg = await PGlite.create(dir);
  return {
    async query<T extends Row>(text: string, params: unknown[] = []) {
      return (await pg.query<T>(text, params)).rows;
    },
  };
}

async function open(): Promise<Db> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url && process.env.VERCEL) {
    // Vercel cannot keep files, so the built-in database would forget everything.
    throw new SetupError("DATABASE_URL");
  }
  const db = url ? await openPostgres(url) : await openPglite();
  await migrate(db);
  return db;
}

// Kept on globalThis so that reloading code during development reuses one connection.
const holder = globalThis as typeof globalThis & { __insightsDb?: Promise<Db> };

export function db(): Promise<Db> {
  if (!holder.__insightsDb) {
    holder.__insightsDb = open().catch((err) => {
      holder.__insightsDb = undefined;
      throw err;
    });
  }
  return holder.__insightsDb;
}
