import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { PageMeta } from "@/app/PageMeta";
import { getSupabaseClient } from "@/api/supabase";

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallback,
});

/**
 * Landing route for OAuth and magic-link returns.
 *
 * Supabase parses the callback automatically when `detectSessionInUrl` is on,
 * but the PKCE flow still needs an explicit code exchange to produce a session.
 */
function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const completeSignIn = async () => {
      const client = getSupabaseClient();
      if (!client) {
        setError("Authentication is not configured for this build.");
        return;
      }

      try {
        const code = new URLSearchParams(window.location.search).get("code");
        if (code) {
          const { error: exchangeError } = await client.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        } else {
          const { error: sessionError } = await client.auth.getSession();
          if (sessionError) throw sessionError;
        }

        // Drop the one-time code from the address bar so it is not re-sent on reload.
        window.history.replaceState({}, "", window.location.pathname);
        void navigate({ to: "/account" });
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : "Sign-in failed. Please try again.");
      }
    };

    void completeSignIn();
  }, [navigate]);

  return (
    <>
      <PageMeta title="Signing you in" noIndex />

      <main className="grid min-h-screen place-items-center px-4">
        <div className="text-center">
          {error ? (
            <>
              <p className="text-base font-semibold">Couldn&apos;t finish signing you in</p>
              <p className="mt-2 text-sm text-muted-foreground">{error}</p>
              <a
                href="/login"
                className="mt-6 inline-block rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground"
              >
                Back to sign in
              </a>
            </>
          ) : (
            <>
              <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">Finishing sign-in…</p>
            </>
          )}
        </div>
      </main>
    </>
  );
}
