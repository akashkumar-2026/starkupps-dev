import { trpc } from "@/api/trpc";
import { FormField } from "@/components/shared/FormField";
import { PageHeading } from "@/components/shared/PageHeading";
import { ErrorPanel, PageLoading } from "@/components/shared/StatePanels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { apiError } from "@/utils/errors";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export default function SettingsPage() {
  const settings = trpc.settings.get.useQuery();
  const save = trpc.settings.save.useMutation({
    onSuccess: () => toast.success("Settings saved"),
    onError: e => toast.error(apiError(e)),
  });
  const [form, setForm] = useState({
    storeName: "StarKupps",
    timezone: "Asia/Kolkata",
    openForOrders: true,
    autoAcceptOrders: false,
    openingTime: "09:00",
    closingTime: "22:00",
    fssaiLicense: null as string | null,
    paymentProvider: null as string | null,
    packingCharge: 15,
    deliveryFee: 29,
    freeDeliveryAbove: null as number | null,
  });
  useEffect(() => {
    if (settings.data) {
      const s = settings.data as any;
      setForm({
        storeName: s.storeName || "StarKupps",
        timezone: s.timezone || "Asia/Kolkata",
        openForOrders: s.openForOrders ?? true,
        autoAcceptOrders: s.autoAcceptOrders ?? false,
        openingTime: s.openingTime || "09:00",
        closingTime: s.closingTime || "22:00",
        fssaiLicense: s.fssaiLicense ?? null,
        paymentProvider: s.paymentProvider ?? null,
        packingCharge: s.packingCharge ?? 15,
        deliveryFee: s.deliveryFee ?? 29,
        freeDeliveryAbove: s.freeDeliveryAbove ?? null,
      });
    }
  }, [settings.data]);
  if (settings.isLoading) return <PageLoading />;
  if (settings.isError)
    return (
      <ErrorPanel
        detail={apiError(settings.error)}
        retry={() => settings.refetch()}
      />
    );
  return (
    <>
      <PageHeading
        kicker="Configuration"
        title="Store settings"
        detail="Only owners can update store configuration."
      />
      <div className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-6 space-y-4">
        <FormField label="Store name">
          <Input
            value={form.storeName}
            onChange={e => setForm({ ...form, storeName: e.target.value })}
            maxLength={160}
          />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Timezone">
            <Input
              value={form.timezone}
              onChange={e => setForm({ ...form, timezone: e.target.value })}
            />
          </FormField>
          <FormField label="FSSAI License">
            <Input
              value={form.fssaiLicense || ""}
              onChange={e =>
                setForm({ ...form, fssaiLicense: e.target.value || null })
              }
            />
          </FormField>
          <FormField label="Opening time">
            <Input
              type="time"
              value={form.openingTime}
              onChange={e => setForm({ ...form, openingTime: e.target.value })}
            />
          </FormField>
          <FormField label="Closing time">
            <Input
              type="time"
              value={form.closingTime}
              onChange={e => setForm({ ...form, closingTime: e.target.value })}
            />
          </FormField>
        </div>
        <label className="flex items-center justify-between rounded-xl border border-[#E4DCD1] bg-[#F8F4EE] px-4 py-3">
          <span className="text-sm font-bold">Open for orders</span>
          <Switch
            checked={form.openForOrders}
            onCheckedChange={v => setForm({ ...form, openForOrders: v })}
          />
        </label>
        <label className="flex items-center justify-between rounded-xl border border-[#E4DCD1] bg-[#F8F4EE] px-4 py-3">
          <span className="text-sm font-bold">Auto-accept orders</span>
          <Switch
            checked={form.autoAcceptOrders}
            onCheckedChange={v => setForm({ ...form, autoAcceptOrders: v })}
          />
        </label>
        <div className="grid grid-cols-3 gap-3">
          <FormField label="Packing charge (₹)">
            <Input
              type="number"
              min={0}
              value={form.packingCharge}
              onChange={e =>
                setForm({
                  ...form,
                  packingCharge: Math.max(0, Number(e.target.value)),
                })
              }
            />
          </FormField>
          <FormField label="Delivery fee (₹)">
            <Input
              type="number"
              min={0}
              value={form.deliveryFee}
              onChange={e =>
                setForm({
                  ...form,
                  deliveryFee: Math.max(0, Number(e.target.value)),
                })
              }
            />
          </FormField>
          <FormField label="Free delivery above (₹, blank = off)">
            <Input
              type="number"
              min={0}
              value={form.freeDeliveryAbove ?? ""}
              placeholder="No threshold"
              onChange={e =>
                setForm({
                  ...form,
                  freeDeliveryAbove:
                    e.target.value === ""
                      ? null
                      : Math.max(0, Number(e.target.value)),
                })
              }
            />
          </FormField>
        </div>
        <p className="text-xs text-[#776A5E]">
          Charges apply to storefront orders immediately. Dine-in never pays
          packing; taxes come from the Finance → Taxes table.
        </p>
        <Button
          className="bg-[#211B18] text-white"
          onClick={() => save.mutate(form as any)}
          disabled={save.isPending}
        >
          Save settings
        </Button>
      </div>
    </>
  );
}
