import { useState } from "react";
import type { User } from "@supabase/supabase-js";
import { useNavigate } from "@tanstack/react-router";
import { BadgeCheck, Loader2, LogOut, Mail, Pencil, Phone, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/state";
import { displayName } from "@/utils/user";
import { toast } from "sonner";
import { errorMessage } from "@/utils/errors";

export function SettingsTab({ user }: { user: User }) {
  const { signOut, updateName } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(displayName(user));
  const [saving, setSaving] = useState(false);

  const saveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) {
      toast.error("Name must be at least 2 characters");
      return;
    }
    setSaving(true);
    try {
      await updateName(name);
      toast.success("Profile updated");
      setEditing(false);
    } catch (error: unknown) {
      toast.error(errorMessage(error) ?? "Couldn't update profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-2xl">Profile settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">How the kitchen and riders know you.</p>
      </div>

      <div className="rounded-3xl border border-border bg-card shadow-card">
        <div className="flex items-center gap-3 border-b border-border p-5">
          <span className="grid size-10 place-items-center rounded-2xl bg-primary/10 text-primary">
            <UserIcon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">Display name</p>
            <p className="truncate text-sm font-semibold">{displayName(user)}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditing(true)}
            className="min-h-11 gap-1.5 rounded-xl"
          >
            <Pencil className="size-3.5" />
            Edit
          </Button>
        </div>

        <div className="space-y-4 p-5">
          <div className="flex items-center gap-3">
            <Mail className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">Email</p>
              <p className="truncate text-sm font-medium">{user.email ?? "Not linked"}</p>
            </div>
            {user.email && (
              <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-veg">
                <BadgeCheck className="size-4" />
                Verified
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Phone className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">Phone</p>
              <p className="truncate text-sm font-medium tabular-nums">
                {user.phone ?? "Not linked"}
              </p>
            </div>
            {user.phone && (
              <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-veg">
                <BadgeCheck className="size-4" />
                Verified
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Signed in{" "}
            {user.created_at
              ? `since ${new Date(user.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}`
              : "with StarKupps"}{" "}
            · ID {user.id.slice(0, 8)}…
          </p>
        </div>
      </div>

      <Button
        variant="destructive"
        disabled={signingOut}
        onClick={async () => {
          setSigningOut(true);
          try {
            await signOut();
            toast.success("Signed out");
            navigate({ to: "/" });
          } catch (error: unknown) {
            toast.error(errorMessage(error) ?? "Sign-out failed");
          } finally {
            setSigningOut(false);
          }
        }}
        className="h-11 w-full rounded-xl font-semibold sm:w-auto sm:px-8"
      >
        {signingOut ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
        Sign out
      </Button>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Edit display name</DialogTitle>
            <DialogDescription>This is the name printed on your order slips.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveName} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="profile-name">Full name</Label>
              <Input
                id="profile-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-11 rounded-xl"
                autoComplete="name"
              />
            </div>
            <Button
              type="submit"
              disabled={saving}
              className="h-11 w-full rounded-xl font-semibold"
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              Save
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
