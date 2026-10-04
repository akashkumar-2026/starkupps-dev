import {
  AppDialog,
  dialogPrimaryAction,
  FormDialog,
} from "@/components/shared/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ErrorPanel, PageLoading } from "@/components/shared/StatePanels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/cn";
import { dateText, inr, timeLabel } from "@/utils/format";
import { Check, Copy, MapPin, Phone } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  customerBlock,
  fulfillmentLabel,
  isDelivery,
  itemCount,
  paymentBlock,
  pricingBreakdown,
  splitNotes,
  type OrderDetailRecord,
} from "./order-detail";
import { modifierNames, statusMeta, type OrderStatus } from "./order-ui";

/**
 * A labelled row inside one of the ticket sections.
 *
 * `mono` is for machine-ish values (codes, times) that should not sit in the
 * same typographic voice as prose.
 */
function Field({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#8A7D70]">
        {label}
      </p>
      <div className={cn("mt-0.5 text-sm", mono && "font-mono text-xs")}>
        {children}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-[#E7DED4] pt-4 first:border-t-0 first:pt-0">
      <h3 className="mb-2.5 font-mono text-[9px] uppercase tracking-[0.15em] text-[#A83825]">
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * Copy-to-clipboard with inline confirmation.
 *
 * Delivery addresses and phone numbers are the two things counter staff actually
 * need to copy out of this ticket, and re-typing a house number from a
 * screenshot is exactly the kind of transcription error that sends a delivery to
 * the wrong address.
 */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        } catch {
          // Clipboard access can be refused (insecure context, permissions).
          // Not worth an interrupting toast — the text is selectable on screen.
          toast.error(
            `Could not copy the ${label}. Select it and copy manually.`
          );
        }
      }}
      className="grid size-7 shrink-0 place-items-center rounded-full border border-[#E4DCD1] bg-white text-[#8A7D70] transition-colors hover:border-[#CFC2B2] hover:text-[#211B18]"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-[#2F6947]" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

export function OrderDetailDialog({
  order,
  open,
  loading,
  error,
  onClose,
  onAdvance,
  onCancel,
  busy,
}: {
  order?: OrderDetailRecord;
  open: boolean;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onAdvance: (status: OrderStatus) => void;
  onCancel: (reason: string) => void;
  busy: boolean;
}) {
  /*
   * One shell covers loading, error and content.
   *
   * The loading and error branches used to return a bare `<DialogContent>`
   * outside a `<Dialog>` root, which throws `` DialogPortal must be used within
   * Dialog `` and tore down the whole panel through the error boundary. Loading
   * is the *first* thing this dialog renders, so that broke on every ticket open
   * rather than in an edge case. Holding one shell also stops the dialog
   * unmounting around the detail request, so focus and scroll position survive.
   *
   * The header therefore lives here rather than inside `OrderTicketBody`: those
   * two branches have no order to name, and a modal that announces as a bare
   * "dialog" while it loads is unusable with a screen reader.
   */
  const status = (order?.status ?? "new") as OrderStatus;

  return (
    <AppDialog
      open={open}
      onOpenChange={next => !next && onClose()}
      size="xl"
      titleClassName="text-2xl font-extrabold tracking-[-0.05em]"
      title={order ? `Ticket #${order.orderNumber}` : "Order detail"}
      description={
        order
          ? `${customerBlock(order).name} · ${fulfillmentLabel(order.type)}`
          : loading
            ? "Loading the ticket…"
            : "The ticket could not be loaded."
      }
      footer={
        order ? (
          <>
            {/*
              Only actions legal from the current status are offered. The server
              enforces the same rules (`canTransitionOrderStatus`), so this is a
              usability measure rather than the control — but hiding an illegal
              button is what stops staff discovering the limit by clicking it.
            */}
            {statusMeta[status]?.next ? (
              <Button
                disabled={busy}
                className={dialogPrimaryAction}
                onClick={() => onAdvance(statusMeta[status].next!.status)}
              >
                {statusMeta[status].next!.label}
              </Button>
            ) : null}
            {status !== "completed" && status !== "cancelled" ? (
              <CancelOrderButton
                order={order}
                busy={busy}
                onCancel={onCancel}
              />
            ) : null}
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </>
        ) : null
      }
    >
      {loading ? (
        <PageLoading />
      ) : error ? (
        <ErrorPanel detail={error} retry={onClose} />
      ) : !order ? null : (
        <OrderTicketBody order={order} />
      )}
    </AppDialog>
  );
}

/**
 * The cancel action and its confirmation.
 *
 * Kept beside the footer it belongs to. The prompt is a separate dialog rather
 * than an inline field because cancelling is irreversible and the reason is
 * recorded as an internal note.
 */
function CancelOrderButton({
  order,
  busy,
  onCancel,
}: {
  order: OrderDetailRecord;
  busy: boolean;
  onCancel: (reason: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  useEffect(() => setReason(""), [order.id]);

  return (
    <>
      <Button variant="outline" disabled={busy} onClick={() => setOpen(true)}>
        Cancel order
      </Button>

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={`Cancel ticket #${order.orderNumber}`}
        description="Provide a reason for cancellation. It is recorded as an internal note, separate from the customer's own note."
        onSubmit={event => {
          event.preventDefault();
          if (reason.trim().length < 3) return;
          onCancel(reason.trim());
          setOpen(false);
        }}
        submitLabel="Confirm cancel"
        cancelLabel="Keep ticket"
        destructive
        isDirty={reason.trim().length > 0}
        submitDisabled={reason.trim().length < 3}
        submitPending={busy}
      >
        <Textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Reason (min 3 characters)"
          aria-label="Cancellation reason"
        />
      </FormDialog>
    </>
  );
}

/**
 * The populated ticket.
 *
 * Takes a non-optional `order` so the projections below can assume one exists,
 * which is what lets the shell above choose between loading, error and content
 * without any of the three needing partial-input handling.
 */
function OrderTicketBody({ order }: { order: OrderDetailRecord }) {
  const status = (order.status ?? "new") as OrderStatus;
  const meta = statusMeta[status];
  const customer = customerBlock(order);
  const { lines, total } = pricingBreakdown(order);
  const { customerNote, internalNote } = splitNotes(order.notes);
  const payment = paymentBlock(order);
  const delivery = isDelivery(order.type);
  const items = order.items ?? [];

  return (
    <div className="space-y-4">
      {/* ── A. Order information ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E4DCD1] bg-[#F7F2EB] px-4 py-3">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#8A7D70]">
            Placed
          </p>
          <p className="mt-0.5 text-sm font-extrabold">
            {order.createdAt ? timeLabel(new Date(order.createdAt)) : "—"}
          </p>
          <p className="text-[11px] text-[#827568]">
            {dateText(order.createdAt)}
          </p>
        </div>
        <div className="text-right">
          {meta ? (
            <Badge className={cn("border px-2.5 py-1 text-[10px]", meta.badge)}>
              {meta.label}
            </Badge>
          ) : (
            <Badge className="border px-2.5 py-1 text-[10px]">
              {order.status}
            </Badge>
          )}
          {order.updatedAt && order.updatedAt !== order.createdAt ? (
            <p className="mt-1.5 text-[10px] text-[#8A7D70]">
              Updated {timeLabel(new Date(order.updatedAt))}
            </p>
          ) : null}
        </div>
      </div>

      <Section title="Order">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Order number" mono>
            #{order.orderNumber}
          </Field>
          <Field label="Fulfilment">{fulfillmentLabel(order.type)}</Field>
          <Field label="Outlet">
            {order.outletName ?? (
              <span className="text-[#8A7D70]">Not recorded</span>
            )}
          </Field>
          <Field label="Source">
            {order.source === "website"
              ? "Website"
              : (order.source ?? "Counter")}
          </Field>
        </div>
      </Section>

      {/* ── B. Customer information ───────────────────────────────────── */}
      {/*
            The phone number and address were the missing pieces: both were
            collected at checkout (and the address was even required for
            delivery), and `admin.orders.byId` already returned the phone — it
            simply was never rendered. Nothing shown here can be absent without
            an explicit "not recorded" marker, so a gap is visible rather than
            looking like an oversight.
          */}
      <Section title="Customer">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">{customer.name}</Field>
            <Field label="Phone">
              {customer.phone ? (
                <span className="flex items-center gap-1.5">
                  <a
                    href={`tel:${customer.phone}`}
                    className="flex min-h-9 items-center gap-1.5 rounded-full border border-[#E4DCD1] bg-white px-3 font-mono text-xs font-semibold hover:border-[#CFC2B2]"
                  >
                    <Phone className="h-3 w-3" />
                    {customer.phoneLabel}
                  </a>
                  <CopyButton
                    value={customer.phoneLabel}
                    label="phone number"
                  />
                </span>
              ) : (
                <span className="text-[#8A7D70]">Not recorded</span>
              )}
            </Field>
          </div>
          {customer.email ? (
            <Field label="Email">
              <span className="flex items-center gap-1.5">
                <span className="min-w-0 break-all">{customer.email}</span>
                <CopyButton value={customer.email} label="email" />
              </span>
            </Field>
          ) : null}

          {/* Only for delivery. A takeaway ticket showing a stale address
                  is worse than showing none. */}
          {delivery ? (
            <Field label="Delivery address">
              {customer.address ? (
                <span className="flex items-start gap-1.5">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#8A7D70]" />
                  <span className="min-w-0 flex-1 break-words leading-5">
                    {customer.address}
                  </span>
                  <CopyButton
                    value={customer.address}
                    label="delivery address"
                  />
                </span>
              ) : (
                <span className="text-[#9A3627]">
                  Not recorded — this order predates address storage, so the
                  customer will need to be asked where to deliver.
                </span>
              )}
            </Field>
          ) : null}
        </div>
      </Section>

      {/* ── C. Order items ───────────────────────────────────────────── */}
      <Section
        title={`Items${itemCount(items) ? ` · ${itemCount(items)}` : ""}`}
      >
        {items.length === 0 ? (
          <p className="text-xs text-[#8A7D70]">No items recorded.</p>
        ) : (
          <div className="divide-y divide-[#E7DED4]">
            {items.map(item => (
              <div
                key={item.id}
                className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-extrabold">
                    {item.quantity}× {item.itemName}
                    {item.variantName ? ` — ${item.variantName}` : ""}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[#827568]">
                    {item.variantQuantity
                      ? `${item.variantQuantity} ${item.variantUnit ?? ""}`.trim()
                      : ""}
                    {item.sku ? ` · SKU ${item.sku}` : ""}
                    {item.unitPrice != null
                      ? ` · ${inr(Number(item.unitPrice))} each`
                      : ""}
                  </p>
                  {modifierNames(item).length ? (
                    <p className="mt-0.5 text-[11px] text-[#5A4E45]">
                      + {modifierNames(item).join(", ")}
                    </p>
                  ) : null}
                </div>
                <span className="shrink-0 font-mono text-xs font-semibold">
                  {inr(Number(item.lineTotal ?? 0))}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── D. Notes ─────────────────────────────────────────────────── */}
      {customerNote || internalNote ? (
        <Section title="Notes">
          <div className="space-y-2">
            {customerNote ? (
              <div className="rounded-xl border border-[#F0D5B2] bg-[#FFF8E8] p-3">
                <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#8A5D10]">
                  Customer note
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm font-semibold leading-5 text-[#634A27]">
                  {customerNote}
                </p>
              </div>
            ) : null}
            {internalNote ? (
              <div className="rounded-xl border border-[#E4DCD1] bg-[#F7F2EB] p-3">
                <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#8A7D70]">
                  Internal · cancellation
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-[#5A4E45]">
                  {internalNote}
                </p>
              </div>
            ) : null}
          </div>
        </Section>
      ) : null}

      {/* ── E. Pricing ───────────────────────────────────────────────── */}
      <Section title="Payment summary">
        <dl className="space-y-1.5">
          {lines.map(line => (
            <div
              key={line.label}
              className={cn(
                "flex items-baseline justify-between gap-4 text-sm",
                line.muted && "text-[#827568]"
              )}
            >
              <dt className={cn(line.muted && "text-[11px]")}>{line.label}</dt>
              <dd className="shrink-0 font-mono tabular-nums">
                {inr(line.value)}
              </dd>
            </div>
          ))}
          <div className="flex items-end justify-between gap-4 border-t border-[#E7DED4] pt-2.5">
            <dt className="text-sm font-bold text-[#73675B]">Order total</dt>
            <dd className="text-2xl font-extrabold tracking-[-0.05em]">
              {inr(total)}
            </dd>
          </div>
        </dl>
      </Section>

      {/* ── F. Payment ───────────────────────────────────────────────── */}
      {payment ? (
        <Section title="Payment">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm">{payment.method}</span>
            <Badge
              className={cn(
                "border px-2.5 py-1 text-[10px]",
                payment.tone === "ok"
                  ? "border-[#BDE0C8] bg-[#E5F2E9] text-[#2F6947]"
                  : payment.tone === "failed"
                    ? "border-[#F1C9BD] bg-[#FFF0EA] text-[#9A3627]"
                    : "border-[#EFD79B] bg-[#FBF0D5] text-[#8A5D10]"
              )}
            >
              {payment.status}
            </Badge>
          </div>
          {payment.paid ? null : (
            <p className="mt-1.5 text-[11px] text-[#8A7D70]">
              {payment.status === "failed"
                ? "Payment failed — do not treat this ticket as settled."
                : "Not yet paid. Placing an order does not collect payment."}
            </p>
          )}
        </Section>
      ) : null}
    </div>
  );
}
