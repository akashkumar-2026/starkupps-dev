/**
 * Global outlet (store) selection.
 *
 * The selected outlet scopes the menu, availability and charges, so it lives
 * above the router and persists across navigation. Realtime keeps it in sync
 * when Admin changes an outlet's status or services.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchOutlets } from "@/api/public";
import { subscribeTable } from "@/api/realtime";
import { queryKeys } from "@/config/query-keys";
import type { PublicOutlet } from "@/types/outlet";
import { readJson, removeKey, writeJson } from "@/utils/storage";

const STORAGE_KEY = "starkupps_outlet_id";

export type OutletContextValue = {
  outlets: PublicOutlet[];
  selected: PublicOutlet | null;
  selectedId: number | null;
  setSelectedId: (id: number | null) => void;
  isLoading: boolean;
  error: unknown;
};

const OutletContext = createContext<OutletContextValue | null>(null);

export function OutletProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedIdState] = useState<number | null>(() => {
    const stored = readJson<number | null>(STORAGE_KEY, null);
    return stored !== null && Number.isFinite(stored) && stored > 0 ? stored : null;
  });

  const query = useQuery({
    queryKey: queryKeys.outlets,
    queryFn: ({ signal }) => fetchOutlets(signal),
    staleTime: 15_000,
    gcTime: 600_000,
    retry: 2,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const outlets = useMemo(() => query.data ?? [], [query.data]);

  // Outlet open/close and new outlets propagate without a reload.
  useEffect(() => {
    const unsubscribe = subscribeTable("outlets", undefined, () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.outlets });
    });
    return () => unsubscribe?.();
  }, [queryClient]);

  const setSelectedId = useCallback((id: number | null) => {
    setSelectedIdState(id);
    if (id === null) removeKey(STORAGE_KEY);
    else writeJson(STORAGE_KEY, id);
  }, []);

  // Auto-select the first outlet, and recover if the selected one disappears.
  useEffect(() => {
    if (outlets.length === 0) return;
    const isKnown = selectedId !== null && outlets.some((outlet) => outlet.id === selectedId);
    if (!isKnown) setSelectedId(outlets[0]!.id);
  }, [outlets, selectedId, setSelectedId]);

  const value = useMemo<OutletContextValue>(
    () => ({
      outlets,
      selected: outlets.find((outlet) => outlet.id === selectedId) ?? null,
      selectedId,
      setSelectedId,
      isLoading: query.isLoading,
      error: query.error,
    }),
    [outlets, selectedId, setSelectedId, query.isLoading, query.error],
  );

  return <OutletContext.Provider value={value}>{children}</OutletContext.Provider>;
}

export function useOutlet(): OutletContextValue {
  const context = useContext(OutletContext);
  if (!context) throw new Error("useOutlet must be used within an OutletProvider");
  return context;
}
