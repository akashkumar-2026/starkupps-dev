import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/shared/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { trpc } from "@/api/trpc";
import { Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";

export default function MarketingHub() {
  // NOTE: the legacy Marketing > Coupons surface was retired in favour of the
  // dedicated Coupons workspace (`/coupons`). The server procedures
  // `marketing.coupons.*` remain for backward compatibility but are deprecated;
  // use `coupons.*` instead.
  const [tab, setTab] = useState<"offers" | "campaigns" | "banners">("offers");
  return (
    <>
      <section className="mb-6">
        <p className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#A83825]">
          <span className="h-px w-7 bg-[#E2533C]" />
          Growth
        </p>
        <h2 className="text-3xl font-extrabold tracking-[-0.055em]">
          Marketing that respects the margin.
        </h2>
        <p className="mt-2 text-sm leading-6 text-[#75695E]">
          Offers, campaigns, and banners — outlet-aware, server-validated,
          deterministic conflict handling.
        </p>
        <div className="mt-4 flex gap-1 rounded-xl border border-[#E4DCD1] bg-[#EEE9E1] p-1 w-fit">
          {(["offers", "campaigns", "banners"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold capitalize ${tab === t ? "bg-white shadow-sm" : "text-[#766A5F]"}`}
            >
              {t}
            </button>
          ))}
        </div>
      </section>
      {tab === "offers" && <OffersTab />}
      {tab === "campaigns" && <CampaignsTab />}
      {tab === "banners" && <BannersTab />}
    </>
  );
}

const offerSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(160),
  type: z.enum(["percentage", "fixed", "buy_x_get_y", "combo"]),
  discountValue: z.string().trim().optional(),
});
type OfferForm = z.infer<typeof offerSchema>;
const campaignSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(160),
});
const bannerSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2, "Title must be at least 2 characters")
    .max(160),
});

function OffersTab() {
  const q = trpc.marketing.offers.list.useQuery();
  const [open, setOpen] = useState(false);
  const form = useForm<OfferForm>({
    resolver: zodResolver(offerSchema),
    defaultValues: { name: "", type: "percentage", discountValue: "10" },
  });
  const create = trpc.marketing.offers.create.useMutation({
    onSuccess: () => {
      toast.success("Offer created");
      setOpen(false);
      form.reset();
      void q.refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const onSubmit = form.handleSubmit(values => {
    create.mutate({
      name: values.name.trim(),
      type: values.type,
      discountValue: values.discountValue ? Number(values.discountValue) : null,
      config: null,
      applicableOutlets: null,
      active: true,
      startAt: null,
      endAt: null,
    } as any);
  });
  return (
    <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-extrabold">Offers</h3>
        <Button
          onClick={() => {
            form.reset();
            setOpen(true);
          }}
          className="bg-[#211B18] text-xs text-white"
        >
          <Plus className="mr-1 h-3 w-3" />
          New offer
        </Button>
      </div>
      {q.isLoading ? (
        <div className="grid place-items-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
        </div>
      ) : q.isError ? (
        <p className="mt-4 text-center text-xs text-[#B83D29]">
          Offers could not be loaded.{" "}
          <button className="underline" onClick={() => q.refetch()}>
            Retry
          </button>
        </p>
      ) : !q.data?.length ? (
        <p className="mt-4 text-center text-xs text-[#827568]">
          No offers yet.
        </p>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {q.data.map((o: any) => (
            <article key={o.id} className="rounded-xl border bg-white p-4">
              <p className="text-sm font-bold">{o.name}</p>
              <p className="text-xs text-[#776A5E]">
                {o.type} · {o.discountValue ?? "variable"} ·{" "}
                {o.active ? "Active" : "Inactive"}
              </p>
            </article>
          ))}
        </div>
      )}
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="New offer"
        description="Validated client-side and server-side."
        onSubmit={onSubmit}
        submitLabel={create.isPending ? "Creating…" : "Create"}
        submitPending={create.isPending}
        formClassName="grid gap-3"
      >
        <Form {...form}>
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input {...field} className="bg-white" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Type</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="bg-white">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="percentage">Percentage</SelectItem>
                    <SelectItem value="fixed">Fixed</SelectItem>
                    <SelectItem value="buy_x_get_y">Buy X Get Y</SelectItem>
                    <SelectItem value="combo">Combo</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="discountValue"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Value</FormLabel>
                <FormControl>
                  <Input type="number" {...field} className="bg-white" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </Form>
      </FormDialog>
    </section>
  );
}

function CampaignsTab() {
  const q = trpc.marketing.campaigns.list.useQuery();
  const [open, setOpen] = useState(false);
  const form = useForm<z.infer<typeof campaignSchema>>({
    resolver: zodResolver(campaignSchema),
    defaultValues: { name: "" },
  });
  const create = trpc.marketing.campaigns.create.useMutation({
    onSuccess: () => {
      toast.success("Campaign created");
      setOpen(false);
      form.reset();
      void q.refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const onSubmit = form.handleSubmit(v =>
    create.mutate({
      name: v.name.trim(),
      audience: null,
      offerId: null,
      couponId: null,
      channels: ["push"],
      status: "draft",
      startAt: null,
      endAt: null,
    })
  );
  return (
    <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-extrabold">Campaigns</h3>
        <Button
          onClick={() => {
            form.reset();
            setOpen(true);
          }}
          className="bg-[#211B18] text-xs text-white"
        >
          <Plus className="mr-1 h-3 w-3" />
          New campaign
        </Button>
      </div>
      {q.isLoading ? (
        <div className="grid place-items-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
        </div>
      ) : q.isError ? (
        <p className="mt-4 text-center text-xs text-[#B83D29]">
          Campaigns could not be loaded.{" "}
          <button className="underline" onClick={() => q.refetch()}>
            Retry
          </button>
        </p>
      ) : !q.data?.length ? (
        <p className="mt-4 text-center text-xs text-[#827568]">
          No campaigns yet.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {q.data.map((c: any) => (
            <div
              key={c.id}
              className="flex items-center justify-between rounded-xl border bg-white p-3"
            >
              <div>
                <p className="text-sm font-bold">{c.name}</p>
                <p className="text-xs text-[#776A5E]">
                  {c.status} · {((c.channels as string[]) ?? []).join(", ")}
                </p>
              </div>
              <Badge className="border-[#E3D9CE] bg-[#F6F0E8]">
                {c.status}
              </Badge>
            </div>
          ))}
        </div>
      )}
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="New campaign"
        description="Audience + offer + channels + status — auditable."
        onSubmit={onSubmit}
        submitLabel={create.isPending ? "Creating…" : "Create"}
        submitPending={create.isPending}
        formClassName="grid gap-3"
      >
        <Form {...form}>
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input
                    placeholder="Campaign name"
                    {...field}
                    className="bg-white"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </Form>
      </FormDialog>
    </section>
  );
}

function BannersTab() {
  const q = trpc.marketing.banners.list.useQuery();
  const [open, setOpen] = useState(false);
  const form = useForm<z.infer<typeof bannerSchema>>({
    resolver: zodResolver(bannerSchema),
    defaultValues: { title: "" },
  });
  const create = trpc.marketing.banners.create.useMutation({
    onSuccess: () => {
      toast.success("Banner created");
      setOpen(false);
      form.reset();
      void q.refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const onSubmit = form.handleSubmit(v =>
    create.mutate({
      title: v.title.trim(),
      description: null,
      imageUrl: null,
      ctaLabel: null,
      ctaLink: null,
      position: "homepage_hero",
      status: "draft",
      publishAt: null,
    })
  );
  return (
    <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-extrabold">Banners</h3>
        <Button
          onClick={() => {
            form.reset();
            setOpen(true);
          }}
          className="bg-[#211B18] text-xs text-white"
        >
          <Plus className="mr-1 h-3 w-3" />
          New banner
        </Button>
      </div>
      {q.isLoading ? (
        <div className="grid place-items-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
        </div>
      ) : q.isError ? (
        <p className="mt-4 text-center text-xs text-[#B83D29]">
          Banners could not be loaded.{" "}
          <button className="underline" onClick={() => q.refetch()}>
            Retry
          </button>
        </p>
      ) : !q.data?.length ? (
        <p className="mt-4 text-center text-xs text-[#827568]">
          No banners yet.
        </p>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {q.data.map((b: any) => (
            <article
              key={b.id}
              className="rounded-xl border bg-white overflow-hidden"
            >
              <div className="h-24 bg-[#F7F2EB] grid place-items-center text-xs text-[#87796C]">
                {b.imageUrl ? (
                  <img
                    src={b.imageUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  "No image"
                )}
              </div>
              <div className="p-3">
                <p className="text-sm font-bold">{b.title}</p>
                <p className="text-xs text-[#776A5E]">
                  {b.status} · {b.position}
                </p>
              </div>
            </article>
          ))}
        </div>
      )}
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="New banner"
        description="Homepage placement, validated before submit."
        onSubmit={onSubmit}
        submitLabel={create.isPending ? "Creating…" : "Create"}
        submitPending={create.isPending}
        formClassName="grid gap-3"
      >
        <Form {...form}>
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Title</FormLabel>
                <FormControl>
                  <Input
                    placeholder="Banner title"
                    {...field}
                    className="bg-white"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </Form>
      </FormDialog>
    </section>
  );
}
