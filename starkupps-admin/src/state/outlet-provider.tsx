import { createContext, useContext, useEffect, useState } from "react";
import { trpc } from "@/api/trpc";

type OutletOption = { id: number; name: string; code: string; status: string };

type OutletCtx = {
  selectedId: number | null; // null = All Outlets
  setSelectedId: (id: number | null) => void;
  outlets: OutletOption[];
  label: string;
  isLoading: boolean;
};

const OutletContext = createContext<OutletCtx>({
  selectedId: null,
  setSelectedId: () => {},
  outlets: [],
  label: "All Outlets",
  isLoading: false,
});

export function OutletProvider({ children }: { children: React.ReactNode }) {
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    try {
      const v = localStorage.getItem("starkupps_outlet");
      if (!v || v === "all") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  });
  const q = trpc.outlets.list.useQuery({ limit: 100 }, { staleTime: 60_000 });
  const outlets: OutletOption[] = (q.data?.items ?? []).map(o => ({
    id: o.id,
    name: o.name,
    code: o.code,
    status: o.status,
  }));
  useEffect(() => {
    try {
      localStorage.setItem(
        "starkupps_outlet",
        selectedId ? String(selectedId) : "all"
      );
    } catch {}
  }, [selectedId]);
  // if selected no longer exists, reset
  useEffect(() => {
    if (selectedId && outlets.length && !outlets.find(o => o.id === selectedId))
      setSelectedId(null);
  }, [outlets, selectedId]);
  const label = selectedId
    ? (outlets.find(o => o.id === selectedId)?.name ?? `Outlet #${selectedId}`)
    : "All Outlets";
  return (
    <OutletContext.Provider
      value={{
        selectedId,
        setSelectedId,
        outlets,
        label,
        isLoading: q.isLoading,
      }}
    >
      {children}
    </OutletContext.Provider>
  );
}

export function useOutlet() {
  return useContext(OutletContext);
}
