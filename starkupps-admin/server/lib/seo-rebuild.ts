/**
 * Storefront rebuild trigger (SEO freshness).
 *
 * The public site is prerendered at build time (`starkupps-web/scripts/
 * prerender.mjs`), so menu, price, hours or copy edits made here stay stale
 * until the next Vercel build. This module POSTs the Vercel Deploy Hook after
 * a storefront-visible mutation, closing that freshness gap.
 *
 * Design (fail-open, by intent):
 * - `SEO_REBUILD_HOOK_URL` unset ⇒ every call is a no-op. Local dev and
 *   review builds never phone home.
 * - Calls are debounced trailing-edge (60 s): a burst of category/item saves
 *   coalesces into ONE build. Vercel also dedupes rapid hook calls.
 * - Hook failures only `console.warn` — an SEO rebuild must never fail an
 *   order, a menu save, or any other admin mutation.
 * - Which mutations fire is an explicit allowlist (`isStorefrontMutation`),
 *   enforced at the single choke point `protectedProcedure` in
 *   `server/lib/trpc.ts`. Order/inventory/auth writes never match, so the
 *   lunch rush cannot rebuild the site. When a NEW storefront-visible
 *   mutation is added, add its tRPC path here (covered by unit test below).
 */
import { ENV } from "../config/env";

const DEBOUNCE_MS = 60_000;
const HOOK_TIMEOUT_MS = 8_000;

let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let pendingReason = "";

/**
 * tRPC procedure paths (prefix match) whose writes change prerendered HTML.
 * Paths look like `admin.menu.update`, `outlets.hours.save`.
 */
const STOREFRONT_MUTATION_PREFIXES = [
  "siteContent.save",
  "admin.menu.",
  "content.faqs.",
  "content.testimonials.",
  "instagram.posts.",
  "instagram.settings.",
  "outlets.create",
  "outlets.update",
  "outlets.updateServices",
  "outlets.setStatus",
  "outlets.hours.",
  "outlets.menuAvailability.",
] as const;

export function isStorefrontMutation(path: string): boolean {
  return STOREFRONT_MUTATION_PREFIXES.some(prefix => path.startsWith(prefix));
}

/** Fire-and-forget: queue a storefront rebuild. Never throws. */
export function triggerStorefrontRebuild(reason: string): void {
  const hookUrl = ENV.seoRebuildHookUrl;
  if (!hookUrl) return;
  pendingReason = reason;
  if (pendingTimer) return; // A build is already queued; latest reason wins.
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    const url = ENV.seoRebuildHookUrl;
    if (!url) return;
    fetch(url, { method: "POST", signal: AbortSignal.timeout(HOOK_TIMEOUT_MS) })
      .then(res => {
        if (!res.ok)
          console.warn(
            `[seo-rebuild] deploy hook HTTP ${res.status} (reason: ${pendingReason})`
          );
      })
      .catch((err: unknown) => {
        console.warn(
          `[seo-rebuild] deploy hook failed (reason: ${pendingReason}):`,
          err instanceof Error ? err.message : err
        );
      });
  }, DEBOUNCE_MS);
  // A queued rebuild must not keep the process alive on its own.
  pendingTimer.unref?.();
}
