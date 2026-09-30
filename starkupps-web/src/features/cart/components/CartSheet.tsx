import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, Minus, Plus, ShoppingBag, X, Tag, UserRound, MapPin } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Pressable } from "@/components/shared/Pressable";
import { AuthDialog } from "@/features/auth/components/AuthDialog";
import { useAuth, useCart, useOutlet } from "@/state";
import { useSavedAddresses } from "@/features/profile/useAddresses";
import type { SavedAddress } from "@/types/profile";
import { displayName, initialsOf } from "@/utils/user";
import { inr } from "@/utils/format";
import { projectEndpoint, springs } from "@/utils/motion";
import { cn } from "@/utils/cn";
import { errorMessage } from "@/utils/errors";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  checkoutDefaults,
  checkoutSchema,
  type CheckoutFormValues,
} from "@/features/checkout/schema";
import { createPublicOrder, fetchCharges, validateCoupon } from "@/api/public";
import { ORDER_TYPE_LABELS, type ChargeQuote, type OrderType } from "@/types/orders";
import type { PublicMenuItem } from "@/types/menu";

/** Cross-sell card shown in the cart footer. */
type UpsellSuggestion = {
  id: number;
  name: string;
  price: number;
  image: string;
  item: PublicMenuItem;
  variant: PublicMenuItem["variants"][number];
};
import { recordOrder } from "@/features/profile/storage";
import { usePublicMenu } from "@/features/menu/usePublicMenu";
import coffeeImg from "@/assets/cat-coffee.jpg";

const orderTypes: { id: OrderType; label: string }[] = [
  { id: "dine-in", label: ORDER_TYPE_LABELS["dine-in"] },
  { id: "takeaway", label: ORDER_TYPE_LABELS.takeaway },
  { id: "delivery", label: ORDER_TYPE_LABELS.delivery },
];

function orderTypeToApi(t: OrderType): "dine_in" | "takeaway" | "delivery" {
  if (t === "dine-in") return "dine_in";
  return t;
}

export function CartSheet() {
  const reduced = useReducedMotion();
  const { open, setOpen, lines, subtotal, setQty, addLine, orderType, setOrderType, clear } =
    useCart();
  const {
    selected: outlet,
    selectedId: outletId,
    outlets,
    setSelectedId,
    isLoading: outletLoading,
  } = useOutlet();
  const menuQ = usePublicMenu();
  const { user } = useAuth();
  const { addresses } = useSavedAddresses(user?.id);
  const [authOpen, setAuthOpen] = useState(false);
  const [addrPick, setAddrPick] = useState<string | null>(null);

  const [checkout, setCheckout] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponValid, setCouponValid] = useState<boolean | null>(null);
  const [couponMsg, setCouponMsg] = useState("");

  // Live charge quote from the gateway (packing/delivery/tax configured in
  // Store settings). Falls back gracefully when offline — the server always
  // recomputes authoritatively at order creation.
  const [quote, setQuote] = useState<ChargeQuote | null>(null);
  useEffect(() => {
    let cancelled = false;
    setQuote(null);
    if (!outletId || lines.length === 0) return;
    const taxable = Math.max(0, subtotal - (couponValid ? couponDiscount : 0));
    const t = setTimeout(() => {
      fetchCharges(outletId, orderTypeToApi(orderType), taxable)
        .then((q) => {
          if (!cancelled) setQuote(q);
        })
        .catch(() => {
          if (!cancelled) setQuote(null);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [outletId, orderType, subtotal, couponDiscount, couponValid, lines.length]);

  const form = useForm<CheckoutFormValues>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: checkoutDefaults[orderType],
    mode: "onBlur",
    reValidateMode: "onChange",
  });

  // Keep form's discriminated field in sync with cart's orderType.
  useEffect(() => {
    const current = form.getValues("orderType");
    if (current !== orderType) {
      form.setValue("orderType", orderType, { shouldValidate: false, shouldDirty: false });
      if (orderType !== "delivery") {
        form.clearErrors("address");
      }
    }
  }, [orderType, form]);

  // Outlet change should reconcile cart: if outlet switched, remind user
  const handleOutletChange = (id: string) => {
    const num = Number(id);
    if (!Number.isFinite(num)) return;
    if (lines.length > 0) {
      toast.message("Outlet changed — cart will be revalidated at checkout.", {
        description: "Prices and availability are outlet-specific.",
      });
    }
    setSelectedId(num);
    setCouponCode("");
    setCouponDiscount(0);
    setCouponValid(null);
    setCouponMsg("");
  };

  const resetCheckout = () => {
    form.reset(checkoutDefaults[orderType]);
    setCheckout(false);
    setAddrPick(null);
  };

  // ── Profile-aware checkout ──────────────────────────────────────────────
  // Signed-in customers get name/phone/address prefilled from their profile
  // so checkout is confirm-and-go. Guests still check out normally.

  const composeAddress = (a: SavedAddress) =>
    `${a.address}${a.landmark ? `, Near ${a.landmark}` : ""}`;

  const profileDefaults = () => {
    if (!user) return null;
    const digits = (user.phone ?? "").replace(/\D/g, "").slice(-10);
    const def = addresses.find((a) => a.isDefault) ?? addresses[0];
    return {
      name: displayName(user),
      phone: digits.length === 10 ? digits : "",
      address: def ? composeAddress(def) : "",
      addressId: def?.id ?? null,
    };
  };

  const handleOpenCheckout = () => {
    if (lines.length === 0) return;
    if (!outletId) {
      toast.error("Select an outlet first.");
      return;
    }
    const base = checkoutDefaults[orderType];
    const p = profileDefaults();
    setAddrPick(p?.addressId ?? null);
    form.reset(
      p
        ? {
            ...base,
            name: p.name,
            phone: p.phone,
            address: orderType === "delivery" ? p.address : "",
          }
        : base,
    );
    setCheckout(true);
  };

  // After signing in mid-checkout (via the nudge dialog), fill only the
  // fields the customer hasn't already typed into.
  const fillEmptyFromProfile = () => {
    const p = profileDefaults();
    if (!p) return;
    if (!form.getValues("name")) form.setValue("name", p.name);
    if (!form.getValues("phone")) form.setValue("phone", p.phone);
    if (orderType === "delivery" && !form.getValues("address") && p.address) {
      form.setValue("address", p.address, { shouldValidate: true });
      setAddrPick(p.addressId);
    }
  };

  const handleValidateCoupon = async () => {
    const code = couponCode.trim();
    if (!code) {
      setCouponValid(false);
      setCouponMsg("Enter a coupon code.");
      return;
    }
    if (!outletId) {
      setCouponValid(false);
      setCouponMsg("Select an outlet first.");
      return;
    }
    try {
      const itemsForCoupon = lines.map((l) => ({
        menuItemId: l.menuItemId,
        categoryId: null,
        quantity: l.qty,
        lineTotal: l.unitPrice * l.qty,
      }));
      const phone = form.getValues("phone")?.trim() || undefined;
      const result = await validateCoupon({
        code,
        outletId,
        orderType: orderTypeToApi(orderType),
        customerPhone: phone || null,
        orderAmount: subtotal,
        items: itemsForCoupon,
      });

      if (result.valid) {
        const discount = result.discount ?? 0;
        setCouponValid(true);
        setCouponDiscount(discount);
        setCouponMsg(`Coupon applied — ${inr(discount)} off.`);
        toast.success(`Coupon ${code.toUpperCase()} applied`, {
          description: `${inr(discount)} off`,
        });
      } else {
        setCouponValid(false);
        setCouponDiscount(0);
        setCouponMsg(result.reason ?? "Invalid coupon.");
      }
    } catch (error: unknown) {
      setCouponValid(false);
      setCouponDiscount(0);
      setCouponMsg(errorMessage(error) ?? "Failed to validate coupon.");
    }
  };

  const onSubmit = async (values: CheckoutFormValues) => {
    const parsed = checkoutSchema.parse(values) as unknown as {
      orderType: OrderType;
      name: string;
      phone: string;
      address: string;
      notes: string;
    };

    if (!outletId) {
      toast.error("Please select an outlet.");
      return;
    }
    if (lines.length === 0) {
      toast.error("Cart is empty.");
      return;
    }

    // Client-side comingSoon guard — server also enforces, but give immediate feedback
    if (menuQ.data?.items) {
      const comingSoonIds = new Set(
        menuQ.data.items
          .filter((item) =>
            Boolean(item.effectiveComingSoon || item.comingSoon || item.categoryComingSoon),
          )
          .map((item) => item.id),
      );
      const blocked = lines.find((l) => comingSoonIds.has(l.menuItemId));
      if (blocked) {
        toast.error("Some items in your cart are COMING SOON and cannot be ordered yet.", {
          description: `${blocked.name}${blocked.variantName ? ` — ${blocked.variantName}` : ""} is not yet available. Please remove it.`,
        });
        return;
      }
    }

    const idempotencyKey = `web-${parsed.phone}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    try {
      const order = await createPublicOrder({
        outletId,
        type: orderTypeToApi(parsed.orderType),
        customer: {
          name: parsed.name,
          phone: parsed.phone,
          address: parsed.address || null,
          email: user?.email?.trim() || null,
        },
        notes: parsed.notes || null,
        couponCode: couponValid ? couponCode.trim().toUpperCase() : null,
        idempotencyKey,
        items: lines.map((l) => ({
          menuItemId: l.menuItemId,
          variantId: l.variantId,
          quantity: l.qty,
          selectedModifiers: l.modifierPayload,
        })),
      });

      const summary =
        parsed.orderType === "delivery"
          ? `Delivery to ${parsed.address}`
          : parsed.orderType === "dine-in"
            ? `Dine-in at ${outlet?.name ?? "StarKupps"}`
            : `Takeaway — ready in ~${outlet?.name ? "15" : "9"} min`;

      toast.success(`Order #${order.orderNumber} confirmed, ${parsed.name}!`, {
        description: `${lines.length} item${lines.length === 1 ? "" : "s"} · ${inr(order.total)} · ${summary}`,
      });

      // Persist to the dashboard's order history (device-level, works signed-out too)
      recordOrder({
        id: order.id,
        orderNumber: order.orderNumber,
        total: order.total,
        itemCount: lines.length,
        type: parsed.orderType,
        outletName: outlet?.name ?? undefined,
        phone: parsed.phone,
        email: user?.email ?? undefined,
      });

      clear();
      setCouponCode("");
      setCouponDiscount(0);
      setCouponValid(null);
      setCouponMsg("");
      form.reset(checkoutDefaults[parsed.orderType]);
      setCheckout(false);
      setOpen(false);
    } catch (error: unknown) {
      const msg = errorMessage(error) ?? "Failed to place order.";
      // Handle specific server errors with actionable guidance
      if (/COMING SOON/i.test(msg)) {
        toast.error("Coming soon — cannot be ordered yet.", { description: msg });
      } else if (/not available/i.test(msg)) {
        toast.error("Some items are unavailable at this outlet.", { description: msg });
      } else if (/coupon/i.test(msg)) {
        toast.error("Coupon error", { description: msg });
        setCouponValid(false);
        setCouponMsg(msg);
      } else if (/minimum order/i.test(msg)) {
        toast.error("Minimum order not met", { description: msg });
      } else {
        toast.error("Order failed", { description: msg });
      }
    }
  };

  const handleOrderTypeSwitch = (next: OrderType) => {
    setOrderType(next);
    form.setValue("orderType", next, { shouldValidate: false });
    if (next !== "delivery") form.clearErrors("address");
  };

  const displayTotal = useMemo(() => {
    const taxable = Math.max(0, subtotal - (couponValid ? couponDiscount : 0));
    // Prefer the live gateway quote (configurable charges + taxes); fall back
    // to items-minus-coupon while it loads or when offline.
    if (quote) return quote.total;
    return taxable;
  }, [subtotal, couponDiscount, couponValid, quote]);

  /**
   * Cross-sell suggestion: the first cold coffee on the live menu, else the
   * first item. Derived from the admin menu — there is no hardcoded upsell.
   */
  const upsellItem = useMemo<UpsellSuggestion | null>(() => {
    const items = menuQ.data?.items ?? [];
    if (items.length === 0) return null;

    const item = items.find((entry) => /cold.*coffee/i.test(entry.name)) ?? items[0];
    const variant = item?.variants.find((v) => v.isDefault) ?? item?.variants[0];
    if (!item || !variant) return null;

    return {
      id: item.id,
      name: item.name,
      price: variant.effectivePrice,
      image: item.imageUrl ?? coffeeImg,
      item,
      variant,
    };
  }, [menuQ.data]);

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.aside
            key="cart"
            className="material fixed inset-x-0 bottom-0 z-50 max-h-[85svh] overflow-hidden rounded-t-3xl border-t border-border shadow-sheet sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[26rem] sm:max-h-none sm:rounded-t-none sm:rounded-l-3xl sm:border-l"
            initial={reduced ? { opacity: 0 } : { y: "100%" }}
            animate={reduced ? { opacity: 1 } : { y: 0 }}
            exit={reduced ? { opacity: 0 } : { y: "100%" }}
            transition={reduced ? { duration: 0.18 } : springs.sheet}
            drag={reduced ? false : "y"}
            dragDirectionLock
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.9 }}
            onDragEnd={(_, info) => {
              const projected = projectEndpoint(info.offset.y, info.velocity.y);
              if (projected > 180) {
                setOpen(false);
                resetCheckout();
              }
            }}
            role="dialog"
            aria-label="Your cart"
          >
            <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-muted-foreground/40 sm:hidden" />
            <div className="flex items-center justify-between px-5 pb-3 pt-3">
              <div className="flex items-center gap-2">
                {checkout && (
                  <Pressable
                    onClick={resetCheckout}
                    aria-label="Back to cart"
                    className="grid size-8 place-items-center rounded-full border border-border bg-card"
                  >
                    <ArrowLeft className="size-4" />
                  </Pressable>
                )}
                <h2 className="text-xl">{checkout ? "Your details" : "Your cart"}</h2>
              </div>
              <Pressable
                onClick={() => {
                  setOpen(false);
                  resetCheckout();
                }}
                aria-label="Close cart"
                className="grid size-11 place-items-center rounded-full border border-border bg-card"
              >
                <X className="size-5" />
              </Pressable>
            </div>

            {!checkout ? (
              <>
                <div className="max-h-[52svh] overflow-y-auto px-5 sm:max-h-[calc(100svh-19rem)]">
                  {/* Outlet selector — minimal, design-preserving */}
                  <div className="mb-4">
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Outlet
                    </label>
                    {outletLoading ? (
                      <div className="h-11 animate-pulse rounded-xl bg-muted" />
                    ) : outlets.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No outlets available. Orders will be queued centrally.
                      </p>
                    ) : (
                      <select
                        value={outletId ?? ""}
                        onChange={(e) => handleOutletChange(e.target.value)}
                        className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm"
                      >
                        {outlets.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name} {o.city ? `— ${o.city}` : ""}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div className="mb-4 grid grid-cols-3 gap-2 rounded-full border border-border bg-secondary p-1">
                    {orderTypes.map((t) => (
                      <Pressable
                        key={t.id}
                        onPointerDown={() => setOrderType(t.id)}
                        aria-pressed={orderType === t.id}
                        className={cn(
                          "min-h-11 rounded-full text-sm font-medium",
                          orderType === t.id
                            ? "bg-primary text-primary-foreground shadow-chip"
                            : "text-muted-foreground",
                        )}
                      >
                        {t.label}
                      </Pressable>
                    ))}
                  </div>

                  {lines.length === 0 && (
                    <p className="py-10 text-center text-sm text-muted-foreground">
                      Nothing here yet. The cold coffee is a good place to start.
                    </p>
                  )}

                  <ul className="space-y-3">
                    {lines.map((l) => (
                      <motion.li
                        key={l.key}
                        layout
                        transition={springs.section}
                        className="flex gap-3 rounded-2xl border border-border bg-card p-3 shadow-chip"
                      >
                        <img
                          src={l.image}
                          alt={l.name}
                          loading="lazy"
                          className="size-16 rounded-xl object-cover"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">
                            {l.name}
                            {l.variantName ? ` · ${l.variantName}` : ""}
                          </p>
                          {l.variantQuantity != null && l.variantUnit && (
                            <p className="text-[11px] text-muted-foreground">
                              {l.variantQuantity} {l.variantUnit}
                            </p>
                          )}
                          {l.optionLabels.length > 0 && (
                            <p className="truncate text-xs text-muted-foreground">
                              {l.optionLabels.join(" · ")}
                            </p>
                          )}
                          <p className="mt-1 text-sm font-semibold tabular-nums text-primary">
                            {inr(l.unitPrice * l.qty)}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 self-center rounded-full border border-border bg-secondary p-1">
                          <Pressable
                            onPointerDown={() => setQty(l.key, l.qty - 1)}
                            aria-label={`Remove one ${l.name}`}
                            className="grid size-11 place-items-center rounded-full"
                          >
                            <Minus className="size-4" />
                          </Pressable>
                          <span className="w-6 text-center text-sm font-semibold tabular-nums">
                            {l.qty}
                          </span>
                          <Pressable
                            onPointerDown={() => setQty(l.key, l.qty + 1)}
                            aria-label={`Add one ${l.name}`}
                            className="grid size-11 place-items-center rounded-full"
                          >
                            <Plus className="size-4" />
                          </Pressable>
                        </div>
                      </motion.li>
                    ))}
                  </ul>

                  {/* Coupon entry — design-preserving, minimal */}
                  {lines.length > 0 && (
                    <div className="mt-4 rounded-2xl border border-border bg-card p-3">
                      <div className="flex items-center gap-2">
                        <Tag className="size-4 text-muted-foreground" />
                        <span className="text-sm font-medium">Coupon</span>
                        {couponValid && (
                          <span className="text-xs font-semibold text-green-600">Applied</span>
                        )}
                      </div>
                      <div className="mt-2 flex gap-2">
                        <Input
                          placeholder="WELCOME50"
                          value={couponCode}
                          onChange={(e) => {
                            setCouponCode(e.target.value.toUpperCase());
                            setCouponValid(null);
                            setCouponMsg("");
                            setCouponDiscount(0);
                          }}
                          className="h-11 flex-1 rounded-xl border-border bg-card uppercase"
                          maxLength={40}
                        />
                        <Pressable
                          onClick={handleValidateCoupon}
                          className="min-h-11 rounded-xl bg-secondary px-5 text-sm font-semibold"
                        >
                          Apply
                        </Pressable>
                      </div>
                      {couponMsg && (
                        <p
                          className={cn(
                            "mt-2 text-xs",
                            couponValid ? "text-green-600" : "text-destructive",
                          )}
                        >
                          {couponMsg}
                        </p>
                      )}
                    </div>
                  )}

                  {lines.length > 0 && upsellItem && (
                    <div className="mt-4 flex items-center justify-between rounded-2xl border border-dashed border-border p-3">
                      <p className="text-sm">
                        Add {upsellItem.name} for {inr(upsellItem.price)}
                        <span className="block text-xs text-muted-foreground">
                          Goes with everything on the menu.
                        </span>
                      </p>
                      <Pressable
                        onClick={() => {
                          {
                            const item = upsellItem.item;
                            const v = upsellItem.variant;
                            const firstGroup = item.modifierGroups[0];
                            const firstOption = firstGroup?.options[0];
                            addLine({
                              product: { id: item.id, name: item.name, image: upsellItem.image },
                              unitPrice: v.effectivePrice,
                              optionLabels: firstOption ? [firstOption.name] : [],
                              quantity: 1,
                              modifiers:
                                firstGroup && firstOption
                                  ? [
                                      {
                                        name: firstOption.name,
                                        priceDelta: firstOption.priceDelta,
                                        groupId: firstGroup.id,
                                        optionId: firstOption.id,
                                      },
                                    ]
                                  : [],
                              variant: {
                                id: v.id,
                                name: v.name,
                                quantity: v.quantity,
                                unit: v.unit,
                                price: v.effectivePrice,
                                sku: v.sku,
                              },
                            });
                          }
                          setOpen(true);
                        }}
                        className="min-h-11 rounded-full border border-primary px-4 text-sm font-semibold text-primary"
                      >
                        Add
                      </Pressable>
                    </div>
                  )}

                  {lines.length > 0 && (
                    <Pressable
                      onClick={() => clear()}
                      className="mx-auto mt-3 min-h-11 text-xs font-medium text-muted-foreground underline"
                    >
                      Clear cart
                    </Pressable>
                  )}
                </div>

                <div className="border-t border-border p-4">
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {orderType === "delivery"
                        ? `Incl. packing${quote ? ` ${inr(quote.packing)}` : ""} + delivery${quote ? ` ${inr(quote.delivery)}` : ""}`
                        : orderType === "takeaway"
                          ? `Incl. packing${quote ? ` ${inr(quote.packing)}` : ""}`
                          : "Dine-in, no packing charge"}
                    </span>
                    <span className="text-base font-semibold tabular-nums">{inr(subtotal)}</span>
                  </div>
                  {couponValid && couponDiscount > 0 && (
                    <div className="mb-3 flex items-center justify-between text-sm">
                      <span className="text-green-600">
                        Coupon {couponCode.trim().toUpperCase()}
                      </span>
                      <span className="font-semibold tabular-nums text-green-600">
                        -{inr(couponDiscount)}
                      </span>
                    </div>
                  )}
                  {quote && quote.tax > 0 && (
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        Taxes
                        {quote.taxLines.length
                          ? ` (${quote.taxLines.map((t) => `${t.name} ${t.rate}%`).join(", ")})`
                          : ""}
                      </span>
                      <span className="tabular-nums">{inr(quote.tax)}</span>
                    </div>
                  )}
                  <div className="mb-3 flex items-center justify-between text-sm font-semibold">
                    <span>Total</span>
                    <span className="text-base tabular-nums">{inr(displayTotal)}</span>
                  </div>
                  {lines.length > 0 && !user && (
                    <button
                      type="button"
                      onClick={() => setAuthOpen(true)}
                      className="mb-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 text-sm font-semibold text-primary"
                    >
                      <UserRound className="size-4" />
                      Sign in for faster checkout
                    </button>
                  )}
                  <Pressable
                    disabled={lines.length === 0 || !outletId}
                    onClick={handleOpenCheckout}
                    className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-raised disabled:opacity-40"
                  >
                    <ShoppingBag className="size-5" />
                    Continue to details
                  </Pressable>
                  <p className="mt-2 text-center text-xs text-muted-foreground">
                    Next: name, phone and delivery address
                  </p>
                  {!outletId && outlets.length > 0 && (
                    <p className="mt-1 text-center text-xs text-destructive">
                      Select an outlet to continue.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(onSubmit)}
                  noValidate
                  className="flex max-h-[calc(85svh-4rem)] flex-col sm:max-h-[calc(100svh-4rem)]"
                >
                  <div className="max-h-[52svh] overflow-y-auto px-5 pb-4 sm:max-h-[calc(100svh-13rem)]">
                    <p className="mb-4 text-sm text-muted-foreground">
                      We need your details to confirm the order and send updates.{" "}
                      {orderType === "delivery" ? "Delivery needs a full address." : ""}
                    </p>

                    {user ? (
                      <div className="mb-4 flex items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-chip">
                        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 font-display text-sm font-semibold text-primary">
                          {initialsOf(displayName(user))}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">
                            Ordering as {displayName(user)}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {user.email ?? user.phone ?? "Signed in"}
                          </p>
                        </div>
                        <Link
                          to="/account"
                          onClick={() => setOpen(false)}
                          className="flex min-h-9 shrink-0 items-center rounded-full px-3 text-xs font-semibold text-primary hover:underline"
                        >
                          Manage
                        </Link>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setAuthOpen(true)}
                        className="mb-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 text-sm font-semibold text-primary"
                      >
                        <UserRound className="size-4" />
                        Sign in — details fill themselves in
                      </button>
                    )}

                    <div className="mb-4 flex items-center justify-between rounded-xl border border-border bg-secondary px-3 py-2 text-xs">
                      <span className="text-muted-foreground">Outlet</span>
                      <span className="font-semibold">{outlet?.name ?? "—"}</span>
                    </div>

                    <div className="mb-4 grid grid-cols-3 gap-2 rounded-full border border-border bg-secondary p-1">
                      {orderTypes.map((t) => (
                        <Pressable
                          key={t.id}
                          type="button"
                          onPointerDown={() => handleOrderTypeSwitch(t.id)}
                          aria-pressed={orderType === t.id}
                          className={cn(
                            "min-h-11 rounded-full text-sm font-medium",
                            orderType === t.id
                              ? "bg-primary text-primary-foreground shadow-chip"
                              : "text-muted-foreground",
                          )}
                        >
                          {t.label}
                        </Pressable>
                      ))}
                    </div>

                    <div className="space-y-4">
                      <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              Full name <span className="text-destructive">*</span>
                            </FormLabel>
                            <FormControl>
                              <Input
                                placeholder="e.g. Aman Kumar"
                                autoComplete="name"
                                aria-required
                                maxLength={60}
                                className={cn(
                                  "h-11 rounded-xl border-border bg-card",
                                  form.formState.errors.name &&
                                    "border-destructive focus-visible:ring-destructive",
                                )}
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="phone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              Phone number <span className="text-destructive">*</span>
                            </FormLabel>
                            <FormControl>
                              <Input
                                placeholder="10-digit mobile number"
                                inputMode="numeric"
                                autoComplete="tel"
                                aria-required
                                maxLength={10}
                                pattern="[6-9][0-9]{9}"
                                className={cn(
                                  "h-11 rounded-xl border-border bg-card",
                                  form.formState.errors.phone &&
                                    "border-destructive focus-visible:ring-destructive",
                                )}
                                value={field.value}
                                onChange={(e) => {
                                  const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
                                  field.onChange(digits);
                                }}
                                onBlur={field.onBlur}
                                name={field.name}
                                ref={field.ref}
                              />
                            </FormControl>
                            {form.formState.errors.phone ? (
                              <FormMessage />
                            ) : (
                              <p className="text-[0.8rem] text-muted-foreground">
                                We'll send order updates on this number.
                              </p>
                            )}
                          </FormItem>
                        )}
                      />

                      {orderType === "delivery" && (
                        <>
                          {user && addresses.length > 0 && (
                            <div className="space-y-2">
                              <p className="text-sm font-medium">Deliver to</p>
                              <div className="grid gap-2">
                                {addresses.map((a) => {
                                  const selected = addrPick === a.id;
                                  return (
                                    <button
                                      key={a.id}
                                      type="button"
                                      onClick={() => {
                                        setAddrPick(a.id);
                                        form.setValue("address", composeAddress(a), {
                                          shouldValidate: true,
                                          shouldDirty: true,
                                        });
                                      }}
                                      aria-pressed={selected}
                                      className={cn(
                                        "flex min-h-11 items-start gap-2 rounded-xl border p-3 text-left text-sm transition-colors",
                                        selected
                                          ? "border-primary bg-primary/5"
                                          : "border-border bg-card",
                                      )}
                                    >
                                      <MapPin
                                        className={cn(
                                          "mt-0.5 size-4 shrink-0",
                                          selected ? "text-primary" : "text-muted-foreground",
                                        )}
                                      />
                                      <span className="min-w-0">
                                        <span className="font-semibold">
                                          {a.label}
                                          {a.isDefault && (
                                            <span className="text-muted-foreground">
                                              {" "}
                                              · Default
                                            </span>
                                          )}
                                        </span>
                                        <span className="block truncate text-xs text-muted-foreground">
                                          {a.name} · {composeAddress(a)}
                                        </span>
                                      </span>
                                    </button>
                                  );
                                })}
                                <button
                                  type="button"
                                  onClick={() => setAddrPick(null)}
                                  aria-pressed={addrPick === null}
                                  className={cn(
                                    "flex min-h-11 items-center justify-center rounded-xl border text-sm font-medium transition-colors",
                                    addrPick === null
                                      ? "border-primary bg-primary/5 text-primary"
                                      : "border-dashed border-border text-muted-foreground",
                                  )}
                                >
                                  Write a different address
                                </button>
                              </div>
                            </div>
                          )}
                          <FormField
                            control={form.control}
                            name="address"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>
                                  Delivery address <span className="text-destructive">*</span>
                                </FormLabel>
                                <FormControl>
                                  <Textarea
                                    placeholder="House no., street, area, landmark — Munger"
                                    rows={3}
                                    aria-required
                                    maxLength={300}
                                    className={cn(
                                      "min-h-[84px] rounded-xl border-border bg-card",
                                      form.formState.errors.address &&
                                        "border-destructive focus-visible:ring-destructive",
                                    )}
                                    {...field}
                                    onChange={(e) => {
                                      // Manual edits detach from the picked saved address
                                      if (addrPick !== null) setAddrPick(null);
                                      field.onChange(e);
                                    }}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </>
                      )}

                      <FormField
                        control={form.control}
                        name="notes"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Order notes (optional)</FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder={
                                  orderType === "dine-in"
                                    ? "Table preference, spice level, etc."
                                    : orderType === "delivery"
                                      ? "Delivery instructions, e.g. leave at gate"
                                      : "Any packing note"
                                }
                                rows={2}
                                maxLength={300}
                                className="min-h-[64px] rounded-xl border-border bg-card"
                                {...field}
                              />
                            </FormControl>
                            <p className="text-xs text-muted-foreground">
                              {(field.value ?? "").length}/300
                            </p>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <div className="rounded-2xl border border-border bg-secondary p-3">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">
                            {lines.length} {lines.length === 1 ? "item" : "items"} · {orderType}{" "}
                            {outlet ? `· ${outlet.name}` : ""}
                          </span>
                          <span className="font-semibold tabular-nums">{inr(subtotal)}</span>
                        </div>
                        {couponValid && couponDiscount > 0 && (
                          <div className="mt-1 flex items-center justify-between text-sm">
                            <span className="text-green-600">
                              Coupon {couponCode.toUpperCase()} · -{inr(couponDiscount)}
                            </span>
                            <span className="font-semibold tabular-nums">{inr(displayTotal)}</span>
                          </div>
                        )}
                        <p className="mt-1 text-xs text-muted-foreground">
                          {orderType === "delivery"
                            ? `Incl. packing${quote ? ` ${inr(quote.packing)}` : ""} + delivery${quote ? ` ${inr(quote.delivery)}` : " ₹29"}${quote && quote.tax > 0 ? ` + taxes ${inr(quote.tax)}` : ""}`
                            : orderType === "takeaway"
                              ? `Incl. packing${quote ? ` ${inr(quote.packing)}` : " ₹15"}${quote && quote.tax > 0 ? ` + taxes ${inr(quote.tax)}` : ""}`
                              : "No packing charge for dine-in"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-border p-4">
                    <button
                      type="submit"
                      disabled={form.formState.isSubmitting}
                      className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-raised disabled:opacity-50"
                    >
                      <ShoppingBag className="size-5" />
                      {form.formState.isSubmitting
                        ? "Placing order..."
                        : `Confirm & Pay ${inr(displayTotal)}`}
                    </button>
                    <Pressable
                      type="button"
                      onClick={resetCheckout}
                      className="mx-auto mt-2 flex min-h-11 w-full items-center justify-center text-sm font-medium text-muted-foreground"
                    >
                      Back to cart
                    </Pressable>
                  </div>
                </form>
              </Form>
            )}
          </motion.aside>
        )}
      </AnimatePresence>
      {/* Sign-in dialog outlives the sheet so login isn't lost if the cart closes */}
      <AuthDialog
        open={authOpen}
        onOpenChange={(o) => {
          setAuthOpen(o);
          if (!o && checkout) fillEmptyFromProfile();
        }}
      />
    </>
  );
}
