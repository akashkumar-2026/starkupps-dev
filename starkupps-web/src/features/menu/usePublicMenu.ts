import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchMenu } from "@/api/public";
import { subscribeMenu } from "@/api/realtime";
import { queryKeys } from "@/config/query-keys";
import { useOutlet } from "@/state/outlet-provider";

/**
 * The live menu for the selected outlet.
 *
 * Loads over HTTP and stays in sync through a Supabase Realtime subscription, so
 * an edit in Admin appears without a reload. Realtime is optional — if it is
 * unavailable the query still refetches on window focus and reconnect.
 */
export function usePublicMenu() {
  const { selectedId } = useOutlet();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.menu(selectedId),
    queryFn: ({ signal }) => fetchMenu(selectedId, signal),
    staleTime: 10_000,
    retry: 2,
  });

  useEffect(() => {
    const unsubscribe = subscribeMenu(selectedId, () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.menu(selectedId) });
    });
    return () => unsubscribe?.();
  }, [selectedId, queryClient]);

  return query;
}
