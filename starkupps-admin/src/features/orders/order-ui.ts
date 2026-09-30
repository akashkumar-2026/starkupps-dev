import { inr } from "@/utils/format";

/** The lifecycle every order ticket moves through. */
export type OrderStatus =
  "new" | "preparing" | "ready" | "completed" | "cancelled";

export type StatusMeta = {
  label: string;
  dot: string;
  badge: string;
  /** The single transition this status offers, if any. */
  next?: { status: OrderStatus; label: string };
};

export const statusMeta: Record<OrderStatus, StatusMeta> = {
  new: {
    label: "New",
    dot: "bg-[#E2533C]",
    badge: "border-[#F3C5B9] bg-[#FBE4DD] text-[#A83825]",
    next: { status: "preparing", label: "Start prep" },
  },
  preparing: {
    label: "Preparing",
    dot: "bg-[#D5962A]",
    badge: "border-[#EFD79B] bg-[#FBF0D5] text-[#8A5D10]",
    next: { status: "ready", label: "Mark ready" },
  },
  ready: {
    label: "Ready",
    dot: "bg-[#468A61]",
    badge: "border-[#BDE0C8] bg-[#E5F2E9] text-[#2F6947]",
    next: { status: "completed", label: "Complete" },
  },
  completed: {
    label: "Completed",
    dot: "bg-[#8B8277]",
    badge: "border-[#DDD7CE] bg-[#EEEAE3] text-[#675F56]",
  },
  cancelled: {
    label: "Cancelled",
    dot: "bg-[#B83D29]",
    badge: "border-[#F2C9BD] bg-[#FFF0EA] text-[#9A3627]",
  },
};

/** Statuses offered in the queue filter, in workflow order. */
export const orderStatuses: OrderStatus[] = [
  "new",
  "preparing",
  "ready",
  "completed",
  "cancelled",
];

/**
 * `selectedModifiers` is a free-form JSON column, so a legacy row can hold the
 * *string* "[]" rather than an array. Checking Array.isArray() before mapping
 * keeps one malformed row from crashing the whole dialog into the error
 * boundary.
 */
export function modifierNames(item: unknown): string[] {
  const raw = (item as { selectedModifiers?: unknown } | null)
    ?.selectedModifiers;
  if (Array.isArray(raw)) {
    return raw
      .map(entry => String((entry as { name?: unknown } | null)?.name ?? ""))
      .filter(Boolean);
  }
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .map(entry =>
            String((entry as { name?: unknown } | null)?.name ?? "")
          )
          .filter(Boolean);
      }
    } catch {
      return [];
    }
  }
  return [];
}

/** Total for a set of order lines, used to cross-check a stored total. */
export function lineTotal(value: unknown): string {
  return inr(Number(value ?? 0));
}
