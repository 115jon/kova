/**
 * An in-memory SQLite that answers the slice of the D1 API the worker uses, so
 * tests run the real SQL (column affinity, type ordering and all) instead of
 * matching on query text. Test code only.
 */
import { readdirSync, readFileSync } from "node:fs";
import type { KVNamespace } from "@cloudflare/workers-types";
import { fileURLToPath } from "node:url";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

export function migrationSql(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../migrations/${name}`, import.meta.url)), "utf8");
}

export function memoryD1(setup: (sqlite: DatabaseSync) => void) {
  const sqlite = new DatabaseSync(":memory:");
  setup(sqlite);

  const prepare = (sql: string): D1PreparedStatement => {
    let args: SQLInputValue[] = [];
    // D1 only reports a bad statement when it runs, so callers' .catch() works.
    const statement = { get: (...a: SQLInputValue[]) => sqlite.prepare(sql).get(...a), all: (...a: SQLInputValue[]) => sqlite.prepare(sql).all(...a), run: (...a: SQLInputValue[]) => sqlite.prepare(sql).run(...a) };
    const prepared = {
      bind(...next: unknown[]) {
        args = next as SQLInputValue[];
        return prepared as unknown as D1PreparedStatement;
      },
      async first<T>() {
        return (statement.get(...args) as T | undefined) ?? null;
      },
      async all<T>() {
        return { results: statement.all(...args) as T[] };
      },
      async run() {
        const result = statement.run(...args);
        return { success: true, meta: { changes: Number(result.changes) } } as D1Result;
      },
    };
    return prepared as unknown as D1PreparedStatement;
  };

  return { sqlite, db: { prepare } as unknown as D1Database };
}

/** Every file in migrations/, in apply order, the way wrangler runs them. */
export function allMigrationNames(): string[] {
  const dir = fileURLToPath(new URL("../../../migrations/", import.meta.url));
  return readdirSync(dir).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
}

/** D1 coerces these at bind time; node:sqlite throws on them. */
function d1Value(value: unknown): SQLInputValue {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  return value as SQLInputValue;
}

/**
 * The full migrated schema behind enough of the D1 API (batch, exec, `.all()`
 * with meta) for Better Auth's own D1 dialect to run against it. This is the
 * database a real `createAuth()` sees in production, minus the network.
 */
export function migratedD1(options: {
  /** Runs right before the named migration, e.g. to seed rows it must carry forward. */
  beforeMigration?: Record<string, (sqlite: DatabaseSync) => void>;
} = {}) {
  const sqlite = new DatabaseSync(":memory:");
  // D1 enforces foreign keys; so does this.
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const name of allMigrationNames()) {
    options.beforeMigration?.[name]?.(sqlite);
    // Some early migrations re-add columns 0000_init already has and rely on
    // that one statement failing alone. Run statements one by one and allow
    // exactly that failure.
    const statements = migrationSql(name)
      .replace(/--[^\n]*/g, "")
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements) {
      try {
        sqlite.exec(statement);
      } catch (error) {
        if (!/duplicate column name/i.test(String(error))) throw new Error(`${name}: ${String(error)}`);
      }
    }
  }

  const prepare = (sql: string) => {
    let args: SQLInputValue[] = [];
    const statement = () => sqlite.prepare(sql);
    const prepared = {
      bind(...next: unknown[]) {
        args = next.map(d1Value);
        return prepared;
      },
      async first<T>(column?: string) {
        const row = statement().get(...args) as Record<string, unknown> | undefined;
        if (!row) return null;
        return (column ? row[column] : row) as T;
      },
      async all<T>() {
        const stmt = statement();
        if (stmt.columns().length > 0) {
          return { success: true, results: stmt.all(...args) as T[], meta: { changes: 0 } };
        }
        const result = stmt.run(...args);
        return {
          success: true,
          results: [] as T[],
          meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
        };
      },
      async run() {
        const result = statement().run(...args);
        return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
      },
      async raw<T>() {
        return (statement().all(...args) as Record<string, unknown>[]).map((row) => Object.values(row)) as T[];
      },
    };
    return prepared;
  };

  const db = {
    prepare,
    async batch(statements: Array<ReturnType<typeof prepare>>) {
      return Promise.all(statements.map((statement) => statement.all()));
    },
    async exec(sql: string) {
      sqlite.exec(sql);
      return { count: 1, duration: 0 };
    },
  };

  return { sqlite, db: db as unknown as D1Database };
}

/** In-memory KV with the slice of the API the worker and Better Auth use. */
export function memoryKV() {
  const store = new Map<string, { value: string; expiresAt: number | null }>();
  const live = (key: string) => {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      store.delete(key);
      return null;
    }
    return entry.value;
  };
  return {
    store,
    kv: {
      async get(key: string, type?: string) {
        const value = live(key);
        if (value === null) return null;
        return type === "json" ? JSON.parse(value) : value;
      },
      async put(key: string, value: string, opts?: { expirationTtl?: number }) {
        store.set(key, { value, expiresAt: opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : null });
      },
      async delete(key: string) {
        store.delete(key);
      },
      async list(opts?: { prefix?: string }) {
        const keys = [...store.keys()].filter((name) => !opts?.prefix || name.startsWith(opts.prefix)).map((name) => ({ name }));
        return { keys, list_complete: true, cursor: "" };
      },
    } as unknown as KVNamespace,
  };
}
