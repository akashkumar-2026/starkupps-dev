import { useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";

import { PageMeta } from "@/app/PageMeta";
import { Header } from "@/components/layout/Header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmailSignUpForm } from "@/features/auth/components/AuthForms";
import { useAuth } from "@/state";

export const Route = createFileRoute("/signup")({
  component: Signup,
});

function Signup() {
  const { configured, user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) void navigate({ to: "/account" });
  }, [loading, user, navigate]);

  return (
    <>
      <PageMeta
        title="Create account"
        description="Create a StarKupps account with your email and password."
      />

      <Header />
      <main className="shell max-w-md py-10 sm:py-14">
        <Card className="rounded-3xl shadow-card">
          <CardHeader className="text-center">
            <p className="eyebrow text-primary">Join StarKupps</p>
            <CardTitle className="font-display text-2xl">Create your account</CardTitle>
            <CardDescription>One account for dine-in, takeaway &amp; delivery.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {!loading && !configured ? (
              <Alert variant="destructive">
                <AlertDescription>
                  Sign-up isn&apos;t configured in this build — set VITE_SUPABASE_URL and
                  VITE_SUPABASE_ANON_KEY in your .env.local, then restart the dev server.
                </AlertDescription>
              </Alert>
            ) : null}
            <EmailSignUpForm />
            <p className="text-center text-xs text-muted-foreground">
              By continuing you agree to our Terms &amp; Privacy Policy.
            </p>
            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link
                to="/login"
                className="pressable -mx-1 inline-flex min-h-11 items-center rounded-lg px-1 font-semibold text-primary hover:underline"
              >
                Sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
