import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { Eye, EyeOff, Loader2, CheckCircle2 } from "lucide-react";
import { trpc } from "@/api/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ResetPasswordPage() {
  const [, setLocation] = useLocation();
  const token = useMemo(
    () => new URLSearchParams(window.location.search).get("token") || "",
    []
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const mut = trpc.auth.resetPassword.useMutation({
    onSuccess: () => setDone(true),
    onError: e =>
      setError(e.message || "Unable to reset password. Please try again."),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError("Missing reset token. Please use the link from your email.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    mut.mutate({ token, password, confirmPassword: confirm });
  };

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F4F0E9] p-6">
        <div className="w-full max-w-md rounded-2xl border border-[#F1C9BD] bg-[#FFF8F5] p-8 text-center">
          <h1 className="text-lg font-extrabold text-[#6D3025]">
            Invalid reset link
          </h1>
          <p className="mt-2 text-sm leading-5 text-[#8D5145]">
            This password reset link is invalid or has expired. Please request a
            new one.
          </p>
          <Link href="/auth/forgot-password">
            <Button className="mt-6 w-full bg-[#211B18] text-white">
              Request new link
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F4F0E9] p-6">
        <div className="w-full max-w-md rounded-2xl border border-[#D8CDC0] bg-[#FCFAF6] p-8 text-center shadow-[0_14px_35px_rgba(55,38,25,0.06)]">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#E5F2E9] text-[#2F6947]">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <h1 className="mt-4 text-lg font-extrabold text-[#211B18]">
            Password updated
          </h1>
          <p className="mt-2 text-sm text-[#776A5E]">
            Your password has been reset. You can now sign in with your new
            password.
          </p>
          <Button
            onClick={() => setLocation("/auth/login")}
            className="mt-6 w-full bg-[#211B18] text-white"
          >
            Go to sign in
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F4F0E9] p-6">
      <div className="w-full max-w-md rounded-2xl border border-[#D8CDC0] bg-[#FCFAF6] p-8 shadow-[0_14px_35px_rgba(55,38,25,0.06)]">
        <h1 className="text-2xl font-extrabold tracking-[-0.04em] text-[#211B18]">
          Set new password
        </h1>
        <p className="mt-2 text-sm text-[#776A5E]">
          Choose a strong password for your account.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="password" className="text-xs font-bold">
              New password
            </Label>
            <div className="relative">
              <Input
                id="password"
                type={show ? "text" : "password"}
                autoComplete="new-password"
                placeholder="At least 8 characters"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="h-11 border-[#DCCFC2] bg-white pr-10"
                disabled={mut.isPending}
              />
              <button
                type="button"
                onClick={() => setShow(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8E8174]"
                aria-label={show ? "Hide" : "Show"}
              >
                <span>
                  {show ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </span>
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm" className="text-xs font-bold">
              Confirm password
            </Label>
            <Input
              id="confirm"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              placeholder="Confirm your password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              className="h-11 border-[#DCCFC2] bg-white"
              disabled={mut.isPending}
            />
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-[#F1C9BD] bg-[#FFF8F5] px-4 py-3 text-sm text-[#8D5145]"
            >
              {error}
            </div>
          )}

          <Button
            type="submit"
            disabled={mut.isPending}
            className="h-11 w-full rounded-xl bg-[#211B18] text-sm font-bold text-white"
          >
            {mut.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Updating...
              </>
            ) : (
              "Update Password"
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
