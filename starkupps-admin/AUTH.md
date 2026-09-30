# StarKupps Admin — Authentication

How sign-in, sessions and "Remember on this device" work, and how to operate it.

The admin panel does **not** use an auth library and does **not** use Supabase
Auth. It is a bespoke implementation over `public.users` and `public.sessions`.
(`starkupps-web` customers _do_ use Supabase Auth — a completely separate
identity store.)

---

## 1. Model at a glance

```
Browser
  ├─ app_session_id        httpOnly  HS256 JWT   short-lived (1h)   "who am I"
  └─ app_session_id_refresh httpOnly opaque     30d or session      "stay signed in"
                                    (path=/api, SHA-256 hashed server-side)
                    │
                    ▼
        public.sessions   one row per signed-in device
                    │
                    ▼
        public.users     identity + role + sessionVersion (global kill switch)
```

Three independent pieces of state, each with a different job:

| State                         | Purpose                                                                            | Revoked by                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Access JWT (`app_session_id`) | Identity for each request                                                          | Expiry, or a matching revoked/expired `sessions` row                   |
| `public.sessions` row         | The device. Holds the refresh-token hash, `family_id`, `remember`, device metadata | Logout, revoke-device, revoke-others, password change, reuse detection |
| `users.sessionVersion`        | Global kill switch for every device at once                                        | Password change/reset                                                  |

The access token carries a `sid` claim pointing at its `sessions` row. That is
what allows **one device** to be revoked without signing the user out
everywhere.

---

## 2. Login

`auth.login` (`server/routers.ts`):

1. Normalize email; consume an **attempt** budget (generous).
2. Look up `users` (case-insensitive via the unique index on `lower(email)`).
3. Check `users.status` and `users.lockedUntil` **before** the password, so a
   disabled account cannot be probed.
4. Verify the password with Argon2id (m=64 MiB, t=3, p=4).
5. Enforce the owner-only rule for the Admin panel.
6. Create a `sessions` row + a refresh token; set both cookies.
7. Issue the access JWT with `sid`, `rem` and `rat` (re-authenticated-at).

### Identical work on every failure path

`reject()` performs the _same_ sequence whether or not the account exists:
Argon2 cost (equalized by `fakeVerifyDelay`), the throttle write, the audit
write, and the delay probe. Only the advisory `users.failedLoginAttempts` write
is account-specific, and it is deliberately **not awaited**.

Measured after the fix, warmed, with the order alternated: unknown address
6.35s median vs known address 6.37s — **0.1–0.6%**. Before the fix the gap was
roughly 2x the Argon2 cost and was enough to enumerate admin addresses.

---

## 3. "Remember on this device"

Unchecked (the default) → **no `Max-Age`/`Expires`**: a browser-session cookie
that dies when the browser closes. The server-side row is still bounded by
`AUTH_SESSION_HOURS` (default 12h).

Checked → `Max-Age` of `AUTH_REMEMBER_DAYS` (default 30) on both cookies, and
`sessions.remember = true`.

The access token is **never** made long-lived. A 30-day session is a 30-day
_refresh_ token plus a 1-hour access token, renewed transparently:

- `useAuth` calls `auth.refresh` when `/api/auth/me` returns 401 but a refresh
  cookie is present, and
- proactively ~5 minutes before expiry.

Neither the password nor any token is ever put in `localStorage`.

### Rotation and reuse detection

`auth.refresh` (`routers.ts`) → `rotateSession` (`server/_core/sessions.ts`):

1. Resolve the presented refresh token to a row by `token_hash`.
2. **Unknown** → `invalid`.
3. **Already revoked** → this is a replay: revoke the entire `family_id`, audit
   `session_reuse_detected`, force a fresh sign-in.
4. **Expired** → revoke, reject.
5. Otherwise insert the successor in the same `family_id` (inheriting
   `session_version_at_creation`), mark the predecessor revoked with
   `replaced_by`, and re-issue the access token.

Predecessor rows are **retained** (until cleanup) precisely so that replay is
detectable. A rotation is _not_ a re-authentication: `rat` is cleared, so
sensitive actions still ask for the password.

### Sensitive actions

`auth.changePassword` requires either a `rat` within `AUTH_REAUTH_WINDOW_MIN`
(15 min) **or** the current password. A remembered device gets no bypass. Use
`auth.reauthenticate` to refresh `rat` without a full sign-out.

---

## 4. Device management

Page: **`/settings/security`** (sidebar → _Security & devices_), backed by:

- `auth.sessions.list` — device label, last active, IP, expiry, `isCurrent`.
  Never includes token material.
- `auth.sessions.revoke` — end one device. Scoped to the caller, so another
  account's session id cannot be targeted.
- `auth.sessions.revokeOthers` — end everything except the current device.
- Changing the password revokes all sessions and mints a fresh one for the
  current device.

`auth.logout` revokes **only the current device** (previously it bumped
`sessionVersion` and signed you out everywhere).

---

## 4b. CSRF

State-changing requests are protected by a **signed double-submit token**:

1. On login the server sets `app_session_id_csrf` (`httpOnly: false`, so the SPA
   can read it) containing `nonce.hmac_sha256(nonce, SESSION_SECRET)`.
2. `withCsrfHeader()` in `client/src/main.tsx` (and `csrfHeaders()` in
   `useAuth.tsx` for the raw `fetch` calls) copies that value into the
   `x-csrf-token` header on every POST/PUT/PATCH/DELETE.
3. The server compares header vs cookie in constant time and rejects a mismatch
   with 403 `CSRF_FORBIDDEN`.

A cross-site attacker can make the browser send the cookie but cannot read it to
populate the header. Defence in depth behind it: `SameSite=Lax` plus the
Origin/Referer allowlist check.

This was previously missing entirely — a `csrf_tokens` table existed but no code
ever read it, leaving only the Origin check.

---

## 5. Cookies

|             | access                                | refresh                         | csrf                            |
| ----------- | ------------------------------------- | ------------------------------- | ------------------------------- |
| `HttpOnly`  | yes                                   | yes                             | **no** (must be readable by JS) |
| `SameSite`  | `Lax` (unconditional)                 | `Lax`                           | `Lax`                           |
| `Path`      | `/`                                   | `/api`                          | `/`                             |
| `Secure`    | production only                       | production only                 | production only                 |
| `Priority`  | High                                  | High                            | —                               |
| Name        | `__Host-app_session_id` in production | `__Host-app_session_id_refresh` | `__Host-app_session_id_csrf`    |
| Persistence | `Max-Age` only when remembered        | `Max-Age` only when remembered  | session                         |

Cookie attributes are derived from **server configuration only**. They were
previously derived from the request's `X-Forwarded-Proto`, which any client can
set — one header let an attacker force `SameSite=None; Secure` and suppress
CSRF protection. `SameSite` is now always `Lax`: the admin panel is same-origin
with its API and the storefront is public, so `None` is never required.

---

## 6. Rate limiting

State lives in `public.rate_limits`, so limits hold across restarts and across
every instance behind a load balancer.

| Counter                      | Budget                                 | Notes                                                         |
| ---------------------------- | -------------------------------------- | ------------------------------------------------------------- |
| `login:attempt:acct:<email>` | `AUTH_LOGIN_ATTEMPT_MAX` / 15 min      | every attempt                                                 |
| `login:attempt:ip:<ip>`      | 3x that                                | **skipped when the client IP is unknown**                     |
| `login:fail:acct:<email>`    | `AUTH_LOGIN_FAILURE_MAX` (10) / 15 min | wrong passwords only; **enforced** — exceeding it returns 429 |
| `login:fail:ip:<ip>`         | 2x that                                | skipped when the IP is unknown                                |

Only **failures** are counted strictly. The previous implementation counted
every attempt against a 10/15min budget, so ten _successful_ logins locked the
account out, and every caller without an `X-Forwarded-For` shared one bucket —
a global denial of service against the panel (reproduced live during this work).

`X-Forwarded-For` is honoured **only** when `TRUST_PROXY` is set. Otherwise a
client can mint unlimited fresh buckets by rotating the header.

After 3 failures a progressive delay applies (0.4s → 8s cap). A hard lockout is
deliberately avoided as the primary mechanism — a panel where only owners can
sign in has no second account able to undo a lockout.

---

## 7. Environment

All optional except `SESSION_SECRET` (required, ≥32 chars, no placeholders) and
the Supabase/DATABASE values. Production **fails to boot** on a missing/weak
secret, a missing database config, or a non-`https://` `APP_URL`.

```
AUTH_REMEMBER_DAYS=30          # persistent session length
AUTH_ACCESS_TOKEN_SEC=3600     # access token lifetime
AUTH_SESSION_HOURS=12          # ceiling for a non-remembered session
AUTH_IDLE_TIMEOUT_MIN=120        # dead session after this much inactivity
AUTH_REAUTH_WINDOW_MIN=15      # sensitive-action re-auth window
AUTH_CLEANUP_INTERVAL_MS=3600000
AUTH_LOGIN_ATTEMPT_MAX=30
AUTH_LOGIN_FAILURE_MAX=10
AUTH_LOGIN_WINDOW_MIN=15
TRUST_PROXY=false              # set true ONLY behind a proxy that overwrites
TRUST_PROXY_HOPS=1             #   X-Forwarded-For / -Proto
```

---

## 8. Operating it

```bash
# Preferred: the Supabase CLI, authenticated with a Personal Access Token.
export SUPABASE_ACCESS_TOKEN="$(cat ../starkupps-access-token-key.txt)"
npm run supabase:push            # supabase db push --linked
npm run supabase:migration:list  # confirm applied state

# Fallback when only DATABASE_URL is available (no CLI token):
npm run db:migrate -- supabase/migrations/<file>.sql

# Create/rotate an admin. No default password: omit it and one is generated
# and printed once.
npm run db:seed -- admin@starkupps.local "a-strong-passphrase" "Admin Name"

# Locked out? Clear the lockout and throttle buckets.
npm run auth:unlock -- admin@starkupps.local
npm run auth:unlock -- admin@starkupps.local --all   # + revoke every session

npm run verify   # lint -> typecheck -> test -> build
npm test         # 180 tests, incl. DB-backed session integration tests
```

Full setup, environment variables and deployment notes: see `README.md` and
`.env.example`.

### Cleanup

`cleanup_expired_sessions()` / `cleanup_expired_password_resets()` run from an
in-process janitor ~30s after boot and then hourly. The DELETE is idempotent,
so several instances may run it concurrently. Previously
`cleanupExpiredSessions()` existed but was never called and `sessions` grew
without bound.

### Revocation immediacy

Role, status, active-flag and outlet changes call `invalidateAuthMemo()` so a
demotion or suspension takes effect on the **next request** rather than after
the 30 s memo TTL. Other instances clear their own memo when they perform the
write; anything else falls back to the TTL.

### Known operational limits

- Revocation is read from the database but memoised per instance for 15s, so a
  device revoked elsewhere stops being honoured within that window. Logout is
  unaffected (the cookie is cleared immediately).
- A refresh lookup that cannot reach the database returns **503** and leaves the
  session intact. It must never be treated as "version 0", which would look
  like a mismatch and revoke the family.

---

## 9. Deliberately not done

Ordered by value, with the reasoning.

| Item                                               | Why not                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TOTP / MFA**                                     | Not built: it is a feature, not a hardening fix, and it changes the login flow, recovery path and session model. It is the single highest-value next step. When added, "remember" must not bypass it on first sign-in; a separate `trust this device` cookie with its own expiry is the right shape. |
| **Redis for rate limits / sessions**               | `public.rate_limits` and `public.sessions` already give correct cross-instance behaviour through Postgres. Redis would only cut latency. Worth it once login p99 matters.                                                                                                                            |
| **Full breached-password list (HIBP k-anonymity)** | The current denylist is ~30 stems matched as substrings after leet folding, so `P@ssw0rd2024` is caught. It will not catch an obscure password leaked last week. A network lookup on every password change needs an outage story and a privacy decision.                                             |
| **Dual-key `SESSION_SECRET` rotation**             | Rotating the secret currently logs everyone out. With a `kid` claim and a key ring, rotation could be zero-downtime.                                                                                                                                                                                 |
| **Foreign-key cleanup on `audit_log`**             | `actorUserId` is now nullable for pre-auth failures, which is correct, but old rows pointing at deleted users were never re-parented.                                                                                                                                                                |
| **Rate-limit the public menu read harder**         | Public reads are throttled generously (120/min per caller) because the storefront polls. A WAF or CDN in front is the right layer.                                                                                                                                                                   |
| **`supabase/config.toml` production values**       | Only local placeholders live in the repo; the hosted project's `site_url`, redirect URLs and MFA settings must be set in the dashboard.                                                                                                                                                              |

## 10. Environment-performance note

PostgREST was measured taking **5–50s** from this workstation against ~0.4s for
the same statement over the direct pooler. Consequences baked into the code:

- `server/_core/supabase.ts: warmDatabase()` opens the pool at boot, so the
  first request does not pay a cold start.
- `resolveUserFromRequest` bounds its PostgREST user lookup at 1.5s and falls
  through to the pooler. It previously had **no timeout at all**, so a slow
  response could stall every authenticated request.
- `auth.login` queries the account through the pooler first, because login is
  the request a human is waiting on.
- REST windows are short (`1500–2500ms`) so a stalled REST call is abandoned
  rather than waited out.

If login latency matters in production, prefer the pooler everywhere on the
auth path and add statement timeouts.
