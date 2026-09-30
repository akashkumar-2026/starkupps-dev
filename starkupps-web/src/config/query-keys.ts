/**
 * Centralised React Query cache keys.
 *
 * Realtime subscriptions and cross-component invalidations depend on these
 * prefixes, so keys are built here rather than inline at each call site.
 */

export const queryKeys = {
  outlets: ["public", "outlets"] as const,
  menu: (outletId: number | null) => ["public", "menu", outletId] as const,
  /** Matches every menu variant, for bulk invalidation. */
  allMenus: ["public", "menu"] as const,
  instagram: ["public", "instagram"] as const,
} as const;
