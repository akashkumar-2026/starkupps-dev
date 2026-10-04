import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowLeft,
  Loader2,
  LogOut,
  MonitorSmartphone,
  ShieldCheck,
  TriangleAlert,
  MapPin,
} from "lucide-react";
import { trpc } from "@/api/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ConfirmDialog } from "@/components/shared/dialog";
import { useAuth } from "@/state/auth-provider";

type SessionRow = {
  id: number;
  deviceLabel: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  remember: boolean;
  isCurrent: boolean;
};

function relativeTime(value: Date | string): string {
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return "unknown";
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function formatDate(value: Date | string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SecuritySessionsPage() {
  const { logout } = useAuth();
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const [pendingRevoke, setPendingRevoke] = useState<SessionRow | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const sessions = trpc.auth.sessions.list.useQuery(undefined, {
    staleTime: 15_000,
  });

  const revoke = trpc.auth.sessions.revoke.useMutation({
    onSuccess: async () => {
      setPendingRevoke(null);
      setNotice("That device has been signed out.");
      await utils.auth.sessions.list.invalidate();
    },
    onError: e => setNotice(e.message || "Could not sign out that device."),
  });

  const revokeOthers = trpc.auth.sessions.revokeOthers.useMutation({
    onSuccess: async d => {
      setConfirmAll(false);
      setNotice(
        d.revoked > 0
          ? `Signed out of ${d.revoked} other device${d.revoked === 1 ? "" : "s"}.`
          : "No other devices were signed in."
      );
      await utils.auth.sessions.list.invalidate();
    },
    onError: e => setNotice(e.message || "Could not sign out other devices."),
  });

  const rows: SessionRow[] = (sessions.data ?? []) as SessionRow[];

  return (
    <div className="min-h-screen bg-[#F4F0E9]">
      <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-6 sm:py-12">
        <Link
          href="/overview"
          className="inline-flex items-center gap-1 text-xs font-semibold text-[#8E8174] transition-colors hover:text-[#211B18] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E2533C]"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to overview
        </Link>

        <header className="mt-6">
          <div className="mb-3 flex items-center gap-2">
            <span className="h-px w-7 bg-[#E2533C]" />
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#A83825]">
              Security
            </span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-[-0.055em] text-[#211B18] sm:text-[38px]">
            Password &amp; active devices
          </h1>
          <p className="mt-3 max-w-xl text-sm font-medium leading-6 text-[#75695E]">
            Review where your account is signed in. You can end any device here,
            and changing your password signs out every device.
          </p>
        </header>

        {notice && (
          <div
            role="status"
            aria-live="polite"
            className="mt-6 rounded-xl border border-[#D7E7DB] bg-[#F3F9F5] px-4 py-3 text-sm leading-5 text-[#2F6947]"
          >
            {notice}
          </div>
        )}

        {/* ── Password ─────────────────────────────────────────────────── */}
        <section className="mt-8 rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-sm font-extrabold text-[#211B18]">
                <ShieldCheck className="h-4 w-4 text-[#468A61]" /> Password
              </h2>
              <p className="mt-1.5 max-w-md text-xs leading-5 text-[#776A5E]">
                Changing your password revokes every other session, including
                remembered devices. You will stay signed in on this device.
              </p>
            </div>
            <Button
              onClick={() => setLocation("/auth/change-password")}
              className="h-9 shrink-0 rounded-xl bg-[#211B18] px-4 text-xs font-bold text-white hover:bg-[#3A2D27]"
            >
              Change password
            </Button>
          </div>
        </section>

        {/* ── Devices ──────────────────────────────────────────────────── */}
        <section className="mt-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-extrabold text-[#211B18]">
              <MonitorSmartphone className="h-4 w-4 text-[#A83825]" /> Active
              devices
              {rows.length > 0 && (
                <Badge variant="secondary" className="ml-1 rounded-full">
                  {rows.length}
                </Badge>
              )}
            </h2>
            {rows.length > 1 && (
              <Button
                variant="outline"
                disabled={revokeOthers.isPending}
                onClick={() => setConfirmAll(true)}
                className="h-8 rounded-lg border-[#D6CABD] bg-white px-3 text-xs font-semibold text-[#8D5145] hover:bg-[#FFF8F5]"
              >
                {revokeOthers.isPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Signing
                    out...
                  </>
                ) : (
                  "Sign out of all other devices"
                )}
              </Button>
            )}
          </div>

          <div className="overflow-hidden rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6]">
            {sessions.isLoading ? (
              <div className="grid min-h-[180px] place-items-center p-6">
                <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
                <span className="sr-only">Loading active devices</span>
              </div>
            ) : sessions.isError ? (
              <div className="p-6 text-center">
                <TriangleAlert className="mx-auto h-5 w-5 text-[#B83D29]" />
                <p className="mt-2 text-sm text-[#8D5145]">
                  {sessions.error.message || "We could not load your devices."}
                </p>
                <Button
                  variant="outline"
                  onClick={() => sessions.refetch()}
                  className="mt-4 h-8 rounded-lg border-[#E8B9AC] bg-white text-xs text-[#8E392A] hover:bg-[#FFF2EE]"
                >
                  Try again
                </Button>
              </div>
            ) : rows.length === 0 ? (
              <div className="p-8 text-center">
                <MonitorSmartphone className="mx-auto h-6 w-6 text-[#8E8174]" />
                <h3 className="mt-3 text-sm font-extrabold text-[#211B18]">
                  No other active devices
                </h3>
                <p className="mt-1.5 text-xs leading-5 text-[#827568]">
                  Only this device is currently signed in.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-[#EDE4D9]">
                {rows.map(s => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-4 px-5 py-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-bold text-[#211B18]">
                          {s.deviceLabel || "Unknown device"}
                        </p>
                        {s.isCurrent && (
                          <Badge className="rounded-full border-[#BFE0CB] bg-[#E5F2E9] text-[10px] font-bold text-[#2F6947] hover:bg-[#E5F2E9]">
                            This device
                          </Badge>
                        )}
                        {s.remember && !s.isCurrent && (
                          <Badge
                            variant="outline"
                            className="rounded-full border-[#DCCFC2] text-[10px] font-semibold text-[#776A5E]"
                          >
                            Remembered
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-[#776A5E]">
                        Last active {relativeTime(s.lastUsedAt)}
                        {s.ipAddress && (
                          <span className="ml-2 inline-flex items-center gap-1 text-[#8B7E71]">
                            <MapPin className="h-3 w-3" />
                            {s.ipAddress}
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[#9A8B80]">
                        Signed in {formatDate(s.createdAt)} · expires{" "}
                        {formatDate(s.expiresAt)}
                      </p>
                    </div>
                    {!s.isCurrent && (
                      <Button
                        variant="outline"
                        disabled={revoke.isPending}
                        onClick={() => setPendingRevoke(s)}
                        className="h-8 shrink-0 rounded-lg border-[#E8B9AC] bg-white px-3 text-xs font-semibold text-[#8E392A] hover:bg-[#FFF2EE]"
                      >
                        <LogOut className="h-3.5 w-3.5" /> Sign out
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="mt-3 text-xs leading-5 text-[#827568]">
            A remembered device stays signed in until you end it here or change
            your password. On a shared or public computer, sign out when you are
            done.
          </p>
        </section>

        <Separator className="my-8" />

        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => void logout()}
            className="h-9 rounded-xl border-[#D6CABD] bg-white px-4 text-xs font-semibold text-[#8D5145] hover:bg-[#FFF8F5]"
          >
            Sign out of this device
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={pendingRevoke !== null}
        onOpenChange={o => !o && setPendingRevoke(null)}
        title="Sign out this device?"
        description={`${pendingRevoke?.deviceLabel || "That device"} will be signed out immediately and will need to sign in again. Any other devices stay signed in.`}
        confirmLabel="Sign out device"
        size="md"
        pending={revoke.isPending}
        onConfirm={() => {
          if (pendingRevoke) revoke.mutate({ sessionId: pendingRevoke.id });
        }}
      />

      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title="Sign out of all other devices?"
        description="Every other signed-in device, including remembered ones, will need to sign in again. This device stays signed in."
        confirmLabel="Sign out other devices"
        size="md"
        pending={revokeOthers.isPending}
        onConfirm={() => revokeOthers.mutate()}
      />
    </div>
  );
}
