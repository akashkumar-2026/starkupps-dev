import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { trpc } from "@/api/trpc";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/state/auth-provider";
import {
  AUTH_REQUIRED_MSG,
  GENERIC_AUTH_MSG,
  RATE_LIMIT_MSG,
  SUSPENDED_MSG,
  UNAUTHORIZED_MSG,
} from "@shared/const";

const LAST_EMAIL_KEY = "starkupps:lastEmail";
// Fallback until the server reports the configured value; matches the default
// of AUTH_REMEMBER_DAYS so the copy is correct even if the query is slow.
const FALLBACK_REMEMBER_DAYS = 30;

function getReturnTo(): string | null {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("returnTo");
  if (!raw) return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//")) return null;
  if (raw.includes("://")) return null;
  if (raw.startsWith("/auth/")) return null;
  return raw;
}

/**
 * Convenience only: the last-used address is remembered so a returning admin
 * does not retype it. The PASSWORD is never stored, and this cookie/local
 * value is not a credential — it grants no access on its own.
 */
function readLastEmail(): string {
  try {
    return window.localStorage.getItem(LAST_EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}
function writeLastEmail(email: string): void {
  try {
    window.localStorage.setItem(LAST_EMAIL_KEY, email);
  } catch {
    /* private mode / storage disabled */
  }
}

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { refresh } = useAuth();
  const [email, setEmail] = useState(readLastEmail);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Unchecked by default: staying signed in for 30 days is the exception, not
  // the rule, and a shared/kiosk machine should never opt itself in.
  const [remember, setRemember] = useState(false);

  // The remember window is server-configurable, so read it rather than
  // hard-coding "30 days" in the copy.
  const configQuery = trpc.auth.config.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const rememberDays = configQuery.data?.rememberDays ?? FALLBACK_REMEMBER_DAYS;

  const loginMut = trpc.auth.login.useMutation({
    onSuccess: async data => {
      setError(null);
      writeLastEmail(email.trim().toLowerCase());
      await refresh();
      const dest = data.returnTo || getReturnTo() || "/overview";
      // Validate dest is safe (already sanitized server-side, but double-check)
      const safe =
        dest.startsWith("/") && !dest.startsWith("//") && !dest.includes("://")
          ? dest
          : "/overview";
      // Single soft navigation — no hard reload. Queries refetch via refresh() + invalidations.
      // Previously did setLocation(safe) + window.location.href=safe which caused flashing/reload loop.
      setLocation(safe);
    },
    onError: err => {
      const msg = err.message || "";
      // Network / truncated-response failures surface as raw JavaScript errors
      // from fetch ("Failed to execute 'json' on 'Response': Unexpected end of
      // JSON input", "Failed to fetch", "NetworkError"). Those mean the request
      // never completed, which is worth retrying and is not a credential
      // problem — so say that instead of showing a browser internal message.
      if (
        /Failed to fetch|NetworkError|Load failed|Unexpected end of JSON input|ERR_/i.test(
          msg
        )
      ) {
        setError(
          "We could not reach the server. Check your connection and try again."
        );
        return;
      }
      if (/timeout|timed out|ETIMEDOUT|ECONNRESET|socket hang up/i.test(msg)) {
        setError("The server took too long to respond. Please try again.");
        return;
      }
      // Map server messages to wording a staff member can act on. Anything
      // unmatched falls through to the raw message rather than a blank screen.
      if (msg === GENERIC_AUTH_MSG || msg === AUTH_REQUIRED_MSG) {
        setError(GENERIC_AUTH_MSG);
      } else if (msg === UNAUTHORIZED_MSG) {
        setError(UNAUTHORIZED_MSG);
      } else if (msg === SUSPENDED_MSG) {
        setError(SUSPENDED_MSG);
      } else if (msg === RATE_LIMIT_MSG) {
        setError(RATE_LIMIT_MSG);
      } else if (msg.includes("Unable to sign in")) {
        setError(
          "Unable to sign in right now. Please check your connection and try again."
        );
      } else {
        setError(msg);
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const emailTrim = email.trim().toLowerCase();
    if (!emailTrim || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!password) {
      setError("Please enter your password.");
      return;
    }
    loginMut.mutate({
      email: emailTrim,
      password,
      remember,
      returnTo: getReturnTo() ?? undefined,
    });
  };

  const isLoading = loginMut.isPending;

  // Surface an expired/revoked session reason handed over by a protected route.
  const sessionNotice = useMemo(() => {
    const reason = new URLSearchParams(window.location.search).get("reason");
    if (reason === "expired")
      return "Your session expired. Please sign in again.";
    if (reason === "revoked")
      return "Your session was ended. Please sign in again.";
    if (reason === "signedout")
      return "You have been signed out of that device.";
    return null;
  }, []);

  return (
    <div className="flex min-h-screen bg-[#F4F0E9]">
      {/* Left — Brand panel */}
      <div className="hidden w-1/2 flex-col justify-between bg-[#211B18] p-10 text-[#F4F0E9] lg:flex xl:p-12">
        <div>
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#E2533C] text-sm font-extrabold text-white">
              SK
            </div>
            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#F4F0E9]">
              StarKupps
            </span>
          </div>
        </div>

        <div className="max-w-md">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#E2533C]">
            Operations Platform
          </p>
          <h1 className="mt-4 text-4xl font-extrabold leading-none tracking-[-0.05em] text-[#FCFAF6] xl:text-[44px]">
            Everything you
            <br />
            need to run
            <br />
            <span className="text-[#E2533C]">StarKupps.</span>
          </h1>
          <p className="mt-5 max-w-sm text-sm leading-6 text-[#C9BEB3]">
            Manage orders, inventory, and outlets from a single calm, focused
            workspace.
          </p>

          <div className="mt-10 grid grid-cols-3 gap-3">
            {[
              { label: "Orders", sub: "Live queue" },
              { label: "Inventory", sub: "Stock & batches" },
              { label: "Outlets", sub: "Multi-location" },
              { label: "Customers", sub: "Loyalty" },
              { label: "Staff", sub: "Roles & shifts" },
              { label: "Analytics", sub: "Revenue" },
            ].map(item => (
              <div
                key={item.label}
                className="rounded-xl border border-[#3A2D27] bg-[#2A201C] px-3 py-3"
              >
                <p className="text-xs font-bold text-[#FCFAF6]">{item.label}</p>
                <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-[#9A8B80]">
                  {item.sub}
                </p>
              </div>
            ))}
          </div>
        </div>

        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#8B7E71]">
          © {new Date().getFullYear()} StarKupps • Secure admin access
        </p>
      </div>

      {/* Right — Login panel */}
      <div className="flex w-full flex-col bg-[#F4F0E9] lg:w-1/2">
        {/* Mobile brand header */}
        <div className="border-b border-[#E4DCD1] bg-[#211B18] px-6 py-8 text-center lg:hidden">
          <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-[#E2533C] text-sm font-extrabold text-white">
            SK
          </div>
          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[#E2533C]">
            StarKupps
          </p>
          <h2 className="mt-1 text-xl font-extrabold tracking-[-0.04em] text-[#FCFAF6]">
            Operations Platform
          </h2>
          <p className="mt-2 text-xs leading-5 text-[#C9BEB3]">
            Everything you need to run StarKupps.
          </p>
        </div>

        <div className="flex flex-1 items-center justify-center p-6 sm:p-8 lg:p-10 xl:p-12">
          <div className="w-full max-w-[400px]">
            <div className="mb-8">
              <h1 className="text-2xl font-extrabold tracking-[-0.04em] text-[#211B18]">
                Welcome back
              </h1>
              <p className="mt-2 text-sm leading-5 text-[#776A5E]">
                Sign in to your StarKupps operations account.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
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
                  autoFocus
                  placeholder="Enter your email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="h-11 border-[#DCCFC2] bg-white text-sm placeholder:text-[#A99B8E] focus-visible:border-[#E2533C] focus-visible:ring-[#E2533C]/20"
                  aria-invalid={Boolean(error)}
                  disabled={isLoading}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label
                    htmlFor="password"
                    className="text-xs font-bold text-[#211B18]"
                  >
                    Password
                  </Label>
                  <Link
                    href="/auth/forgot-password"
                    className="text-xs font-semibold text-[#A83825] hover:text-[#8A2E1F] hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="h-11 border-[#DCCFC2] bg-white pr-10 text-sm placeholder:text-[#A99B8E] focus-visible:border-[#E2533C] focus-visible:ring-[#E2533C]/20"
                    aria-invalid={Boolean(error)}
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#8E8174] hover:bg-[#F4F0E9] hover:text-[#211B18] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E2533C]"
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                    tabIndex={0}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-[#E4DCD1] bg-[#FCFAF6] px-4 py-3">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="remember"
                    checked={remember}
                    onCheckedChange={v => setRemember(v === true)}
                    disabled={isLoading}
                    aria-describedby="remember-hint"
                    className="mt-0.5 size-4 rounded-[4px] border-[#D6CABD] data-[state=checked]:border-[#E2533C] data-[state=checked]:bg-[#E2533C] data-[state=checked]:text-white focus-visible:ring-[#E2533C]/30"
                  />
                  <div className="min-w-0">
                    <Label
                      htmlFor="remember"
                      className="cursor-pointer select-none text-xs font-bold leading-4 text-[#211B18]"
                    >
                      Remember on this device
                    </Label>
                    <p
                      id="remember-hint"
                      className="mt-1 text-[11px] leading-4 text-[#776A5E]"
                    >
                      Stay signed in on this device for {rememberDays} days.
                      Only use this on your own device — you can review and
                      revoke active devices at any time.
                    </p>
                  </div>
                </div>
              </div>

              {(error || sessionNotice) && (
                <div
                  role="alert"
                  aria-live="polite"
                  className="rounded-xl border border-[#F1C9BD] bg-[#FFF8F5] px-4 py-3 text-sm leading-5 text-[#8D5145]"
                >
                  {error ?? sessionNotice}
                </div>
              )}

              <Button
                type="submit"
                disabled={isLoading}
                className="h-11 w-full rounded-xl bg-[#211B18] text-sm font-bold text-white hover:bg-[#3A2D27] disabled:opacity-60"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  "Sign In"
                )}
              </Button>
            </form>

            <div className="mt-8 flex items-center justify-center gap-2 rounded-xl border border-[#E4DCD1] bg-white px-4 py-3">
              <ShieldCheck className="h-4 w-4 text-[#468A61]" />
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#8B7E71]">
                Secure admin access • Encrypted session
              </span>
            </div>

            <p className="mt-6 text-center text-xs leading-5 text-[#9A8B80]">
              Admin accounts are managed by your organization.
              <br />
              Contact your administrator if you need access.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
