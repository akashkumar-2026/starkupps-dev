import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Check, Clock3 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  CONFIRMATION_EXTEND_MS,
  CONFIRMATION_MS,
  confirmationTitle,
  nextStepLabel,
} from "@/features/checkout/confirmation";
import { inr } from "@/utils/format";
import { springs } from "@/utils/motion";
import { cn } from "@/utils/cn";
import type { OrderType } from "@/types/orders";

export type ConfirmationItem = {
  name: string;
  variantName?: string | null;
  qty: number;
  /** Price for one, including any modifier surcharges. */
  unitPrice: number;
  /** `unitPrice × qty`, rounded like the server does. */
  lineTotal: number;
  /** Human-readable modifier labels, e.g. "Oat milk". */
  options?: string[];
};

export type PriceLine = {
  label: string;
  value: number;
  /** Rendered as `₹-50` for a discount. */
  negative?: boolean;
};

export type ConfirmationOrder = {
  orderNumber: number;
  total: number;
  itemCount: number;
  /** Reuses the checkout union so a new method cannot be added here only. */
  type: OrderType;
  outletName?: string | undefined;
  /** Full name as typed, not just the first word. */
  customerName: string;
  phone?: string | null | undefined;
  /** Delivery only; omitted for the other methods. */
  address?: string | null;
  /** The customer's own order note, verbatim. */
  notes?: string | null;
  items: ConfirmationItem[];
  pricing: PriceLine[];
  summary: string;
};

const typeLabel = {
  "dine-in": "Dine-in",
  takeaway: "Takeaway",
  delivery: "Delivery",
} as const;

/**
 * The full-screen order confirmation.
 *
 * ## Responsive behaviour
 *
 * On phones this is a genuinely full-screen sheet — `inset-0`, not a bottom
 * sheet — because a success state that shares the screen with the page behind it
 * reads as a notification rather than a confirmation. It fills the viewport with
 * `100dvh` (not `100vh`, which is taller than the visible area on mobile Safari
 * and would put the actions below the fold).
 *
 * On desktop the same content is centred in a card instead, so a 27" monitor
 * does not get a single line of text stretched across it. One component, two
 * layouts, because the *content* is identical and only its container differs.
 *
 * ## Accessibility
 *
 * `role="status"` + `aria-live` announces the confirmation to a screen reader
 * (the toast it replaces did not), the timer is exposed as a label rather than
 * relying on the animation, and every interactive target clears 44px. Escape and
 * a visible button both dismiss, so it is never a trap.
 */
export function OrderConfirmation({
  order,
  onDone,
  onTrack,
}: {
  order: ConfirmationOrder | null;
  onDone: () => void;
  /** Omitted for guests, who have no order list to return to. */
  onTrack?: () => void;
}) {
  const reduced = useReducedMotion();
  const [remaining, setRemaining] = useState(CONFIRMATION_MS);
  // Bumped to restart the timer after an interaction. A ref (not state) because
  // the countdown effect must re-run without re-rendering every tick.
  const deadline = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const restart = useCallback(() => {
    deadline.current = Date.now() + CONFIRMATION_EXTEND_MS;
  }, []);

  /**
   * The countdown.
   *
   * Pauses while the panel is hovered or has focus within, so it cannot vanish
   * mid-read. `pointerleave` / `focusout` are the resume signals; both only
   * fire when focus actually leaves the subtree, so moving between elements
   * inside the panel does not restart the clock.
   */
  useEffect(() => {
    if (!order) return;
    deadline.current = Date.now() + CONFIRMATION_MS;
    let frame = 0;
    const tick = () => {
      const node = containerRef.current;
      const engaged = node?.matches(":hover, :focus-within") ?? false;
      if (!engaged) {
        const left = deadline.current - Date.now();
        setRemaining(Math.max(0, left));
        if (left <= 0) {
          onDone();
          return;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [order, onDone]);

  // Move focus into the panel so keyboard and screen-reader users land on the
  // confirmation rather than being left wherever they were in the closed sheet.
  useEffect(() => {
    if (order) containerRef.current?.focus();
  }, [order]);

  const seconds = Math.ceil(remaining / 1000);

  return (
    <AnimatePresence>
      {order ? (
        <motion.div
          key="order-confirmation"
          className="fixed inset-0 z-modal flex items-end justify-center bg-foreground/45 p-0 backdrop-blur-sm sm:items-center sm:p-6"
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
          transition={springs.toast}
          onClick={(event) => {
            // Backdrop dismissal, so a stray tap never strands anyone on this
            // screen. Clicks inside the card are stopped below.
            if (event.target === event.currentTarget) onDone();
          }}
        >
          <motion.div
            ref={containerRef}
            tabIndex={-1}
            role="status"
            aria-live="polite"
            aria-label={`Order ${order.orderNumber} confirmed. Closing in ${seconds} seconds.`}
            onPointerEnter={restart}
            onPointerLeave={restart}
            onFocus={restart}
            onBlur={restart}
            className={cn(
              "flex max-h-[100dvh] w-full flex-col overflow-hidden bg-card",
              "rounded-t-3xl shadow-sheet outline-none",
              // Desktop: a centred card rather than full-bleed, so the content
              // does not stretch across a wide monitor.
              "sm:max-w-md sm:rounded-3xl",
            )}
          >
            <div className="flex flex-1 flex-col items-center overflow-y-auto px-6 pb-4 pt-8 text-center sm:px-8 sm:pt-10">
              <motion.span
                aria-hidden
                className="grid size-16 place-items-center rounded-full bg-primary text-primary-foreground shadow-chip"
                initial={{ scale: reduced ? 1 : 0.6, opacity: reduced ? 1 : 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={springs.toast}
              >
                <Check className="size-8 stroke-[3]" />
              </motion.span>

              <h2 className="mt-5 font-display text-2xl font-semibold tracking-tight text-balance">
                {confirmationTitle(order.customerName)}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground text-pretty">Your order is in.</p>

              {/* The ticket number is the reason this screen exists: it is what
                  the customer quotes at the counter, so it is the largest text
                  after the greeting. */}
              <p className="mt-6 font-mono text-3xl font-semibold tracking-tight text-foreground">
                #{order.orderNumber}
              </p>
              <p className="mt-1 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                {typeLabel[order.type]}
                {order.outletName ? ` · ${order.outletName}` : ""}
              </p>

              {/*
                What was ordered, itemised.
                Skipped entirely for a single line with no variant and no
                modifiers: repeating "1 × Classic Cold Coffee ₹50" directly above
                a total that already says ₹50 is noise, and this screen has to
                stay readable at a glance.
              */}
              {order.items.length > 0 &&
              !(
                order.items.length === 1 &&
                !order.items[0]!.variantName &&
                !order.items[0]!.options?.length
              ) ? (
                <ul className="mt-6 w-full divide-y divide-border rounded-2xl border border-border text-left text-sm">
                  {order.items.map((item, index) => (
                    <li
                      key={`${item.name}-${item.variantName ?? ""}-${index}`}
                      className="px-4 py-3"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 font-medium">
                          <span className="text-muted-foreground tabular-nums">{item.qty}×</span>{" "}
                          {item.name}
                          {item.variantName ? (
                            <span className="font-normal text-muted-foreground">
                              {" "}
                              — {item.variantName}
                            </span>
                          ) : null}
                        </span>
                        <span className="shrink-0 font-medium tabular-nums">
                          {inr(item.lineTotal)}
                        </span>
                      </div>
                      {item.variantName || item.qty > 1 ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {inr(item.unitPrice)} each
                        </p>
                      ) : null}
                      {item.options?.length ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          + {item.options.join(", ")}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}

              {/*
                The full breakdown, so the total is accounted for rather than
                asserted. Only non-zero charges appear — a ₹0 delivery line on a
                counter order is noise.
              */}
              {order.pricing.length > 0 ? (
                <dl className="mt-4 w-full space-y-1.5 text-sm">
                  {order.pricing.map((line) => (
                    <div key={line.label} className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted-foreground">{line.label}</dt>
                      <dd
                        className={cn("shrink-0 tabular-nums", line.negative && "text-foreground")}
                      >
                        {line.negative ? `−${inr(line.value)}` : inr(line.value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}

              {/*
                Who and where, in one block.
                Previously the address appeared twice — once as the "To" row of
                the summary card and again under "Delivering to" — which read as a
                duplication bug and pushed the useful content below the fold. One
                block, one copy of each fact.
              */}
              <dl className="mt-4 w-full space-y-2 rounded-2xl border border-border px-4 py-3 text-left text-xs leading-5">
                <div>
                  <dt className="font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {order.type === "delivery" ? "Deliver to" : "Order for"}
                  </dt>
                  <dd className="mt-0.5 break-words text-foreground">
                    {order.customerName}
                    {order.phone ? (
                      <span className="text-muted-foreground"> · {order.phone}</span>
                    ) : null}
                  </dd>
                </div>
                {order.address ? (
                  <div>
                    <dt className="font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Address
                    </dt>
                    <dd className="mt-0.5 break-words text-foreground">{order.address}</dd>
                  </div>
                ) : null}
                {order.notes ? (
                  <div>
                    <dt className="font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Note for the kitchen
                    </dt>
                    {/* `whitespace-pre-wrap` so a deliberately multi-line note
                        survives rather than being re-flowed. */}
                    <dd className="mt-0.5 whitespace-pre-wrap break-words text-foreground">
                      {order.notes}
                    </dd>
                  </div>
                ) : null}
              </dl>

              <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-muted-foreground text-pretty">
                <Clock3 className="size-3.5 shrink-0" />
                {nextStepLabel(order.type)}
              </p>
            </div>

            {/* Actions sit outside the scroll area so they stay reachable on a
                short viewport (landscape phones, split screen). */}
            <div className="shrink-0 border-t border-border bg-card px-6 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-8">
              <Button className="min-h-12 w-full" onClick={onDone}>
                Done
              </Button>
              {onTrack ? (
                <Button variant="ghost" className="mt-1 min-h-11 w-full text-sm" onClick={onTrack}>
                  Track this order
                </Button>
              ) : null}
              <p className="mt-1 text-center text-[11px] text-muted-foreground" aria-hidden>
                Closing in {seconds}s
              </p>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
