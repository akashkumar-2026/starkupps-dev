import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { KeyRound, Loader2, MailCheck } from "lucide-react";
import { toast } from "sonner";

import { PageMeta } from "@/app/PageMeta";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSupabaseClient } from "@/api/supabase";
import { checkPassword, friendlyAuthError } from "@/features/auth/validation";
import { useAuth } from "@/state";

export const Route = createFileRoute("/auth/update-password")({
  component: UpdatePassword,
});

function UpdatePassword() {
  const { user, loading, updatePassword } = useAuth();
  const navigate = useNavigate();
  const [exchanging, setExchanging] = useState(true);
  const [failed, setFailed] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // Recovery links carry ?code= (PKCE) — exchange it for a session first.
  useEffect(() => {
    const exchangeCode = async () => {
      const client = getSupabaseClient();
      if (!client) {
        setFailed(true);
        return;
      }

      try {
        const code = new URLSearchParams(window.location.search).get("code");
        if (code) {
          const { error } = await client.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else {
          // Implicit-flow links are picked up automatically; give it a beat.
          await client.auth.getSession();
        }
        window.history.replaceState({}, "", window.location.pathname);
      } catch {
        setFailed(true);
      } finally {
        setExchanging(false);
      }
    };

    void exchangeCode();
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    const passwordCheck = checkPassword(password);
    if (!passwordCheck.ok) {
      toast.error(passwordCheck.reason ?? "Password too weak");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords don't match");
      return;
    }

    setBusy(true);
    try {
      await updatePassword(password);
      setDone(true);
      toast.success("Password updated — you're signed in");
      setTimeout(() => void navigate({ to: "/account" }), 1200);
    } catch (error: unknown) {
      toast.error(friendlyAuthError(error));
    } finally {
      setBusy(false);
    }
  };

  const verified = !loading && !exchanging && !failed && user;

  return (
    <>
      <PageMeta title="Set a new password" noIndex />

      <Header />
      <main className="mx-auto w-full max-w-md px-4 py-10">
        <Card className="rounded-3xl shadow-card">
          <CardHeader className="text-center">
            <p className="eyebrow text-primary">Password reset</p>
            <CardTitle className="font-display text-2xl">Set a new password</CardTitle>
            <CardDescription>Choose something strong you haven&apos;t used before.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading || exchanging ? (
              <div className="grid place-items-center gap-3 py-8">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Verifying your reset link…</p>
              </div>
            ) : failed || !user ? (
              <div className="rounded-2xl border border-border bg-muted/40 p-5 text-center">
                <p className="text-sm font-semibold">This link isn&apos;t valid anymore</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Reset links expire after one use. Request a fresh one from the sign-in form.
                </p>
                <Button asChild className="mt-4 h-10 rounded-xl">
                  <Link to="/login">Back to sign in</Link>
                </Button>
              </div>
            ) : done ? (
              <div className="rounded-2xl border border-border bg-muted/40 p-5 text-center">
                <MailCheck className="mx-auto size-8 text-primary" />
                <p className="mt-2 text-sm font-semibold">Password updated</p>
                <p className="mt-1 text-sm text-muted-foreground">Taking you to your dashboard…</p>
              </div>
            ) : (
              verified && (
                <form className="space-y-4" onSubmit={handleSubmit}>
                  <div className="space-y-2">
                    <Label htmlFor="new-password">New password</Label>
                    <Input
                      id="new-password"
                      type="password"
                      autoComplete="new-password"
                      placeholder="Min. 8 characters, letters + numbers"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="h-11 rounded-xl"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirm-password">Confirm password</Label>
                    <Input
                      id="confirm-password"
                      type="password"
                      autoComplete="new-password"
                      placeholder="Repeat the new password"
                      value={confirm}
                      onChange={(event) => setConfirm(event.target.value)}
                      className="h-11 rounded-xl"
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={busy}
                    className="h-11 w-full rounded-xl font-semibold"
                  >
                    {busy ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <KeyRound className="size-4" />
                    )}
                    Update password
                  </Button>
                </form>
              )
            )}
          </CardContent>
        </Card>
      </main>
    </>
  );
}
