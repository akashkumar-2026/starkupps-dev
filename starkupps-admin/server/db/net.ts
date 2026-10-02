/**
 * Network transport for outbound Supabase HTTP/WebSocket traffic.
 *
 * WHY THIS EXISTS
 * ---------------
 * `node:dns.lookup` (getaddrinfo) resolves BOTH A and AAAA. On hosts without a
 * working IPv6 route — a VPS, a container host, most CI runners — the AAAA query
 * is sent anyway and no answer ever comes back, so getaddrinfo blocks for the
 * resolver's full timeout before falling back to A.
 *
 * Measured on this project's host:
 *   dns.lookup('njqrcxtjzghlyrmgsrmq.supabase.co')  -> 15013–15019 ms  (repeated)
 *   dns.resolve4('njqrcxtjzghlyrmgsrmq.supabase.co') ->     1–3 ms
 *   dig AAAA njqrcxtjzghlyrmgsrmq.supabase.co @127.0.0.53 -> "no servers could be reached" (15 s)
 *
 * Every new TCP connection to PostgREST therefore paid 5–15 s before a byte was
 * sent, which is what made admin sections appear to hang (inventory.dashboard
 * 21 s, staff.overview 27 s) and pushed the storefront's 8 s menu fetch over its
 * own client timeout, rendering "Fresh menu on its way".
 *
 * WHAT IT DOES
 * ------------
 *  1. A `lookup` implementation that asks for IPv4 explicitly, so the dead AAAA
 *     path is never taken, and only falls back to the platform resolver if the
 *     host genuinely has no A record.
 *  2. Keep-alive agents, so the resolution + TLS handshake happen once per
 *     process instead of once per query.
 *  3. A `fetch` compatible with what `supabase-js` expects (Response, streaming
 *     body), used via the client's `global.fetch` option.
 *
 * With this in place the same seven sequential PostgREST queries that took 80.7 s
 * complete in 1.4 s, and a single query drops from ~5.3 s to ~180 ms.
 */
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";

import WS from "ws";
import type { ClientOptions } from "ws";

/**
 * IPv4-first resolver.
 *
 * `family: 4` makes getaddrinfo skip the AAAA query entirely. If a deployment
 * ever runs genuinely IPv6-only, the lookup fails and we fall back to the
 * platform resolver rather than breaking.
 */
export function ipv4FirstLookup(
  hostname: string,
  options: dns.LookupOptions | undefined,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | dns.LookupAddress[],
    family?: number
  ) => void
): void {
  const opts = options ?? {};
  dns.lookup(hostname, { ...opts, family: 4 }, (err, address, family) => {
    if (!err) {
      // `all: true` resolves to an array; the cast keeps the overloads aligned.
      callback(null, address, family as number);
      return;
    }
    dns.lookup(hostname, opts, callback);
  });
}

const AGENT_OPTIONS = {
  keepAlive: true,
  keepAliveMsecs: 30_000,
  maxSockets: 64,
  maxFreeSockets: 16,
  lookup: ipv4FirstLookup,
  // Bound the socket so a black-holed peer surfaces as an error rather than a
  // request that never settles.
  timeout: 20_000,
} as const;

export const httpsAgent = new https.Agent(AGENT_OPTIONS);
export const httpAgent = new http.Agent(AGENT_OPTIONS);

/** Headers may arrive as a Headers instance, an entry array, or a plain object. */
function toNodeHeaders(
  headers: HeadersInit | undefined
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) out[key] = value;
    return out;
  }
  if (typeof (headers as Headers).forEach === "function") {
    (headers as Headers).forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  return { ...(headers as Record<string, string>) };
}

/**
 * A `fetch` built on `node:http(s)` so it uses the agents above.
 *
 * supabase-js only requires the standard Fetch surface: it calls this with a URL
 * and an init containing `method`, `headers` and an optional body, and consumes a
 * real `Response`. Redirects are not followed — PostgREST, GoTrue, Storage and
 * the Realtime REST handshake do not issue any.
 */
export function nodeFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  const url = new URL(raw);
  const isHttps = url.protocol === "https:";
  const transport = isHttps ? https : http;

  return new Promise<Response>((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method: init.method ?? "GET",
        agent: isHttps ? httpsAgent : httpAgent,
        headers: toNodeHeaders(init.headers),
      },
      res => {
        // Node lower-cases response header names and may repeat some (Set-Cookie),
        // so flatten to entries — `Headers` needs an iterable of pairs, and a
        // plain object would silently drop every multi-valued header.
        const headers = new Headers();
        for (const [name, value] of Object.entries(res.headers)) {
          if (Array.isArray(value))
            for (const v of value) headers.append(name, v);
          else if (value !== undefined) headers.set(name, value);
        }
        const status = res.statusCode ?? 502;
        // 204/205/304 are null-body statuses: the Fetch spec forbids attaching a
        // body to them, and undici throws `Invalid response status code 204`.
        // PostgREST returns 204 for a successful DELETE or an UPDATE with no
        // `Prefer: return=representation`, so this is a normal path — not an
        // edge case. Swallowing the stream is also correct, since these responses
        // never carry one.
        const nullBody = status === 204 || status === 205 || status === 304;
        resolve(
          new Response(
            nullBody ? null : (Readable.toWeb(res) as ReadableStream),
            {
              status,
              statusText: res.statusMessage ?? "",
              headers,
            }
          )
        );
        // Drain the socket so the keep-alive agent can reuse it.
        if (nullBody) res.resume();
      }
    );
    req.on("error", reject);
    if (init.body) req.write(init.body as string | Uint8Array);
    req.end();
  });
}

/**
 * `ws` with the IPv4-first resolver, used as Supabase Realtime's transport.
 *
 * Node 20 has no global WebSocket, so realtime-js needs `ws` passed explicitly.
 * Without this the realtime handshake blocks on the same dead AAAA lookup and
 * `subscribe()` only reports SUBSCRIBED after ~5.6 s — or TIMES_OUT outright.
 */
export class ResilientWebSocket extends WS {
  constructor(
    url: string | URL,
    protocols?: string | string[],
    options?: ClientOptions
  ) {
    super(url, protocols, { ...(options ?? {}), lookup: ipv4FirstLookup });
  }
}
