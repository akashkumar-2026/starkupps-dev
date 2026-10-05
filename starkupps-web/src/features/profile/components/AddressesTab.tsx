import { useState } from "react";
import type { User } from "@supabase/supabase-js";
import { Briefcase, Home, Loader2, MapPin, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSavedAddresses } from "@/features/profile/useAddresses";
import type { SavedAddress } from "@/types/profile";
import { EmptyState } from "@/components/shared/EmptyState";
import { toast } from "sonner";

const LABELS = [
  { id: "Home", icon: Home },
  { id: "Work", icon: Briefcase },
  { id: "Other", icon: MapPin },
] as const;

function AddressDialog({
  open,
  onOpenChange,
  initial,
  defaults,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: SavedAddress | null;
  defaults: { name: string; phone: string };
  onSave: (
    v: Omit<SavedAddress, "id" | "createdAt" | "isDefault"> & { id?: string | undefined },
  ) => void;
}) {
  const [label, setLabel] = useState<SavedAddress["label"]>(initial?.label ?? "Home");
  const [name, setName] = useState(initial?.name ?? defaults.name);
  const [phone, setPhone] = useState(initial?.phone ?? defaults.phone);
  const [address, setAddress] = useState(initial?.address ?? "");
  const [landmark, setLandmark] = useState(initial?.landmark ?? "");
  const [busy, setBusy] = useState(false);

  // Reset when a different address is opened for edit
  const key = initial?.id ?? "new";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) {
      toast.error("Enter the receiver's name");
      return;
    }
    if (phone.replace(/\D/g, "").length < 10) {
      toast.error("Enter a valid 10-digit phone");
      return;
    }
    if (address.trim().length < 8) {
      toast.error("Enter the full delivery address");
      return;
    }
    setBusy(true);
    try {
      onSave({
        id: initial?.id,
        label,
        name: name.trim(),
        phone: phone.trim(),
        address: address.trim(),
        landmark: landmark.trim() || undefined,
      });
      toast.success(initial ? "Address updated" : "Address saved");
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent key={key} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            {initial ? "Edit address" : "Add delivery address"}
          </DialogTitle>
          <DialogDescription>
            We deliver within Munger town — be as specific as you can.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="flex gap-2">
            {LABELS.map(({ id, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setLabel(id)}
                className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border text-sm font-semibold transition-colors ${
                  label === id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-input text-muted-foreground"
                }`}
              >
                <Icon className="size-4" />
                {id}
              </button>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="addr-name">Receiver name</Label>
              <Input
                id="addr-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-11 rounded-xl"
                placeholder="Aarav Kumar"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="addr-phone">Phone</Label>
              <Input
                id="addr-phone"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/[^\d+\s]/g, ""))}
                className="h-11 rounded-xl"
                placeholder="82524 33504"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="addr-line">Full address</Label>
            <Textarea
              id="addr-line"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="min-h-20 rounded-xl"
              placeholder="House no, street, area — e.g. Azad Chowk, Dilawer Pur, Munger"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="addr-landmark">Landmark (optional)</Label>
            <Input
              id="addr-landmark"
              value={landmark}
              onChange={(e) => setLandmark(e.target.value)}
              className="h-11 rounded-xl"
              placeholder="Near Jain Dharamshala"
            />
          </div>
          <Button type="submit" disabled={busy} className="h-11 w-full rounded-xl font-semibold">
            {busy && <Loader2 className="size-4 animate-spin" />}
            {initial ? "Save changes" : "Save address"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AddressesTab({ user }: { user: User }) {
  const { addresses, save, remove, setDefault } = useSavedAddresses(user.id);
  const [dialog, setDialog] = useState(false);
  const [editing, setEditing] = useState<SavedAddress | null>(null);

  const openNew = () => {
    setEditing(null);
    setDialog(true);
  };
  const openEdit = (a: SavedAddress) => {
    setEditing(a);
    setDialog(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-2xl">Addresses</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Saved delivery spots — pick one at checkout in seconds.
          </p>
        </div>
        <Button onClick={openNew} className="min-h-11 gap-1.5 rounded-xl">
          <Plus className="size-4" />
          Add address
        </Button>
      </div>

      {addresses.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title="No saved addresses"
          hint="Save your home or hostel address once — checkout becomes a two-tap job."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {addresses.map((a) => (
            <div key={a.id} className="rounded-3xl border border-border bg-card p-5 shadow-card">
              <div className="flex items-center gap-2">
                <Badge variant={a.isDefault ? "default" : "secondary"} className="rounded-full">
                  {a.label}
                </Badge>
                {a.isDefault && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
                    <Star className="size-3.5 fill-primary" />
                    Default
                  </span>
                )}
                <div className="ml-auto flex gap-1">
                  <button
                    onClick={() => openEdit(a)}
                    aria-label="Edit address"
                    className="pressable grid size-11 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    onClick={() => {
                      remove(a.id);
                      toast.success("Address removed");
                    }}
                    aria-label="Delete address"
                    className="pressable grid size-11 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
              <p className="mt-3 text-sm font-semibold">
                {a.name}{" "}
                <span className="font-normal tabular-nums text-muted-foreground">· {a.phone}</span>
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{a.address}</p>
              {a.landmark && (
                <p className="mt-0.5 text-xs text-muted-foreground">Near {a.landmark}</p>
              )}
              {!a.isDefault && (
                <button
                  onClick={() => {
                    setDefault(a.id);
                    toast.success("Default address updated");
                  }}
                  className="pressable mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline"
                >
                  Make default
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <AddressDialog
        open={dialog}
        onOpenChange={setDialog}
        initial={editing}
        defaults={{
          name: (user.user_metadata?.["full_name"] as string) ?? "",
          phone: user.phone ?? "",
        }}
        onSave={save}
      />
    </div>
  );
}
