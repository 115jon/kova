/**
 * App sessions are inserted by raw SQL, so Better Auth never audits them.
 * insertAppScopedSession writes the `app.signIn` event itself, and the geo
 * columns Better Auth would have filled.
 */
import { describe, expect, it } from "vitest";
import { queryAuditLogs } from "../audit";
import { migratedD1 } from "../test-support/d1";
import { insertAppScopedSession } from "./app-session";

const INSTAGRAM_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/23F77 Instagram 447.0.0.34.80 (iPhone18,1; iOS 26_5; en_US; en; scale=3.00; 1206x2622; IABMV/1; 1065993616) Safari/604.1";

function seed() {
  const { sqlite, db } = migratedD1();
  const now = Date.now();
  sqlite
    .prepare(
      `INSERT INTO application (id, name, publishable_key, secret_key_hash) VALUES ('app_yap', 'Yap', 'pk_test_yap', 'x')`,
    )
    .run();
  sqlite.prepare("INSERT INTO user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)").run("user_1", "Jon", "jon@example.com", now, now);
  return { sqlite, db };
}

describe("insertAppScopedSession", () => {
  it("writes app.signIn with the app, client, geo and how the session was minted", async () => {
    const { sqlite, db } = seed();
    const cf = { country: "US", city: "Austin", region: "Texas", regionCode: "TX", colo: "DFW", timezone: "America/Chicago", latitude: "30.2", longitude: "-97.7" };

    await insertAppScopedSession(db, {
      sessionId: "sess_1",
      userId: "user_1",
      token: "tok_1",
      appId: "app_yap",
      parentSessionId: "browser_1",
      ipAddress: "203.0.113.9",
      userAgent: INSTAGRAM_UA,
      cf: cf as unknown as IncomingRequestCfProperties,
      audit: { via: "sdk_bounce" },
    });

    const session = sqlite.prepare("SELECT country, city, region, regionCode, colo, timezone, latitude, longitude FROM session WHERE id = 'sess_1'").get();
    expect(session).toMatchObject({ country: "US", city: "Austin", region: "Texas", regionCode: "TX", colo: "DFW", timezone: "America/Chicago", latitude: "30.2", longitude: "-97.7" });

    const { logs } = await queryAuditLogs(db, { appId: "app_yap" });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      action: "app.signIn",
      userId: "user_1",
      actorName: "Jon",
      appId: "app_yap",
      appName: "Yap",
      country: "US",
      city: "Austin",
      ipAddress: "203.0.113.9",
      targetId: "sess_1",
    });
    const metadata = JSON.parse(logs[0]!.metadata!) as { via: string; parentSessionId: string; client: { inApp: string } };
    expect(metadata).toMatchObject({ via: "sdk_bounce", parentSessionId: "browser_1", client: { inApp: "instagram" } });
  });

  it("still inserts the session, without an audit row, when no audit context is given", async () => {
    const { sqlite, db } = seed();
    await insertAppScopedSession(db, {
      sessionId: "sess_2", userId: "user_1", token: "tok_2", appId: "app_yap", ipAddress: null, userAgent: null,
    });

    expect(sqlite.prepare("SELECT id FROM session WHERE id = 'sess_2'").get()).toEqual({ id: "sess_2" });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log").get()).toEqual({ n: 0 });
  });

  it("does not fail the sign-in when the audit write fails", async () => {
    const { sqlite, db } = seed();
    sqlite.exec("DROP TABLE audit_log");

    await expect(
      insertAppScopedSession(db, {
        sessionId: "sess_3", userId: "user_1", token: "tok_3", appId: "app_yap", ipAddress: null, userAgent: null,
        audit: { via: "device" },
      }),
    ).resolves.toBeUndefined();
    expect(sqlite.prepare("SELECT id FROM session WHERE id = 'sess_3'").get()).toEqual({ id: "sess_3" });
  });
});
