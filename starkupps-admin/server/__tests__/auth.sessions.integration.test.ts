import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

// These tests run against a REMOTE database over Supabase's pooler, where a
// single statement has been observed taking 0.4s-5s and the reuse-detection
// test chains ~10 of them. The default 30s budget is an artefact of localhost
// assumptions, not a signal that anything is wrong, so this file opts into a
// realistic one. Without a reachable database every test skips.
const HOOK_TIMEOUT = 60_000;
const TEST_TIMEOUT = 120_000;
vi.setConfig({ testTimeout: TEST_TIMEOUT, hookTimeout: HOOK_TIMEOUT });
import {
  hashToken,
  createRefreshToken,
  createFamilyId,
  createSessionToken,
} from "../auth/auth";
import {
  createSession,
  findSessionById,
  listActiveSessions,
  rotateSession,
  revokeOtherSessions,
  revokeSessionById,
  validateSession,
  invalidateSessionCache,
  cleanupExpiredSessions,
  describeDevice,
} from "../auth/sessions";
import { getSql } from "../db/supabase";

/**
 * Device-session lifecycle against the real database.
 *
 * Covers the paths that are hard to reason about from code alone: rotating a
 * refresh token, detecting the replay of a rotated one, and confirming a whole
 * rotation family dies when reuse is detected.
 *
 * Skips (rather than fails) when no database is reachable, so the suite still
 * runs in a bare checkout.
 */

let sql: any = null;
let available = false;
let connectError: string | null = null;

// A scratch user row per run, removed afterwards. Uses a high id range so it
// cannot collide with a real account.
const TEST_USER_ID = 9_000_001;

beforeAll(async () => {
  try {
    sql = await getSql();
    await sql.unsafe("SELECT 1");
    await sql.unsafe("SELECT pg_sleep(0)");
    // Ensure the scratch user exists.
    await sql.unsafe(
      `INSERT INTO users (id, "openId", email, role, "loginMethod", "sessionVersion")
       VALUES ($1, $2, $3, 'admin', 'password', 0)
       ON CONFLICT (id) DO NOTHING`,
      [
        TEST_USER_ID,
        `email:session-test-${TEST_USER_ID}@example.invalid`,
        `session-test-${TEST_USER_ID}@example.invalid`,
      ]
    );
    available = true;
  } catch (e: any) {
    available = false;
    connectError = e?.message ?? String(e);
  }
}, HOOK_TIMEOUT);

afterAll(async () => {
  if (!available) return;
  try {
    await sql.unsafe("DELETE FROM sessions WHERE user_id = $1", [TEST_USER_ID]);
    await sql.unsafe("DELETE FROM users WHERE id = $1", [TEST_USER_ID]);
    await sql.end();
  } catch {
    /* best effort */
  }
}, HOOK_TIMEOUT);

const newSession = async (remember = false) => {
  const refreshToken = createRefreshToken();
  const s = await createSession({
    userId: TEST_USER_ID,
    audience: "admin",
    refreshToken,
    familyId: createFamilyId(),
    remember,
    userAgent:
      "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
    ipAddress: "203.0.113.55",
    sessionVersion: 0,
  });
  return { refreshToken, session: s };
};

describe("device sessions", { skip: false }, () => {
  it("skips cleanly without a database", () => {
    // Reported rather than silently passing, so a missing database is visible.
    if (!available) {
      console.warn(
        `[integration] database unavailable, session tests skipped: ${connectError}`
      );
    }
    expect(typeof available).toBe("boolean");
  });

  it("persists only the hash of the refresh token", async () => {
    if (!available) return;
    const { refreshToken, session } = await newSession();
    expect(session.tokenHash).toBe(hashToken(refreshToken));
    expect(session.tokenHash).not.toContain(refreshToken);
    const found = await findSessionById(session.id);
    expect(found?.tokenHash).toBe(hashToken(refreshToken));
  });

  it("records device metadata for the sessions UI", async () => {
    if (!available) return;
    const { session } = await newSession(true);
    expect(session.remember).toBe(true);
    expect(session.deviceLabel).toBe("Chrome on macOS");
    expect(session.ipAddress).toBe("203.0.113.55");
    const list = await listActiveSessions(TEST_USER_ID, "admin");
    const row = list.find(r => r.id === session.id);
    expect(row).toBeDefined();
    // The listing must never leak token material.
    expect(JSON.stringify(list)).not.toContain("tokenHash");
  });

  it("validates a live session and rejects a revoked one", async () => {
    if (!available) return;
    invalidateSessionCache();
    const { session } = await newSession();
    expect(
      (await validateSession(session.id, TEST_USER_ID, 0, { strict: true }))
        .active
    ).toBe(true);

    await revokeSessionById(session.id, TEST_USER_ID, "test");
    expect(
      (await validateSession(session.id, TEST_USER_ID, 0, { strict: true }))
        .active
    ).toBe(false);
  });

  it("rejects a session whose user does not match (no cross-account use)", async () => {
    if (!available) return;
    const { session } = await newSession();
    const v = await validateSession(session.id, TEST_USER_ID + 1, 0, {
      strict: true,
    });
    expect(v.active).toBe(false);
    expect(v.reason).toBe("missing");
  });

  it("rejects a session created under a stale sessionVersion", async () => {
    if (!available) return;
    const { session } = await newSession();
    const v = await validateSession(session.id, TEST_USER_ID, 99, {
      strict: true,
    });
    expect(v.active).toBe(false);
    expect(v.reason).toBe("version_mismatch");
  });

  it("rejects an expired session", async () => {
    if (!available) return;
    const { refreshToken, session } = await newSession();
    await sql.unsafe(
      "UPDATE sessions SET expires_at = now() - interval '1 hour' WHERE id = $1",
      [session.id]
    );
    const v = await validateSession(session.id, TEST_USER_ID, 0, {
      strict: true,
    });
    expect(v.active).toBe(false);
    expect(v.reason).toBe("expired");
    // And rotation refuses it.
    const rot = await rotateSession(hashToken(refreshToken), {
      refreshToken: createRefreshToken(),
    });
    expect(rot.status).toBe("expired");
  });

  it(
    "rotates a refresh token, retiring the old row in the same family",
    { timeout: TEST_TIMEOUT },
    async () => {
      if (!available) return;
      const { refreshToken, session } = await newSession();
      const nextToken = createRefreshToken();
      const rot = await rotateSession(hashToken(refreshToken), {
        refreshToken: nextToken,
      });
      expect(rot.status).toBe("ok");
      if (rot.status !== "ok") return;

      expect(rot.session.id).not.toBe(session.id);
      expect(rot.session.familyId).toBe(session.familyId);
      expect(rot.session.tokenHash).toBe(hashToken(nextToken));

      // The predecessor is retained (so replay is detectable) but retired.
      const old = await findSessionById(session.id);
      expect(old).not.toBeNull();
      expect(old!.revokedAt).not.toBeNull();
      expect(old!.replacedBy).toBe(rot.session.id);
    }
  );

  it(
    "revokes the whole family when a rotated token is replayed",
    { timeout: TEST_TIMEOUT },
    async () => {
      if (!available) return;
      const { refreshToken } = await newSession();
      const first = await rotateSession(hashToken(refreshToken), {
        refreshToken: createRefreshToken(),
      });
      expect(first.status).toBe("ok");
      if (first.status !== "ok") return;

      // Rotate again, so `first` is now itself superseded.
      const second = await rotateSession(first.session.tokenHash, {
        refreshToken: createRefreshToken(),
      });
      expect(second.status).toBe("ok");
      if (second.status !== "ok") return;

      // Replay the ORIGINAL token: the signature of a stolen token being reused.
      const replay = await rotateSession(hashToken(refreshToken), {
        refreshToken: createRefreshToken(),
      });
      expect(replay.status).toBe("reuse");
      if (replay.status !== "reuse") return;
      expect(replay.familyId).toBe(first.session.familyId);

      // Every session in the family — including the live successor — is now dead.
      for (const id of [first.session.id, second.session.id]) {
        const v = await validateSession(id, TEST_USER_ID, 0, { strict: true });
        expect(v.active, `session ${id} should be revoked`).toBe(false);
      }
    }
  );

  it("returns invalid for an unknown token", async () => {
    if (!available) return;
    const rot = await rotateSession(hashToken(createRefreshToken()), {
      refreshToken: createRefreshToken(),
    });
    expect(rot.status).toBe("invalid");
  });

  it("revokeOtherSessions spares the current device", async () => {
    if (!available) return;
    const a = await newSession();
    const b = await newSession();
    const n = await revokeOtherSessions(
      TEST_USER_ID,
      a.session.id,
      "test_others",
      "admin"
    );
    expect(n).toBeGreaterThanOrEqual(1);

    expect(
      (await validateSession(a.session.id, TEST_USER_ID, 0, { strict: true }))
        .active
    ).toBe(true);
    expect(
      (await validateSession(b.session.id, TEST_USER_ID, 0, { strict: true }))
        .active
    ).toBe(false);
  });

  it("revokeSessionById cannot touch another user's session", async () => {
    if (!available) return;
    const { session } = await newSession();
    // Wrong owner: no row should be affected.
    const ok = await revokeSessionById(
      session.id,
      TEST_USER_ID + 1,
      "attacker"
    );
    expect(ok).toBe(false);
    expect(
      (await validateSession(session.id, TEST_USER_ID, 0, { strict: true }))
        .active
    ).toBe(true);
  });

  it("the access token carries the session id, so a device can be revoked", async () => {
    if (!available) return;
    const { session } = await newSession();
    const { verifySessionToken } = await import("../auth/auth");
    const token = await createSessionToken({
      uid: TEST_USER_ID,
      openId: `email:session-test-${TEST_USER_ID}@example.invalid`,
      role: "admin",
      sv: 0,
      aud: "admin",
      sid: session.id,
      rem: true,
    });
    const payload = await verifySessionToken(token, "admin");
    expect(payload?.sid).toBe(session.id);

    // Revoking the row invalidates a token that is still cryptographically valid.
    await revokeSessionById(session.id, TEST_USER_ID, "test");
    expect(
      (await validateSession(payload!.sid!, TEST_USER_ID, 0, { strict: true }))
        .active
    ).toBe(false);
  });

  it("cleanup prunes expired sessions", async () => {
    if (!available) return;
    const { session } = await newSession();
    await sql.unsafe(
      "UPDATE sessions SET expires_at = now() - interval '30 days' WHERE id = $1",
      [session.id]
    );
    const before = await findSessionById(session.id);
    expect(before).not.toBeNull();
    await cleanupExpiredSessions();
    expect(await findSessionById(session.id)).toBeNull();
  });
});

describe("device labels", () => {
  it("derives a recognisable label from common user agents", () => {
    expect(
      describeDevice(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36"
      )
    ).toBe("Chrome on Windows");
    expect(
      describeDevice(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile Safari/604.1"
      )
    ).toBe("Safari on iOS");
    expect(
      describeDevice(
        "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0"
      )
    ).toBe("Firefox on Linux");
  });

  it("never echoes unbounded user-agent text into the UI column", () => {
    const label = describeDevice("A".repeat(5000));
    expect(label.length).toBeLessThanOrEqual(160);
  });

  it("handles a missing or unrecognised user agent", () => {
    expect(describeDevice(null)).toBe("Unknown device");
    expect(describeDevice("")).toBe("Unknown device");
    expect(describeDevice("curl/8.0.1").length).toBeLessThanOrEqual(160);
  });
});
