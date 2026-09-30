import { useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";

import { PageMeta } from "@/app/PageMeta";
import { Header } from "@/components/layout/Header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmailSignInForm } from "@/features/auth/components/AuthForms";
import { useAuth } from "@/state";

export const Route = createFileRoute("/login")({
  component: Login,
});

function Login() {
  const { configured, user, loading } = useAuth();
  const navigate = useNavigate();

  // Redirect after render — navigating during render is a side effect.
  useEffect(() => {
    if (!loading && user) void navigate({ to: "/account" });
  }, [loading, user, navigate]);

  return (
    <>
      <PageMeta title="Sign in" description="Sign in to StarKupps with your email and password." />

      <Header />
      <main className="mx-auto w-full max-w-md px-4 py-10">
        <Card className="rounded-3xl shadow-card">
          <CardHeader className="text-center">
            <p className="eyebrow text-primary">Welcome back</p>
            <CardTitle className="font-display text-2xl">Sign in to StarKupps</CardTitle>
            <CardDescription>Order faster, track pickups, save favourites.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {!loading && !configured ? (
              <Alert variant="destructive">
                <AlertDescription>
                  Sign-in isn&apos;t configured in this build — set VITE_SUPABASE_URL and
                  VITE_SUPABASE_ANON_KEY in your .env.local, then restart the dev server.
                </AlertDescription>
              </Alert>
            ) : null}
            <EmailSignInForm />
            <p className="text-center text-sm text-muted-foreground">
              New to StarKupps?{" "}
              <Link to="/signup" className="font-semibold text-primary hover:underline">
                Create an account
              </Link>
            </p>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
