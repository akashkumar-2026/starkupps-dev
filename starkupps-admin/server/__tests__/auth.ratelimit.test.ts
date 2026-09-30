import { describe, expect, it, vi } from "vitest";

// No database in unit tests: the limiter falls back to its in-memory store,
// which exercises the same counter arithmetic.
vi.mock("../db/supabase", () => ({
  getSql: async () => {
    throw new Error("no database in unit tests");
  },
  getSupabaseAdmin: () => {
    throw new Error("no database in unit tests");
  },
}));

vi.hoisted(() => {
  process.env.SESSION_SECRET =
    "test-only-secret-value-that-is-long-enough-32ch";
});

import {
  consume,
  peek,
  clear,
  consumeLoginAttempt,
  consumeLoginFailure,
  clearLoginFailures,
  progressiveDelayMs,
} from "../auth/rate-limit";
import { clientThrottleKey, getClientIp } from "../auth/client-ip";

const req = (overrides: Record<string, any> = {}) => ({
  socket: { remoteAddress: "203.0.113.10" },
  headers: { "user-agent": "vitest" },
  ...overrides,
});

const email = (n: string) => `user-${n}@example.com`;

describe("store-backed limiter", () => {
  it("allows requests up to the limit and blocks beyond it", async () => {
    const key = `t:allow-${Math.random()}`;
    for (let i = 1; i <= 5; i++) {
      const r = await consume(key, { max: 5, windowMs: 60_000 });
      expect(r.allowed, `attempt ${i}`).toBe(true);
      expect(r.count).toBe(i);
    }
    const blocked = await consume(key, { max: 5, windowMs: 60_000 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("reports a usable retry-after window", async () => {
    const key = `t:retry-${Math.random()}`;
    await consume(key, { max: 1, windowMs: 30_000 });
    const blocked = await consume(key, { max: 1, windowMs: 30_000 });
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(30_000);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("peek does not consume", async () => {
    const key = `t:peek-${Math.random()}`;
    expect((await peek(key, { max: 3 })).count).toBe(0);
    await consume(key, { max: 3 });
    await consume(key, { max: 3 });
    const p = await peek(key, { max: 3 });
    expect(p.count).toBe(2);
    expect(p.allowed).toBe(true);
    // Still 2 after peeking.
    expect((await peek(key, { max: 3 })).count).toBe(2);
  });

  it("clear resets the bucket", async () => {
    const key = `t:clear-${Math.random()}`;
    await consume(key, { max: 1, windowMs: 60_000 });
    expect((await consume(key, { max: 1 })).allowed).toBe(false);
    await clear(key);
    expect((await consume(key, { max: 1 })).allowed).toBe(true);
  });

  it("keeps separate buckets per key", async () => {
    const a = `t:iso-a-${Math.random()}`;
    const b = `t:iso-b-${Math.random()}`;
    await consume(a, { max: 1 });
    expect((await consume(a, { max: 1 })).allowed).toBe(false);
    expect((await consume(b, { max: 1 })).allowed).toBe(true);
  });
});

describe("login throttling separates attempts from failures", () => {
  it("does not let successful logins consume the failure budget", async () => {
    const e = email(`ok-${Math.random()}`);
    const input = { email: e, req: req() };
    // Well past the old 10-per-15min ceiling, simulating an admin who signs in
    // repeatedly across a shift. Under the previous design the 11th call was
    // locked out; now only failures count.
    for (let i = 0; i < 12; i++) {
      const r = await consumeLoginAttempt(input);
      expect(r.blocked, `attempt ${i + 1}`).toBeUndefined();
    }
    // ...and with zero failures recorded, the account is not throttled.
    expect(await progressiveDelayMs(e)).toBe(0);
  });

  it("blocks once the failure budget is exhausted", async () => {
    const e = email(`fail-${Math.random()}`);
    const input = { email: e, req: req() };
    let blocked: any;
    for (let i = 0; i < 20; i++) {
      const r = await consumeLoginFailure(input);
      if (r.blocked) {
        blocked = r;
        break;
      }
    }
    expect(blocked, "failure limiter should eventually engage").toBeDefined();
    expect(blocked.blocked?.reason).toBe("rate_limited");
    expect(blocked.blocked?.retryAfterMs).toBeGreaterThan(0);
  });

  it("clears failures after a successful login", async () => {
    const e = email(`clear-${Math.random()}`);
    const input = { email: e, req: req() };
    await consumeLoginFailure(input);
    await consumeLoginFailure(input);
    await clearLoginFailures(input);
    expect((await peek(`login:fail:acct:${e}`)).count).toBe(0);
    expect(await progressiveDelayMs(e)).toBe(0);
  });

  it("applies a growing delay after repeated failures", async () => {
    const e = email(`delay-${Math.random()}`);
    expect(await progressiveDelayMs(e)).toBe(0);
    const delays: number[] = [];
    for (let i = 0; i < 4; i++) {
      await consumeLoginFailure({ email: e, req: req() });
      delays.push(await progressiveDelayMs(e));
    }
    // Later failures must be slower than the first.
    expect(delays[delays.length - 1]).toBeGreaterThan(delays[0]);
    // Never unbounded.
    expect(delays[delays.length - 1]).toBeLessThanOrEqual(8_000);
  });

  it("does not collapse unidentified callers into one shared bucket", async () => {
    // A caller with no socket address and no User-Agent: previously every such
    // request shared `login:ip:unknown`, so one of them locked out all admins.
    const noIp = { socket: {}, headers: {} };
    const r1 = await consumeLoginAttempt({
      email: email("anon1"),
      req: noIp as any,
    });
    const r2 = await consumeLoginAttempt({
      email: email("anon2"),
      req: noIp as any,
    });
    expect(r1.blocked).toBeUndefined();
    expect(r2.blocked).toBeUndefined();
  });
});

describe("clientThrottleKey", () => {
  it("keys on the resolved client IP when available", async () => {
    expect(clientThrottleKey(req() as any, "p")).toBe("p:ip:203.0.113.10");
  });

  it("normalizes IPv4-mapped IPv6 addresses", async () => {
    expect(
      getClientIp(
        req({ socket: { remoteAddress: "::ffff:203.0.113.10" } }) as any
      )
    ).toBe("203.0.113.10");
  });

  it("ignores X-Forwarded-For when no proxy is trusted", async () => {
    const spoofed = req({
      headers: {
        "x-forwarded-for": "1.2.3.4, 5.6.7.8",
        "user-agent": "vitest",
      },
    });
    // With TRUST_PROXY unset the header must be ignored entirely.
    expect(getClientIp(spoofed as any)).toBe("203.0.113.10");
  });

  it("produces a distinct key per unknown caller rather than one shared bucket", async () => {
    const a = clientThrottleKey(
      { socket: {}, headers: { "user-agent": "agent-a" } } as any,
      "p"
    );
    const b = clientThrottleKey(
      { socket: {}, headers: { "user-agent": "agent-b" } } as any,
      "p"
    );
    expect(a).not.toBe(b);
  });
});
