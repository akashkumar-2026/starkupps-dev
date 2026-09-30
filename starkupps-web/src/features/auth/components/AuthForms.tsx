import { useId, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, KeyRound, Loader2, Mail, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { checkPassword, friendlyAuthError, isValidEmail } from "@/features/auth/validation";
import { useAuth } from "@/state";
import { toast } from "sonner";

function errorToast(err: unknown) {
  toast.error(friendlyAuthError(err));
}

export function EmailSignInForm({ onSuccess }: { onSuccess?: () => void }) {
  const { signInWithEmail, resetPasswordForEmail } = useAuth();
  const navigate = useNavigate();
  const uid = useId();
  const [view, setView] = useState<"signin" | "forgot" | "sent">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const done = () => {
    if (onSuccess) onSuccess();
    else navigate({ to: "/account" });
  };

  if (view === "sent") {
    return (
      <div className="rounded-2xl border border-border bg-muted/40 p-5 text-center">
        <MailCheck className="mx-auto size-8 text-primary" />
        <p className="mt-2 text-sm font-semibold">Reset link sent</p>
        <p className="mt-1 text-sm text-muted-foreground">
          If an account exists for <span className="font-medium text-foreground">{email}</span>,
          you'll get a password-reset email shortly.
        </p>
        <Button
          variant="outline"
          className="mt-4 h-10 rounded-xl"
          onClick={() => setView("signin")}
        >
          Back to sign in
        </Button>
      </div>
    );
  }

  if (view === "forgot") {
    return (
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!isValidEmail(email)) {
            toast.error("Enter a valid email address");
            return;
          }
          setBusy(true);
          try {
            await resetPasswordForEmail(email);
            setView("sent");
          } catch (err: unknown) {
            errorToast(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="space-y-2">
          <Label htmlFor={`${uid}-reset-email`}>Email</Label>
          <Input
            id={`${uid}-reset-email`}
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-11 rounded-xl"
          />
          <p className="text-xs text-muted-foreground">
            We'll email you a secure link to set a new password.
          </p>
        </div>
        <Button type="submit" disabled={busy} className="h-11 w-full rounded-xl font-semibold">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
          Send reset link
        </Button>
        <button
          type="button"
          onClick={() => setView("signin")}
          className="mx-auto flex min-h-9 items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
        >
          <ArrowLeft className="size-4" />
          Back to sign in
        </button>
      </form>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!isValidEmail(email)) {
          toast.error("Enter a valid email address");
          return;
        }
        if (!password) {
          toast.error("Enter your password");
          return;
        }
        setBusy(true);
        try {
          await signInWithEmail({ email, password });
          toast.success("Welcome back!");
          done();
        } catch (err: unknown) {
          errorToast(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="space-y-2">
        <Label htmlFor={`${uid}-email`}>Email</Label>
        <Input
          id={`${uid}-email`}
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-11 rounded-xl"
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor={`${uid}-password`}>Password</Label>
          <button
            type="button"
            onClick={() => setView("forgot")}
            className="min-h-9 px-1 text-xs font-semibold text-primary hover:underline"
          >
            Forgot password?
          </button>
        </div>
        <Input
          id={`${uid}-password`}
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-11 rounded-xl"
        />
      </div>
      <Button type="submit" disabled={busy} className="h-11 w-full rounded-xl font-semibold">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
        Sign in with email
      </Button>
    </form>
  );
}

export function EmailSignUpForm({
  onSuccess,
  onSwitchToLogin,
}: {
  onSuccess?: () => void;
  onSwitchToLogin?: () => void;
}) {
  const { signUpWithEmail } = useAuth();
  const navigate = useNavigate();
  const uid = useId();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <div className="rounded-2xl border border-border bg-muted/40 p-5 text-center">
        <MailCheck className="mx-auto size-8 text-primary" />
        <p className="mt-2 text-sm font-semibold">Check your inbox</p>
        <p className="mt-1 text-sm text-muted-foreground">
          We sent a confirmation link to{" "}
          <span className="font-medium text-foreground">{email}</span>. Click it, then sign in.
        </p>
        <Button
          variant="outline"
          className="mt-4 h-10 rounded-xl"
          onClick={() => {
            if (onSwitchToLogin) onSwitchToLogin();
            else navigate({ to: "/login" });
          }}
        >
          Go to sign in
        </Button>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (name.trim().length < 2) {
          toast.error("Enter your name");
          return;
        }
        if (!isValidEmail(email)) {
          toast.error("Enter a valid email address");
          return;
        }
        const pw = checkPassword(password);
        if (!pw.ok) {
          toast.error(pw.reason ?? "Password too weak");
          return;
        }
        setBusy(true);
        try {
          const { needsVerification } = await signUpWithEmail({ name, email, password });
          if (needsVerification) {
            setSent(true);
            toast.success("Account created — verify your email");
          } else {
            toast.success("Account created — welcome!");
            if (onSuccess) onSuccess();
            else navigate({ to: "/account" });
          }
        } catch (err: unknown) {
          errorToast(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="space-y-2">
        <Label htmlFor={`${uid}-name`}>Full name</Label>
        <Input
          id={`${uid}-name`}
          autoComplete="name"
          placeholder="Aarav Kumar"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-11 rounded-xl"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${uid}-email`}>Email</Label>
        <Input
          id={`${uid}-email`}
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-11 rounded-xl"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${uid}-password`}>Password</Label>
        <Input
          id={`${uid}-password`}
          type="password"
          autoComplete="new-password"
          placeholder="Min. 8 characters, letters + numbers"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-11 rounded-xl"
        />
        <p className="text-xs text-muted-foreground">
          At least 8 characters with letters and numbers.
        </p>
      </div>
      <Button type="submit" disabled={busy} className="h-11 w-full rounded-xl font-semibold">
        {busy && <Loader2 className="size-4 animate-spin" />}
        Create account
      </Button>
    </form>
  );
}
