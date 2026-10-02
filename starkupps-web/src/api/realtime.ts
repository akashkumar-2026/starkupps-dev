/**
 * Supabase Realtime subscriptions.
 *
 * Realtime is an *enhancement*: the menu and outlet lists also load over plain
 * HTTP and refetch on focus/reconnect. A realtime failure must therefore never
 * propagate into React, or it would trip the root error boundary and take the
 * page down. Every entry point here swallows its own errors and returns `null`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseClient } from "./supabase";

/**
 * supabase-js returns the *existing* channel when `channel(topic)` is called
 * with a duplicate topic, and adding a listener to an already-subscribed channel
 * throws "cannot add postgres_changes callbacks after subscribe()". A monotonic
 * suffix gives every subscription its own topic, which also keeps React 19
 * Strict Mode's double-invoked effects safe.
 */
let channelSeq = 0;

/** Callback debounce, in ms — absorbs admin bulk edits without a refetch storm. */
const COALESCE_MS = 120;

/** Tables whose contents determine the shape of the public menu payload. */
const MENU_TABLES = [
  "menu_categories",
  "menu_items",
  "menu_item_variants",
  "modifier_groups",
  "modifier_options",
  "menu_item_modifiers",
  "outlet_menu_availability",
  "outlet_variant_availability",
] as const;

/** Resolves the client, returning `null` when realtime is unavailable. */
function safeClient(): SupabaseClient | null {
  try {
    return getSupabaseClient();
  } catch (error) {
    console.warn("[realtime] client unavailable — falling back to fetch only:", error);
    return null;
  }
}

type PostgresChangeFilter = {
  event: "*";
  schema: "public";
  table: string;
  filter?: string | undefined;
};

/** Subscribe to changes on a single table. */
export function subscribeTable(
  table: string,
  filter: string | undefined,
  onChange: () => void,
): (() => void) | null {
  try {
    const supabase = safeClient();
    if (!supabase) return null;

    const channel = supabase.channel(`realtime:table:${++channelSeq}`);
    const change: PostgresChangeFilter = { event: "*", schema: "public", table, filter };

    channel
      .on("postgres_changes" as never, change as never, () => onChange())
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn(`[realtime] ${table} channel ${status}`);
        }
      });

    return () => supabase.removeChannel(channel);
  } catch (error) {
    console.warn(`[realtime] subscribe to ${table} failed — fetch only:`, error);
    return null;
  }
}

/**
 * A menu change as delivered by Supabase Realtime.
 *
 * `table` and `row` are passed through so the caller can patch its cache instead
 * of refetching the whole eight-table menu payload on every keystroke-sized
 * edit.
 */
export type MenuChange = {
  table: (typeof MENU_TABLES)[number];
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: Record<string, unknown>;
  old: Record<string, unknown>;
};

/**
 * Multiplexed menu subscription: one channel, every table that can change the
 * menu, and a debounced callback so a bulk edit in Admin produces one coalesced
 * signal rather than one per row.
 */
export function subscribeMenu(
  outletId: number | null,
  onChange: (change: MenuChange) => void,
): (() => void) | null {
  try {
    const supabase = safeClient();
    if (!supabase) return null;

    let timer: ReturnType<typeof setTimeout> | null = null;
    // Pending changes, merged so a burst of edits arrives as a single signal with
    // the most recent row for each table.
    let pending: MenuChange | null = null;

    const flush = () => {
      timer = null;
      const change = pending;
      pending = null;
      if (change) onChange(change);
    };

    const coalesced = (table: MenuChange["table"]) => (payload: unknown) => {
      const p = payload as {
        eventType?: string;
        new?: Record<string, unknown>;
        old?: Record<string, unknown>;
      };
      const eventType = p?.eventType;
      if (eventType !== "INSERT" && eventType !== "UPDATE" && eventType !== "DELETE") return;
      pending = {
        table,
        eventType,
        new: p?.new ?? {},
        old: p?.old ?? {},
      };
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, COALESCE_MS);
    };

    const channel = supabase.channel(`realtime:menu:${++channelSeq}`);

    for (const table of MENU_TABLES) {
      // Outlet-scoped availability is filtered server-side; the rest is global.
      const filter =
        table.startsWith("outlet_") && outletId ? `outletId=eq.${outletId}` : undefined;
      const change: PostgresChangeFilter = { event: "*", schema: "public", table, filter };
      channel.on("postgres_changes" as never, change as never, coalesced(table));
    }

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        // A reconnect may have missed changes, so re-check on every subscribe.
        // An empty payload forces the caller's refetch path.
        pending = {
          table: "menu_categories",
          eventType: "UPDATE",
          new: {},
          old: {},
        };
        if (timer) clearTimeout(timer);
        timer = setTimeout(flush, 0);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        // CLOSED is expected on unmount and is not worth logging.
        console.warn(`[realtime] menu channel ${status} (outletId=${outletId})`);
      }
    });

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  } catch (error) {
    console.warn("[realtime] menu subscribe failed — fetch only:", error);
    return null;
  }
}
