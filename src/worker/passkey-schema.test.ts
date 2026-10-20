import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { passkey } from "@better-auth/passkey";
import { describe, expect, it } from "vitest";

const migration = (name: string) =>
  readFileSync(new URL(`../../migrations/${name}`, import.meta.url), "utf8");

function columns(db: DatabaseSync, table: string) {
  return (db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string; notnull: number }[]);
}

describe("passkey table", () => {
  it("has every column @better-auth/passkey writes, keeping rows from the old schema", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(`CREATE TABLE "user" (id TEXT PRIMARY KEY)`);
    db.exec(migration("0007_add_plugins.sql"));
    db.exec(`INSERT INTO "user" (id) VALUES ('u1')`);
    db.exec(`INSERT INTO "passkey" (id, name, "publicKey", "userId", "webauthnUserID", counter, "deviceType", "backedUp", transports, "createdAt")
             VALUES ('cred-abc', 'old', 'pk', 'u1', 'handle', 3, 'singleDevice', 0, 'internal', 1700000000000)`);

    db.exec(migration("0025_passkey_credential_id.sql"));

    const cols = columns(db, "passkey");
    const names = cols.map((c) => c.name);
    const wanted = Object.keys(passkey({ rpID: "localhost", origin: "http://localhost" }).schema.passkey.fields);
    expect(names).toEqual(expect.arrayContaining(["id", ...wanted]));
    // A required column the plugin never sets would fail every registration.
    const writable = new Set(["id", ...wanted]);
    expect(cols.filter((c) => c.notnull && !writable.has(c.name))).toEqual([]);

    expect(db.prepare(`SELECT "credentialID", counter, "userId" FROM "passkey" WHERE id = 'cred-abc'`).get()).toMatchObject({
      credentialID: "cred-abc",
      counter: 3,
      userId: "u1",
    });
    // Sign-in looks a credential up by id, so two rows must never share one.
    expect(() =>
      db.exec(`INSERT INTO "passkey" (id, "publicKey", "userId", "credentialID", counter, "deviceType", "backedUp")
               VALUES ('other-row', 'pk', 'u1', 'cred-abc', 0, 'singleDevice', 0)`),
    ).toThrow(/UNIQUE/);
    // Deleting the user still removes their passkeys.
    db.exec(`DELETE FROM "user" WHERE id = 'u1'`);
    expect(db.prepare(`SELECT count(*) AS n FROM "passkey"`).get()).toEqual({ n: 0 });
  });
});
