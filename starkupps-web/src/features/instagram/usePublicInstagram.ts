import { useQuery } from "@tanstack/react-query";

import { fetchInstagram, fetchInstagramThumbnails } from "@/api/public";
import { queryKeys } from "@/config/query-keys";

/**
 * Storefront Instagram feed.
 *
 * This previously caught every failure and resolved to an empty feed, which made
 * an outage indistinguishable from "the owner hasn't posted anything" — the
 * section silently vanished and the only trace was a console warning.
 *
 * The error is now surfaced. `InstagramSection` decides how to present it: the
 * marquee stays hidden (it is editorial, not transactional), but a failed load
 * is reported rather than passed off as "nothing to show".
 */
export function usePublicInstagram() {
  return useQuery({
    queryKey: queryKeys.instagram,
    queryFn: ({ signal }) => fetchInstagram(signal),
    // Admin edits land inside a 60s window; matches the gateway's s-maxage.
    staleTime: 60_000,
    retry: 1,
  });
}

/** Resolve post/reel covers separately so media lookups never delay the feed. */
export function usePublicInstagramThumbnails(shortcodes: string[]) {
  return useQuery({
    queryKey: [...queryKeys.instagram, "thumbnails", ...shortcodes],
    queryFn: ({ signal }) => fetchInstagramThumbnails(shortcodes, signal),
    enabled: shortcodes.length > 0,
    staleTime: 30 * 60_000,
    retry: 1,
  });
}
