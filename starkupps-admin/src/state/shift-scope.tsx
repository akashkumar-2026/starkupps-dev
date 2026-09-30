import { createContext, useContext } from "react";

export type ShiftScope = {
  /** `undefined` means "all shifts". */
  shiftId: number | undefined;
  label: string;
  select: (shiftId: number | undefined) => void;
};

const ShiftScopeContext = createContext<ShiftScope>({
  shiftId: undefined,
  label: "All shifts",
  select: () => undefined,
});

export const ShiftScopeProvider = ShiftScopeContext.Provider;

/**
 * The shift currently scoped to by the admin shell. Views that aggregate across
 * a whole day (overview, orders, analytics) read it so every panel agrees on
 * one filter.
 */
export function useShiftScope(): ShiftScope {
  return useContext(ShiftScopeContext);
}
