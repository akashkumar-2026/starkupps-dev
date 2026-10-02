import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchFaqs, fetchReviews, fetchSiteSettings } from "@/api/public";
import { subscribeTable } from "@/api/realtime";
import { queryKeys } from "@/config/query-keys";
import { evaluateStoreStatus, summarizeWeek } from "@/utils/hours";

/**
 * Storefront business facts (contact, hours, hero, stats, trust, gallery).
 *
 * Lives in `public.site_settings` and is edited in Admin > Settings >
 * Storefront. These values were previously string literals inside this bundle,
 * which meant the panel could not correct them and the site asserted claims such
 * as "1,240 reviews" on every page load regardless of the database.
 *
 * Errors are not swallowed: a failed read surfaces the caller's error state so a
 * retry button can be shown rather than silently rendering something invented.
 */
export function useSiteSettings() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.site,
    queryFn: ({ signal }) => fetchSiteSettings(signal),
    // Owner edits are rare and the gateway sets a 30 s edge TTL; a short stale
    // window keeps navigation snappy without pinning stale contact details.
    staleTime: 60_000,
    retry: 2,
  });

  useSiteContentSubscription(queryClient);

  return query;
}

/**
 * Live-update storefront content when an owner saves it.
 *
 * `site_settings` is in the `supabase_realtime` publication, so one INSERT/UPDATE
 * row is enough. Invalidate rather than patch the cache: the payload is a single
 * row and a refetch of one row is cheaper than reasoning about partial state.
 */
export function useSiteContentSubscription(queryClient: ReturnType<typeof useQueryClient>) {
  const onChange = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.site });
    void queryClient.invalidateQueries({ queryKey: queryKeys.reviews });
  };
  const siteSettings = subscribeTable("site_settings", undefined, onChange);
  // Hours are edited in Admin > Outlets > Operating Hours, which writes
  // `outlet_hours`. Without this an owner who moves the opening time would not
  // see the storefront badge change.
  const outletHours = subscribeTable("outlet_hours", undefined, onChange);
  return () => {
    siteSettings?.();
    outletHours?.();
  };
}

/** Re-render on an interval so a time-driven badge cannot go stale on screen. */
const STATUS_TICK_MS = 30_000;

/**
 * Live open/closed status from the store's own weekly schedule.
 *
 * The schedule is the per-day timings from `outlet_hours` (Admin > Outlets >
 * Operating Hours) evaluated in the outlet's timezone, not the free-text
 * `hoursSummary` prose — which is why an owner changing the opening time sees it
 * here immediately. Ticks every 30s so a tab left open across the opening or
 * closing minute flips without a reload.
 */
export function useStoreStatus() {
  const { data: site } = useSiteSettings();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), STATUS_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const status = evaluateStoreStatus(site?.weeklyHours, now, site?.timezone);

  return {
    ...status,
    /** One-line week summary, e.g. "Every day · 10 AM – 10 PM". */
    weekSummary: summarizeWeek(site?.weeklyHours),
  };
}

/**
 * Customer reviews for the trust section, from `public.testimonials`.
 *
 * Same posture as the rest of the storefront data: no fallback to invented
 * reviews. When the table is empty the section renders an honest empty state.
 */
export function usePublicReviews() {
  return useQuery({
    queryKey: queryKeys.reviews,
    queryFn: ({ signal }) => fetchReviews(signal),
    staleTime: 5 * 60_000,
    retry: 2,
  });
}

/** Public, active FAQs from Admin > Content > FAQs. */
export function usePublicFaqs() {
  return useQuery({
    queryKey: queryKeys.faqs,
    queryFn: ({ signal }) => fetchFaqs(signal),
    staleTime: 60_000,
    retry: 2,
  });
}
