import { trpc } from "@/api/trpc";
import { FormField } from "@/components/shared/FormField";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useOutlet } from "@/state/outlet-provider";
import { apiError } from "@/utils/errors";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

export function OrderIntakeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { selectedId: contextOutletId, outlets } = useOutlet();
  const [form, setForm] = useState({
    orderNumber: "",
    outletId: "",
    type: "takeaway" as "dine_in" | "takeaway" | "delivery",
    customerName: "",
    phone: "",
    itemName: "",
    quantity: "1",
    lineTotal: "",
    notes: "",
  });
  // Fall back to the header selection, or to the only outlet when the operator
  // has exactly one. Derived once so the effect below has a scalar dependency.
  const fallbackOutletId =
    contextOutletId ?? (outlets.length === 1 ? outlets[0]?.id : undefined);

  useEffect(() => {
    if (!open) return;
    setForm(f => {
      if (f.outletId) return f;
      return fallbackOutletId
        ? { ...f, outletId: String(fallbackOutletId) }
        : f;
    });
  }, [open, fallbackOutletId]);
  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();
  const create = trpc.admin.orders.create.useMutation({
    onSuccess: result => {
      toast.success("Ticket recorded");
      setForm({
        orderNumber: "",
        outletId: "",
        type: "takeaway",
        customerName: "",
        phone: "",
        itemName: "",
        quantity: "1",
        lineTotal: "",
        notes: "",
      });
      onOpenChange(false);
      void utils.admin.orders.list.invalidate();
      void utils.admin.dashboard.invalidate();
      setLocation(`/orders/${result.id}`);
    },
    onError: error =>
      toast.error("Ticket could not be recorded", {
        description: apiError(error),
      }),
  });
  const quantity = Number(form.quantity);
  const lineTotal = Number(form.lineTotal);
  const orderNumber = Number(form.orderNumber);
  const chosenOutletId =
    form.outletId || (fallbackOutletId ? String(fallbackOutletId) : "");
  const valid =
    Number.isInteger(orderNumber) &&
    orderNumber > 0 &&
    chosenOutletId !== "" &&
    form.itemName.trim().length > 0 &&
    Number.isInteger(quantity) &&
    quantity > 0 &&
    Number.isFinite(lineTotal) &&
    lineTotal > 0;
  const submit = () => {
    if (!valid) {
      toast.error(
        chosenOutletId === ""
          ? "Select an outlet for this ticket"
          : "Check the ticket details"
      );
      return;
    }
    create.mutate({
      orderNumber,
      outletId: Number(chosenOutletId),
      type: form.type,
      customer: form.phone.trim()
        ? { name: form.customerName.trim() || null, phone: form.phone.trim() }
        : null,
      notes: form.notes.trim() || null,
      items: [
        {
          menuItemId: null,
          itemName: form.itemName.trim(),
          quantity,
          lineTotal,
          selectedModifiers: null,
        },
      ],
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-[#D8CDC0] bg-[#FCFAF6]">
        <DialogHeader>
          <DialogTitle>Record an incoming ticket</DialogTitle>
          <DialogDescription>This creates a persisted order.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Ticket number">
            <Input
              value={form.orderNumber}
              onChange={e => setForm({ ...form, orderNumber: e.target.value })}
              inputMode="numeric"
              placeholder="e.g. 1042"
            />
          </FormField>
          <FormField label="Outlet">
            <Select
              value={form.outletId}
              onValueChange={outletId => setForm({ ...form, outletId })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select outlet" />
              </SelectTrigger>
              <SelectContent>
                {outlets.map(o => (
                  <SelectItem key={o.id} value={String(o.id)}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Order type">
            <Select
              value={form.type}
              onValueChange={(type: "dine_in" | "takeaway" | "delivery") =>
                setForm({ ...form, type })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dine_in">Dine in</SelectItem>
                <SelectItem value="takeaway">Takeaway</SelectItem>
                <SelectItem value="delivery">Delivery</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Guest name (optional)">
            <Input
              value={form.customerName}
              onChange={e => setForm({ ...form, customerName: e.target.value })}
              maxLength={160}
            />
          </FormField>
          <FormField label="Guest phone (optional)">
            <Input
              value={form.phone}
              onChange={e => setForm({ ...form, phone: e.target.value })}
              inputMode="tel"
              maxLength={32}
            />
          </FormField>
        </div>
        <div className="rounded-xl border border-[#E4DCD1] bg-[#F8F4EE] p-4">
          <p className="text-xs font-extrabold">Order line</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_96px_120px]">
            <Input
              value={form.itemName}
              onChange={e => setForm({ ...form, itemName: e.target.value })}
              placeholder="Item name"
              maxLength={160}
            />
            <Input
              value={form.quantity}
              onChange={e => setForm({ ...form, quantity: e.target.value })}
              inputMode="numeric"
              placeholder="Qty"
            />
            <Input
              value={form.lineTotal}
              onChange={e => setForm({ ...form, lineTotal: e.target.value })}
              inputMode="decimal"
              placeholder="Total"
            />
          </div>
          <Textarea
            value={form.notes}
            onChange={e => setForm({ ...form, notes: e.target.value })}
            placeholder="Order notes (optional)"
            className="mt-3"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={create.isPending}
            className="bg-[#211B18] text-white"
          >
            {create.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Create ticket"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
