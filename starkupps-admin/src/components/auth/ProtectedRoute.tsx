import { DashboardLayoutSkeleton } from "@/components/shared/DashboardLayoutSkeleton";
import { useAuth } from "@/state";
import { Loader2 } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { useLocation } from "wouter";

function isSafeReturnTo(path: string): boolean {
  try {
    let decoded = path;
    for (let i = 0; i < 3; i++) {
      try {
        const n = decodeURIComponent(decoded);
        if (n === decoded) break;
        decoded = n;
      } catch {
        break;
      }
    }
    if (!decoded.startsWith("/")) return false;
    if (decoded.startsWith("//")) return false;
    if (decoded.includes("://")) return false;
    if (decoded.startsWith("/auth/")) return false;
    if (decoded.includes("\\") || decoded.toLowerCase().includes("%5c"))
      return false;
    const u = new URL(decoded, "http://localhost");
    if (u.host !== "localhost") return false;
    if (u.pathname.includes("\\")) return false;
    return true;
  } catch {
    return false;
  }
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { loading, isAuthenticated, isAuthorized } = useAuth();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) {
      const returnTo = isSafeReturnTo(location)
        ? `?returnTo=${encodeURIComponent(location)}`
        : "";
      // Use replace to avoid pushing auth redirect into history (prevents back-button loop)
      setLocation(`/auth/login${returnTo}`, { replace: true });
    } else if (!isAuthorized) {
      setLocation("/403", { replace: true });
    }
  }, [loading, isAuthenticated, isAuthorized, location, setLocation]);

  if (loading) {
    return <DashboardLayoutSkeleton />;
  }

  // While redirect is pending, render nothing to avoid flashing a second spinner
  // Previously returned a second <Loader2> which caused mount/unmount flicker before setLocation took effect
  if (!isAuthenticated || !isAuthorized) {
    return null;
  }

  return <>{children}</>;
}

export function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const { loading, isAuthenticated, isAuthorized } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (loading) return;
    if (isAuthenticated && isAuthorized) {
      const params = new URLSearchParams(window.location.search);
      const rt = params.get("returnTo");
      const dest = rt && isSafeReturnTo(rt) ? rt : "/overview";
      setLocation(dest, { replace: true });
    }
  }, [loading, isAuthenticated, isAuthorized, setLocation]);

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#F4F0E9]">
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-[#E2533C]" />
      </div>
    );
  }

  // Authenticated users are redirected away; render nothing while redirect pending to avoid spinner flash
  if (isAuthenticated && isAuthorized) {
    return null;
  }

  return <>{children}</>;
}
