import { useQuery } from "@tanstack/react-query";

import { fetchInstagram } from "@/api/public";
import { queryKeys } from "@/config/query-keys";
import type { PublicInstagramFeed } from "@/types/instagram";

/** Shown while loading, when disabled, when empty, and when the API is down. */
const EMPTY_FEED: PublicInstagramFeed = { settings: null, posts: [], durationSeconds: 0 };

/**
 * Storefront Instagram feed.
 *
 * Unlike the menu, a failure here resolves to an *empty* feed rather than an
 * error. The menu is transactional — a customer must never be told the kitchen
 * is closed when it is not. Instagram is editorial: when the API is unreachable
 * the right behaviour is to drop the section entirely.
 */
export function usePublicInstagram() {
  return useQuery({
    queryKey: queryKeys.instagram,
    queryFn: async ({ signal }) => {
      try {
        return await fetchInstagram(signal);
      } catch (error) {
        console.warn("[instagram] feed unavailable, hiding section:", error);
        return EMPTY_FEED;
      }
    },
    // Admin edits land inside a 60s window; matches the gateway's s-maxage.
    staleTime: 60_000,
    retry: 1,
  });
}
