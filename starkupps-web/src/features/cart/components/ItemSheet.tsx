import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Minus, Plus, X } from "lucide-react";
import { Pressable } from "@/components/shared/Pressable";
import { useCart } from "@/state";
import { inr } from "@/utils/format";
import { springs } from "@/utils/motion";
import { cn } from "@/utils/cn";
import type { DisplayMenuItem } from "@/types/menu";
import type { SelectedModifier } from "@/types/orders";

export function ItemSheet({
  item,
  origin,
  onClose,
}: {
  item: DisplayMenuItem | null;
  origin: { x: number; y: number } | null;
  onClose: () => void;
}) {
  const reduced = useReducedMotion();
  const { addLine, setOpen } = useCart();
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(null);
  const [qty, setQty] = useState(1);

  useEffect(() => {
    if (!item) return;
    setQty(1);
    setSelected(Object.fromEntries((item.groups ?? []).map((g) => [g.id, g.options[0]!.id])));
    const vs = item.variants ?? [];
    if (vs.length) {
      const def = vs.find((v) => v.isDefault) ?? vs.find((v) => v.available) ?? vs[0];
      setSelectedVariantId(def?.id ?? null);
    } else setSelectedVariantId(null);
  }, [item]);

  const selectedVariant = useMemo(() => {
    if (!item?.variants?.length) return null;
    return item.variants.find((v) => v.id === selectedVariantId) ?? item.variants[0] ?? null;
  }, [item, selectedVariantId]);

  const { unitPrice, labels, payload } = useMemo(() => {
    const empty = { unitPrice: 0, labels: [] as string[], payload: [] as SelectedModifier[] };
    if (!item || !selectedVariant) return empty;

    let price = selectedVariant.effectivePrice;
    const labels: string[] = [];
    const payload: SelectedModifier[] = [];
    for (const g of item.groups ?? []) {
      const opt = g.options.find((o) => o.id === selected[g.id]) ?? g.options[0]!;
      price += opt.delta;
      labels.push(opt.label);
      payload.push({
        name: opt.label,
        priceDelta: opt.delta,
        groupId: opt.groupId,
        optionId: opt.optionId,
      });
    }
    return { unitPrice: price, labels, payload };
  }, [item, selected, selectedVariant]);

  const isComingSoon = Boolean(
    item?.effectiveComingSoon || item?.comingSoon || item?.categoryComingSoon,
  );
  const variantUnavailable = isComingSoon || !selectedVariant || !selectedVariant.available;
  const noVariantSelected = !selectedVariant;
  const transformOrigin = origin ? `${origin.x}px ${origin.y}px` : "center bottom";

  return (
    <AnimatePresence>
      {item && (
        <>
          <motion.div
            key="scrim"
            className="fixed inset-0 z-40 bg-foreground/45"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <motion.div
            key="sheet"
            className="fixed inset-x-0 bottom-0 z-50 max-h-[88svh] overflow-y-auto rounded-t-3xl border border-border bg-card shadow-sheet sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[27rem] sm:max-h-none sm:rounded-t-none sm:rounded-l-3xl"
            style={{ transformOrigin }}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 40, scale: 0.96 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 40, scale: 0.96 }}
            transition={reduced ? { duration: 0.18 } : springs.sheet}
            role="dialog"
            aria-modal="true"
            aria-label={item.name}
          >
            <div className="relative overflow-hidden">
              <img
                src={item.image}
                alt={item.name}
                loading="lazy"
                className={cn(
                  "h-44 w-full object-cover sm:h-56",
                  isComingSoon && "blur-[8px] scale-105",
                )}
              />
              {isComingSoon && (
                <div className="absolute inset-0 grid place-items-center bg-background/45 backdrop-blur-[2px]">
                  <span className="rounded-full bg-foreground px-4 py-1.5 text-xs font-extrabold uppercase tracking-[0.14em] text-background shadow-lg">
                    Coming Soon
                  </span>
                </div>
              )}
              <Pressable
                onClick={onClose}
                aria-label="Close"
                className="material absolute right-3 top-3 grid size-11 place-items-center rounded-full border border-border bg-card/90 backdrop-blur"
              >
                <X className="size-5" />
              </Pressable>
            </div>

            <div className="space-y-6 p-5 pb-32">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-2xl">{item.name}</h2>
                  {isComingSoon && (
                    <span className="rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-primary-foreground">
                      Coming Soon
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{item.desc}</p>
                {isComingSoon && (
                  <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                    This item is coming soon — it’s visible for preview but cannot be ordered yet.
                  </p>
                )}
                {item.allergens && (
                  <p className="text-xs text-muted-foreground">{item.allergens}</p>
                )}
              </div>

              {(item.variants ?? []).length > 0 && (
                <div className="space-y-3">
                  <p className="eyebrow text-muted-foreground">Size</p>
                  <div className="grid grid-cols-1 gap-2">
                    {item.variants!.map((v) => (
                      <Pressable
                        key={v.id}
                        onPointerDown={() => v.available && setSelectedVariantId(v.id)}
                        aria-pressed={selectedVariantId === v.id}
                        disabled={!v.available}
                        className={cn(
                          "flex items-center justify-between rounded-xl border px-3 py-3 text-sm font-medium",
                          !v.available && "opacity-50 cursor-not-allowed bg-muted",
                          v.available && selectedVariantId === v.id
                            ? "border-primary bg-primary text-primary-foreground shadow-chip"
                            : v.available
                              ? "border-border bg-secondary text-secondary-foreground"
                              : "",
                        )}
                      >
                        <span className="flex flex-col items-start">
                          <span className="font-semibold">{v.name}</span>
                          {v.quantity != null && v.unit && (
                            <span className="text-[11px] opacity-80">
                              {v.quantity} {v.unit}
                            </span>
                          )}
                          {!v.available && <span className="text-[10px]">Unavailable</span>}
                        </span>
                        <span className="tabular-nums font-semibold">{inr(v.effectivePrice)}</span>
                      </Pressable>
                    ))}
                  </div>
                  {isComingSoon ? (
                    <p className="text-xs font-semibold text-primary">
                      Coming soon — ordering is disabled.
                    </p>
                  ) : (
                    variantUnavailable && (
                      <p className="text-xs text-destructive">
                        This size is currently unavailable.
                      </p>
                    )
                  )}
                </div>
              )}

              {(item.groups ?? []).map((g) => (
                <div key={g.id} className="space-y-3">
                  <p className="eyebrow text-muted-foreground">{g.label}</p>
                  <div className="grid grid-cols-3 gap-2">
                    {g.options.map((o) => (
                      <Pressable
                        key={o.id}
                        onPointerDown={() => setSelected((s) => ({ ...s, [g.id]: o.id }))}
                        aria-pressed={selected[g.id] === o.id}
                        className={cn(
                          "min-h-11 rounded-xl border px-2 py-2 text-sm font-medium",
                          selected[g.id] === o.id
                            ? "border-primary bg-primary text-primary-foreground shadow-chip"
                            : "border-border bg-secondary text-secondary-foreground",
                        )}
                      >
                        {o.label}
                        {o.delta > 0 && (
                          <span className="block text-[11px] opacity-80">+{inr(o.delta)}</span>
                        )}
                      </Pressable>
                    ))}
                  </div>
                </div>
              ))}

              <div className="flex items-center justify-between">
                <p className="eyebrow text-muted-foreground">Quantity</p>
                <div className="flex items-center gap-1 rounded-full border border-border bg-secondary p-1">
                  <Pressable
                    onPointerDown={() => setQty((q) => Math.max(1, q - 1))}
                    aria-label="Decrease quantity"
                    className="grid size-11 place-items-center rounded-full"
                  >
                    <Minus className="size-4" />
                  </Pressable>
                  <span className="w-8 text-center text-base font-semibold tabular-nums">
                    {qty}
                  </span>
                  <Pressable
                    onPointerDown={() => setQty((q) => q + 1)}
                    aria-label="Increase quantity"
                    className="grid size-11 place-items-center rounded-full"
                  >
                    <Plus className="size-4" />
                  </Pressable>
                </div>
              </div>
            </div>

            <div className="material fixed inset-x-0 bottom-0 border-t border-border p-4 sm:absolute">
              <Pressable
                disabled={variantUnavailable || noVariantSelected}
                onClick={() => {
                  if (isComingSoon) return;
                  if (!selectedVariant) return;
                  const variant = {
                    id: selectedVariant.id,
                    name: selectedVariant.name,
                    quantity: selectedVariant.quantity,
                    unit: selectedVariant.unit,
                    price: selectedVariant.effectivePrice,
                  };
                  addLine({
                    product: { id: Number(item.id), name: item.name, image: item.image },
                    unitPrice,
                    optionLabels: labels,
                    quantity: qty,
                    modifiers: payload,
                    variant,
                  });
                  onClose();
                  setOpen(true);
                }}
                className={cn(
                  "flex min-h-14 w-full items-center justify-between rounded-2xl px-5 text-base font-semibold shadow-raised",
                  variantUnavailable || noVariantSelected
                    ? "bg-muted text-muted-foreground cursor-not-allowed"
                    : "bg-primary text-primary-foreground",
                )}
              >
                <span>
                  {noVariantSelected
                    ? "Select size"
                    : isComingSoon
                      ? "Coming Soon"
                      : variantUnavailable
                        ? "Unavailable"
                        : `Add ${qty > 1 ? `${qty} ` : ""}to cart`}
                </span>
                <span className="tabular-nums">
                  {selectedVariant ? inr(unitPrice * qty) : inr(0)}
                </span>
              </Pressable>
              {selectedVariant && (
                <p className="mt-2 text-center text-[11px] text-muted-foreground">
                  {selectedVariant.name}
                  {selectedVariant.quantity
                    ? ` · ${selectedVariant.quantity} ${selectedVariant.unit ?? ""}`
                    : ""}{" "}
                  · {inr(selectedVariant.effectivePrice)}
                </p>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
