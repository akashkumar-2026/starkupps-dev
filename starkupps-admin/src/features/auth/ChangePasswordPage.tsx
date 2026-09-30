import { useState } from "react";
import { Link } from "wouter";
import { Eye, EyeOff, Loader2, CheckCircle2, ArrowLeft } from "lucide-react";
import { trpc } from "@/api/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ChangePasswordPage() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const mut = trpc.auth.changePassword.useMutation({
    onSuccess: () => {
      setDone(true);
      setError(null);
    },
    onError: e => setError(e.message || "Unable to change password."),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!current) {
      setError("Enter your current password.");
      return;
    }
    if (next.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (next === current) {
      setError("New password must differ from current.");
      return;
    }
    if (next !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    mut.mutate({
      currentPassword: current,
      newPassword: next,
      confirmPassword: confirm,
    });
  };

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F4F0E9] p-6">
        <div className="w-full max-w-md rounded-2xl border border-[#D8CDC0] bg-[#FCFAF6] p-8 text-center shadow-[0_14px_35px_rgba(55,38,25,0.06)]">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#E5F2E9] text-[#2F6947]">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <h1 className="mt-4 text-lg font-extrabold text-[#211B18]">
            Password changed
          </h1>
          <p className="mt-2 text-sm text-[#776A5E]">
            Your password was updated. Existing sessions on other devices were
            revoked.
          </p>
          <Link href="/overview">
            <Button className="mt-6 w-full bg-[#211B18] text-white">
              Back to overview
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F4F0E9] p-6">
      <div className="w-full max-w-md rounded-2xl border border-[#D8CDC0] bg-[#FCFAF6] p-8 shadow-[0_14px_35px_rgba(55,38,25,0.06)]">
        <Link
          href="/overview"
          className="inline-flex items-center gap-1 text-xs font-semibold text-[#8E8174] hover:text-[#211B18]"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Link>
        <h1 className="mt-6 text-2xl font-extrabold tracking-[-0.04em] text-[#211B18]">
          Change password
        </h1>
        <p className="mt-2 text-sm text-[#776A5E]">
          Signed-in users can rotate their password. You’ll stay signed in;
          other sessions are revoked.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="current" className="text-xs font-bold">
              Current password
            </Label>
            <div className="relative">
              <Input
                id="current"
                type={show ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Current password"
                value={current}
                onChange={e => setCurrent(e.target.value)}
                className="h-11 border-[#DCCFC2] bg-white pr-10"
                disabled={mut.isPending}
              />
              <button
                type="button"
                onClick={() => setShow(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8E8174]"
                aria-label={show ? "Hide" : "Show"}
              >
                {show ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="next" className="text-xs font-bold">
              New password
            </Label>
            <Input
              id="next"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={next}
              onChange={e => setNext(e.target.value)}
              className="h-11 border-[#DCCFC2] bg-white"
              disabled={mut.isPending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm" className="text-xs font-bold">
              Confirm new password
            </Label>
            <Input
              id="confirm"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              placeholder="Confirm"
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
              "Update password"
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
