import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Loader2, MailCheck } from "lucide-react";
import { trpc } from "@/api/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mut = trpc.auth.forgotPassword.useMutation({
    onSuccess: () => setSubmitted(true),
    onError: e =>
      setError(e.message || "Unable to process request. Please try again."),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const v = email.trim().toLowerCase();
    if (!v || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      setError("Please enter a valid email address.");
      return;
    }
    mut.mutate({ email: v });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F4F0E9] p-6">
      <div className="w-full max-w-md rounded-2xl border border-[#D8CDC0] bg-[#FCFAF6] p-8 shadow-[0_14px_35px_rgba(55,38,25,0.06)]">
        <Link
          href="/auth/login"
          className="inline-flex items-center gap-1 text-xs font-semibold text-[#8E8174] hover:text-[#211B18]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to sign in
        </Link>

        {!submitted ? (
          <>
            <h1 className="mt-6 text-2xl font-extrabold tracking-[-0.04em] text-[#211B18]">
              Forgot password?
            </h1>
            <p className="mt-2 text-sm leading-5 text-[#776A5E]">
              Enter your email and we will send reset instructions if an account
              exists.
            </p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
              <div className="space-y-2">
                <Label
                  htmlFor="email"
                  className="text-xs font-bold text-[#211B18]"
                >
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
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
                className="h-11 w-full rounded-xl bg-[#211B18] text-sm font-bold text-white hover:bg-[#3A2D27]"
              >
                {mut.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Sending...
                  </>
                ) : (
                  "Send Reset Link"
                )}
              </Button>
            </form>
          </>
        ) : (
          <div className="mt-6 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#E5F2E9] text-[#2F6947]">
              <MailCheck className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-lg font-extrabold text-[#211B18]">
              Check your email
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#776A5E]">
              If an account exists for{" "}
              <span className="font-semibold text-[#211B18]">{email}</span>, you
              will receive password reset instructions.
            </p>
            <Link href="/auth/login">
              <Button
                variant="outline"
                className="mt-6 w-full border-[#D8CDC0]"
              >
                Back to sign in
              </Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
