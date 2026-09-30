import { useCallback, useEffect, useMemo, useState } from "react";

import { createSavedAddress, getSavedAddresses, persistAddresses } from "./storage";
import type { SavedAddress } from "@/types/profile";

export type SaveAddressInput = Omit<SavedAddress, "id" | "createdAt" | "isDefault"> & {
  id?: string | undefined;
};

export type SavedAddresses = {
  addresses: SavedAddress[];
  /** The default address, or the first one when none is flagged. */
  defaultAddress: SavedAddress | null;
  save: (input: SaveAddressInput) => void;
  remove: (id: string) => void;
  setDefault: (id: string) => void;
};

/** Saved delivery addresses for the signed-in user. */
export function useSavedAddresses(userId: string | undefined): SavedAddresses {
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);

  // Switching users (or signing out) must not leak the previous user's list.
  useEffect(() => {
    setAddresses(getSavedAddresses(userId));
  }, [userId]);

  const commit = useCallback(
    (update: (previous: SavedAddress[]) => SavedAddress[]) => {
      setAddresses((previous) => {
        const next = update(previous);
        persistAddresses(userId, next);
        return next;
      });
    },
    [userId],
  );

  const save = useCallback(
    (input: SaveAddressInput) => {
      commit((previous) => {
        if (input.id) {
          return previous.map((address) =>
            address.id === input.id ? { ...address, ...input, id: address.id } : address,
          );
        }
        // The first address ever saved becomes the default.
        return [{ ...createSavedAddress(input), isDefault: previous.length === 0 }, ...previous];
      });
    },
    [commit],
  );

  const remove = useCallback(
    (id: string) => {
      commit((previous) => {
        const next = previous.filter((address) => address.id !== id);
        // Never leave the customer without a default.
        if (next.length > 0 && !next.some((address) => address.isDefault)) {
          next[0]!.isDefault = true;
        }
        return next;
      });
    },
    [commit],
  );

  const setDefault = useCallback(
    (id: string) => {
      commit((previous) =>
        previous.map((address) => ({ ...address, isDefault: address.id === id })),
      );
    },
    [commit],
  );

  const defaultAddress = useMemo(
    () => addresses.find((address) => address.isDefault) ?? addresses[0] ?? null,
    [addresses],
  );

  return { addresses, defaultAddress, save, remove, setDefault };
}
