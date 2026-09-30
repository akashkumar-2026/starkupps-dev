/**
 * Application-wide providers.
 *
 * Order matters: `OutletProvider` consumes the query client, `AuthProvider`
 * owns the session, and `CartProvider` needs neither but must sit inside the
 * root so the cart survives client-side navigation.
 */
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";

import { Toaster } from "@/components/ui/sonner";
import { queryClient } from "./query-client";
import { AuthProvider, CartProvider, OutletProvider } from "@/state";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <OutletProvider>
          <CartProvider>
            {children}
            <Toaster position="top-center" />
          </CartProvider>
        </OutletProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
