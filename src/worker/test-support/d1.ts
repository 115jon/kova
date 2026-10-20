/**
 * An in-memory SQLite that answers the slice of the D1 API the worker uses, so
 * tests run the real SQL (column affinity, type ordering and all) instead of
 * matching on query text. Test code only.
 */
import { readFileSync } from "node:fs";
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
