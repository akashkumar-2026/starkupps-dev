import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import ErrorBoundary from "@/components/ErrorBoundary";
import { ThemeProvider } from "@/state/theme-provider";

import { AppRoutes } from "./routes";

/**
 * Root of the browser tree: global error containment, theme, tooltip and toast
 * providers. Data and auth providers are mounted once in `main.tsx` because the
 * tRPC client they need is created there.
 */
export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <AppRoutes />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
