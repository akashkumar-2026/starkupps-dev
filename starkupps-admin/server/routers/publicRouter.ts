/**
 * Public API for StarKupps Web (customer storefront).
 * - No authentication required (rate-limited, field-limited)
 * - All pricing/validation is server-authoritative
 * - Shares same DB/tables as admin — single source of truth
 * - Migrated from Drizzle ORM to Supabase (getSupabaseAdmin / getSql)
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { consume } from "../auth/rate-limit";
import { clientThrottleKey } from "../auth/client-ip";
import { escapePostgrestOr, normalizeSelectedModifiers } from "../db/index";
import { publicProcedure, router } from "../lib/trpc";
import { resolveInstagramThumbnail } from "../lib/instagram-thumbnails";
import { getSql, getSupabaseAdmin } from "../db/supabase";
import {
  INSTAGRAM_LIMITS,
  marqueeDurationSeconds,
  resolveProfileUrl,
  sanitizeProfileHandle,
} from "@shared/instagram";

/** One day of the store's weekly schedule, as served to the storefront. */
export type PublicWeeklyHour = {
  /** 0 = Sunday, matching `outlet_hours.dayOfWeek` and JS `Date#getDay()`. */
  dayOfWeek: number;
  isOpen: boolean;
  /** `HH:mm` 24-hour, or null when the day is closed / unset. */
  openTime: string | null;
  closeTime: string | null;
};

function toNum(v: unknown) {
  return Number(v ?? 0);
}

// Reuse coupon derived status
function derivedStatus(c: any): string {
  const now = new Date();
  const s = c.status as string;
  if (s === "archived") return "archived";
  if (s === "paused") return "paused";
  if (s === "draft") return "draft";
  if (c.usageLimit && toNum(c.usedCount) >= toNum(c.usageLimit))
    return "exhausted";
  if (c.startAt && new Date(c.startAt) > now) return "scheduled";
  if (c.endAt && new Date(c.endAt) < now) return "expired";
  if (s === "expired") return "expired";
  if (s === "exhausted") return "exhausted";
  return "active";
}

// Store-backed limiter for high-volume public reads (menu/outlets).
// Persisted in Postgres so the limit is shared by every gateway instance
// rather than being multiplied by the instance count.
async function publicRateLimit(key: string) {
  const r = await consume(`public:read:${key}`, {
    max: 120,
    windowMs: 60 * 1000,
  });
  if (!r.allowed)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Too many requests. Please try again shortly.",
    });
}

// Cross-instance persistent limiter for sensitive public writes
// (order create/status, coupon validation, tracking tokens). Survives restarts
// and is shared across gateway instances.
async function publicWriteRateLimit(key: string) {
  const r = await consume(`public:write:${key}`, {
    max: 40,
    windowMs: 15 * 60 * 1000,
  });
  if (!r.allowed)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Too many requests. Please try again shortly.",
    });
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export type OrderType = "dine_in" | "takeaway" | "delivery";

export type ChargeConfig = {
  packingCharge: number;
  deliveryFee: number;
  freeDeliveryAbove: number | null;
  taxRates: Array<{ name: string; rate: number }>;
};

// Loads effective charge configuration: store_settings defaults with
// optional per-outlet overrides from outlets.services, plus all enabled
// taxes (global rows with outletId NULL + rows scoped to this outlet).
export async function resolveChargeConfig(
  supabase: any,
  outlet: any
): Promise<ChargeConfig> {
  let packingCharge = 15;
  let deliveryFee = 29;
  let freeDeliveryAbove: number | null = null;
  try {
    const { data: settings } = await supabase
      .from("store_settings")
      .select("packingCharge,deliveryFee,freeDeliveryAbove")
      .limit(1)
      .maybeSingle();
    if (settings) {
      if (settings.packingCharge != null)
        packingCharge = toNum(settings.packingCharge);
      if (settings.deliveryFee != null)
        deliveryFee = toNum(settings.deliveryFee);
      if (settings.freeDeliveryAbove != null)
        freeDeliveryAbove = toNum(settings.freeDeliveryAbove);
    }
  } catch {}
  const services = (outlet as any)?.services as any;
  if (
    services &&
    Number.isFinite(Number(services.packingCharge)) &&
    Number(services.packingCharge) >= 0
  )
    packingCharge = Number(services.packingCharge);
  if (
    services &&
    Number.isFinite(Number(services.deliveryFee)) &&
    Number(services.deliveryFee) >= 0
  )
    deliveryFee = Number(services.deliveryFee);
  let taxRates: Array<{ name: string; rate: number }> = [];
  try {
    const { data: taxes } = await supabase
      .from("taxes")
      .select("name,rate,outletId")
      .eq("enabled", true);
    taxRates = ((taxes ?? []) as any[])
      .filter(
        (t: any) =>
          t.outletId == null ||
          Number(t.outletId) === Number((outlet as any)?.id)
      )
      .map((t: any) => ({ name: String(t.name), rate: toNum(t.rate) }))
      .filter(t => t.rate > 0);
  } catch {}
  return { packingCharge, deliveryFee, freeDeliveryAbove, taxRates };
}

export type OrderQuote = {
  packing: number;
  delivery: number;
  tax: number;
  taxLines: Array<{ name: string; rate: number; amount: number }>;
  chargesTotal: number;
  total: number;
};

// Pure computation so it can be unit-tested. Taxes apply on (subtotal -
// discount), matching finance revenue reporting.
export function computeOrderQuote(input: {
  type: OrderType;
  taxable: number;
  packingCharge: number;
  deliveryFee: number;
  freeDeliveryAbove: number | null;
  taxRates: Array<{ name: string; rate: number }>;
  freeDelivery?: boolean;
}): OrderQuote {
  const taxable = Math.max(0, round2(input.taxable));
  const packing =
    input.type === "dine_in" ? 0 : Math.max(0, round2(input.packingCharge));
  let delivery =
    input.type === "delivery" ? Math.max(0, round2(input.deliveryFee)) : 0;
  if (input.freeDelivery) delivery = 0;
  if (input.freeDeliveryAbove != null && taxable >= input.freeDeliveryAbove)
    delivery = 0;
  const taxLines = input.taxRates
    .filter(t => t.rate > 0)
    .map(t => ({
      name: t.name,
      rate: t.rate,
      amount: round2((taxable * t.rate) / 100),
    }));
  const tax = round2(taxLines.reduce((s, l) => s + l.amount, 0));
  const chargesTotal = round2(packing + delivery + tax);
  return {
    packing,
    delivery,
    tax,
    taxLines,
    chargesTotal,
    total: round2(taxable + chargesTotal),
  };
}

export const publicRouter = router({
  // ── Storefront business facts ──
  //
  // Read straight from `public.site_settings`, which the admin panel edits.
  // Previously these values were string literals compiled into the storefront
  // bundle (phone, address, hours, FSSAI licence, hero copy, the stats strip,
  // the trust claims). Serving them from here is what makes them correctable
  // without a redeploy, and what stops the site asserting claims that the
  // database does not support.
  //
  // Only fields the storefront renders are exposed. Nothing here is sensitive:
  // it is the same contact information already printed on the page.
  site: publicProcedure.query(async ({ ctx }) => {
    publicRateLimit(clientThrottleKey(ctx.req, "site_content"));
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("site_settings")
      .select(
        "brandName,tagline,phoneDigits,whatsappNumber,address,addressDetail,mapsQuery,latitude,longitude,hoursSummary,hoursShort,hoursNote,openTime,closeTime,closedDays,fssaiLicense,heroHeading,heroSubheading,heroBadge,heroCtaLabel,openBadge,statRatingLabel,statOrdersLabel,statPickupLabel,trustHeading,trustClaim1,trustClaim2,trustClaim3,trustPickupStat,trustPickupCaption,trustPremadeStat,trustPremadeCaption,galleryHeading,galleryBody,galleryImages,menuHeading,menuEmptyMessage,metaTitle,metaDescription,metaOgDescription,updatedAt"
      )
      .eq("id", 1)
      .limit(1)
      .maybeSingle();
    if (error)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: error.message,
      });
    // No row is a real, reportable state (a fresh database that has not been
    // configured yet), not something to paper over with defaults.
    if (!data)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Storefront settings have not been configured yet.",
      });
    const row = data as Record<string, unknown>;
    const str = (key: string): string => String(row[key] ?? "");
    const num = (key: string): number | null =>
      row[key] === null || row[key] === undefined ? null : Number(row[key]);

    // Authoritative schedule, in priority order:
    //   1. per-day `outlet_hours` (Admin > Outlets > Operating Hours)
    //   2. the outlet's own opening/closing pair
    //   3. `site_settings.openTime` / `closeTime` / `closedDays`
    //
    // (3) is the only source that exists on a deployment with no `outlets` row,
    // which is why the badge previously resolved to "unknown" and silently
    // reverted to the free-text prose fields.
    const { data: outletRows } = await supabase
      .from("outlets")
      .select("id,timezone,openingTime,closingTime")
      .eq("status", "active")
      .order("id", { ascending: true })
      .limit(1);
    const primaryOutlet = (outletRows ?? [])[0] as any;
    let weeklyHours: PublicWeeklyHour[] = [];
    if (primaryOutlet) {
      const { data: hourRows } = await supabase
        .from("outlet_hours")
        .select("dayOfWeek,isOpen,openTime,closeTime")
        .eq("outletId", primaryOutlet.id)
        .order("dayOfWeek", { ascending: true });
      weeklyHours = (hourRows ?? []).map((h: any) => ({
        dayOfWeek: Number(h.dayOfWeek),
        isOpen: Boolean(h.isOpen),
        openTime: (h.openTime as string | null) ?? null,
        closeTime: (h.closeTime as string | null) ?? null,
      }));
    }

    const hasUsableDay = weeklyHours.some(
      day => day.isOpen && day.openTime && day.closeTime
    );
    if (!hasUsableDay) {
      const openTime =
        (primaryOutlet?.openingTime as string | undefined) || str("openTime");
      const closeTime =
        (primaryOutlet?.closingTime as string | undefined) || str("closeTime");
      if (openTime && closeTime) {
        // `closedDays` holds ISO weekday numbers (1=Mon..7=Sun); `dayOfWeek` is
        // 0=Sun, hence the modulo when mapping one onto the other.
        const closed = new Set(
          str("closedDays")
            .split(",")
            .map(part => Number(part.trim()))
            .filter(value => Number.isFinite(value) && value >= 1 && value <= 7)
            .map(iso => iso % 7)
        );
        weeklyHours = Array.from({ length: 7 }, (_, dayOfWeek) => ({
          dayOfWeek,
          isOpen: !closed.has(dayOfWeek),
          openTime,
          closeTime,
        }));
      }
    }
    const images = Array.isArray(row.galleryImages)
      ? (row.galleryImages as any[]).map(img => ({
          url: String(img?.url ?? ""),
          alt: String(img?.alt ?? ""),
          span:
            img?.span === "sm:col-span-2"
              ? ("sm:col-span-2" as const)
              : ("" as const),
        }))
      : [];
    return {
      brandName: str("brandName"),
      tagline: str("tagline"),
      phoneDigits: str("phoneDigits"),
      whatsappNumber: str("whatsappNumber"),
      address: str("address"),
      addressDetail: str("addressDetail"),
      mapsQuery: str("mapsQuery"),
      latitude: num("latitude"),
      longitude: num("longitude"),
      hoursSummary: str("hoursSummary"),
      hoursShort: str("hoursShort"),
      hoursNote: str("hoursNote"),
      // Structured schedule: what the storefront renders and evaluates against,
      // rather than the owner's free-text summary which can contradict it.
      timezone:
        (primaryOutlet?.timezone as string | undefined) || "Asia/Kolkata",
      weeklyHours,
      fssaiLicense: str("fssaiLicense"),
      heroHeading: str("heroHeading"),
      heroSubheading: str("heroSubheading"),
      heroBadge: str("heroBadge"),
      heroCtaLabel: str("heroCtaLabel"),
      openBadge: str("openBadge"),
      statRatingLabel: str("statRatingLabel"),
      statOrdersLabel: str("statOrdersLabel"),
      statPickupLabel: str("statPickupLabel"),
      trustHeading: str("trustHeading"),
      trustClaim1: str("trustClaim1"),
      trustClaim2: str("trustClaim2"),
      trustClaim3: str("trustClaim3"),
      trustPickupStat: str("trustPickupStat"),
      trustPickupCaption: str("trustPickupCaption"),
      trustPremadeStat: str("trustPremadeStat"),
      trustPremadeCaption: str("trustPremadeCaption"),
      galleryHeading: str("galleryHeading"),
      galleryBody: str("galleryBody"),
      galleryImages: images,
      menuHeading: str("menuHeading"),
      menuEmptyMessage: str("menuEmptyMessage"),
      metaTitle: str("metaTitle"),
      metaDescription: str("metaDescription"),
      metaOgDescription: str("metaOgDescription"),
      updatedAt: String(row.updatedAt ?? ""),
    };
  }),

  // ── Customer reviews shown in the storefront trust section ──
  //
  // Reads `public.testimonials`, which the admin panel manages under
  // Content > Testimonials. The storefront previously rendered three invented
  // reviews from a code constant and labelled them "Google review".
  reviews: publicProcedure.query(async ({ ctx }) => {
    publicRateLimit(clientThrottleKey(ctx.req, "site_reviews"));
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("testimonials")
      .select("id,authorName,authorRole,content,rating,createdAt")
      .eq("active", true)
      .order("createdAt", { ascending: false })
      .limit(12);
    if (error)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: error.message,
      });
    return ((data ?? []) as any[]).map(row => ({
      id: Number(row.id),
      authorName: String(row.authorName ?? ""),
      authorRole: row.authorRole ?? null,
      content: String(row.content ?? ""),
      rating: Number(row.rating ?? 5),
      createdAt: String(row.createdAt ?? ""),
    }));
  }),

  /** Active customer-facing FAQs, ordered as configured in Admin > Content. */
  faqs: publicProcedure.query(async ({ ctx }) => {
    publicRateLimit(clientThrottleKey(ctx.req, "site_faqs"));
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("faqs")
      .select("id,question,answer,position")
      .eq("active", true)
      .order("position", { ascending: true })
      .order("id", { ascending: true });
    if (error)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: error.message,
      });
    return ((data ?? []) as any[]).map(row => ({
      id: Number(row.id),
      question: String(row.question ?? ""),
      answer: String(row.answer ?? ""),
      position: Number(row.position ?? 0),
    }));
  }),

  // ── Outlets: only active, limited fields (no internal metrics) ──
  outlets: router({
    list: publicProcedure
      .input(
        z.object({ search: z.string().trim().max(80).optional() }).nullish()
      )
      .query(async ({ ctx, input }) => {
        publicRateLimit(clientThrottleKey(ctx.req, "outlets_list"));
        const supabase = getSupabaseAdmin();
        let query = supabase
          .from("outlets")
          .select(
            "id,code,name,city,address,phone,openingTime,closingTime,deliveryRadiusKm,minimumOrder,status,services"
          )
          .eq("status", "active")
          .order("name", { ascending: true });
        if (input?.search) {
          const escaped = escapePostgrestOr(input.search);
          // postgres `like` is case-sensitive; use ilike for friendlier public search
          query = query.ilike("name", `%${escaped}%`);
        }
        const { data, error } = await query;
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        const rows = (data ?? []) as any[];
        return rows.map(r => ({
          ...r,
          deliveryRadiusKm: toNum(r.deliveryRadiusKm),
          minimumOrder: toNum(r.minimumOrder),
        }));
      }),
    byId: publicProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        publicRateLimit(clientThrottleKey(ctx.req, "outlet_byId"));
        const supabase = getSupabaseAdmin();
        // Explicit columns only — `outlets.list` already exposes this same set to
        // the storefront; do not widen public surface to internal columns.
        const { data: row, error } = await supabase
          .from("outlets")
          .select(
            "id,code,name,city,address,phone,openingTime,closingTime,deliveryRadiusKm,minimumOrder,status,services"
          )
          .eq("id", input.id)
          .limit(1)
          .maybeSingle();
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        if (!row)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Outlet not found.",
          });
        if ((row as any).status !== "active")
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Outlet is not currently active.",
          });
        const { data: hours } = await supabase
          .from("outlet_hours")
          .select("*")
          .eq("outletId", input.id)
          .order("dayOfWeek", { ascending: true });
        return {
          outlet: {
            ...(row as any),
            deliveryRadiusKm: toNum((row as any).deliveryRadiusKm),
            minimumOrder: toNum((row as any).minimumOrder),
          },
          hours: (hours ?? []) as any[],
        };
      }),
  }),

  // ── Menu: categories + items + modifiers, outlet-scoped availability ──
  menu: router({
    categories: publicProcedure.query(async ({ ctx }) => {
      publicRateLimit(clientThrottleKey(ctx.req, "menu_cat"));
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from("menu_categories")
        .select("*")
        .order("sortOrder", { ascending: true })
        .order("name", { ascending: true });
      if (error)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      return (data ?? []) as any[];
    }),

    list: publicProcedure
      .input(
        z
          .object({
            outletId: z.number().int().positive().optional(),
            categoryId: z.number().int().positive().optional(),
            search: z.string().trim().max(80).optional(),
            includeUnavailable: z.boolean().optional().default(false),
          })
          .nullish()
      )
      .query(async ({ ctx, input }) => {
        publicRateLimit(clientThrottleKey(ctx.req, "menu_list"));
        const supabase = getSupabaseAdmin();

        // This used to run eight strictly sequential PostgREST round-trips
        // (categories → items → availability → variants → outlet variants →
        // assignments → groups → options). On the storefront's critical path that
        // is the difference between a sub-second menu and a multi-second one.
        //
        // Regrouped into three parallel levels, each level depending only on the
        // id set the previous one produced:
        //   L1  categories, items, outlet item availability
        //   L2  variants, outlet variant availability, item→group assignments
        //   L3  modifier groups, modifier options
        //
        // Errors are still fatal. A missing table or a bad filter must surface as
        // an error, never as a partially-built menu.

        // ── Level 1 ──
        let itemQuery = supabase.from("menu_items").select("*");
        if (input?.categoryId)
          itemQuery = itemQuery.eq("categoryId", input.categoryId);
        if (input?.search) {
          const escaped = escapePostgrestOr(input.search);
          itemQuery = itemQuery.ilike("name", `%${escaped}%`);
        }
        // comingSoon items stay visible regardless of `available` (they render
        // blurred, not hidden), so the filter stays as-is.
        if (!input?.includeUnavailable)
          itemQuery = itemQuery.eq("available", true);

        const [categoriesRes, itemsRes, itemAvailabilityRes] =
          await Promise.all([
            supabase
              .from("menu_categories")
              .select("*")
              .order("sortOrder", { ascending: true }),
            itemQuery,
            input?.outletId
              ? supabase
                  .from("outlet_menu_availability")
                  .select("menuItemId,available")
                  .eq("outletId", input.outletId)
              : Promise.resolve({ data: [] as any[], error: null }),
          ]);
        if (categoriesRes.error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: categoriesRes.error.message,
          });
        if (itemsRes.error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: itemsRes.error.message,
          });
        if (itemAvailabilityRes.error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: itemAvailabilityRes.error.message,
          });

        const allCategories = (categoriesRes.data ?? []) as any[];
        const itemRows = (itemsRes.data ?? []) as any[];
        const catById = new Map<number, any>(
          allCategories.map((c: any) => [c.id, c])
        );

        // Enrich with category join and sort by category sortOrder, category name, item name
        const rows = itemRows
          .map((item: any) => ({
            item,
            categoryName: catById.get(item.categoryId)?.name ?? "",
            categorySort: catById.get(item.categoryId)?.sortOrder ?? 0,
          }))
          .sort((a: any, b: any) => {
            if (a.categorySort !== b.categorySort)
              return a.categorySort - b.categorySort;
            if (a.categoryName !== b.categoryName)
              return String(a.categoryName).localeCompare(
                String(b.categoryName)
              );
            return String(a.item.name).localeCompare(String(b.item.name));
          });

        // outlet-scoped availability (product-level, no price)
        const availabilityMap = new Map<number, { available: boolean }>();
        for (const r of (itemAvailabilityRes.data ?? []) as any[])
          availabilityMap.set(r.menuItemId, { available: r.available });

        const allItemIds = rows.map(r => r.item.id);

        // ── Level 2 ──
        const [variantsRes, outletVariantsRes, assignmentsRes] =
          await Promise.all([
            allItemIds.length
              ? supabase
                  .from("menu_item_variants")
                  .select("*")
                  .in("menuItemId", allItemIds)
              : Promise.resolve({ data: [] as any[], error: null }),
            input?.outletId
              ? supabase
                  .from("outlet_variant_availability")
                  .select("variantId,available,priceOverride")
                  .eq("outletId", input.outletId)
              : Promise.resolve({ data: [] as any[], error: null }),
            allItemIds.length
              ? supabase
                  .from("menu_item_modifiers")
                  .select("menuItemId,modifierGroupId")
                  .in("menuItemId", allItemIds)
              : Promise.resolve({ data: [] as any[], error: null }),
          ]);
        for (const res of [
          variantsRes,
          outletVariantsRes,
          assignmentsRes,
        ] as const) {
          if (res.error)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: res.error.message,
            });
        }

        const variantMap = new Map<number, any[]>();
        for (const v of (variantsRes.data ?? []) as any[]) {
          const arr = variantMap.get(v.menuItemId);
          if (arr) arr.push(v);
          else variantMap.set(v.menuItemId, [v]);
        }
        const variantAvailabilityMap = new Map<
          number,
          { available: boolean; priceOverride: number | null }
        >();
        for (const r of (outletVariantsRes.data ?? []) as any[])
          variantAvailabilityMap.set(r.variantId, {
            available: r.available,
            priceOverride: r.priceOverride ? toNum(r.priceOverride) : null,
          });

        // ── Level 3 ──
        const assignments = (assignmentsRes.data ?? []) as any[];
        const groupIds = Array.from(
          new Set(assignments.map((a: any) => a.modifierGroupId))
        );
        const [groupsRes, optsRes] = await Promise.all([
          groupIds.length
            ? supabase.from("modifier_groups").select("*").in("id", groupIds)
            : Promise.resolve({ data: [] as any[], error: null }),
          groupIds.length
            ? supabase
                .from("modifier_options")
                .select("*")
                .in("groupId", groupIds)
            : Promise.resolve({ data: [] as any[], error: null }),
        ]);
        if (groupsRes.error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: groupsRes.error.message,
          });
        if (optsRes.error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: optsRes.error.message,
          });

        const optionsByGroup = new Map<number, any[]>();
        for (const o of (optsRes.data ?? []) as any[]) {
          const arr = optionsByGroup.get(o.groupId);
          if (arr) arr.push(o);
          else optionsByGroup.set(o.groupId, [o]);
        }
        const modifierMap = new Map<number, any[]>();
        const groupById = new Map<number, any>(
          ((groupsRes.data ?? []) as any[]).map((g: any) => [
            g.id,
            {
              ...g,
              options: (optionsByGroup.get(g.id) ?? []).map((o: any) => ({
                ...o,
                priceDelta: toNum(o.priceDelta),
              })),
            },
          ])
        );
        for (const a of assignments) {
          const g = groupById.get(a.modifierGroupId);
          if (!g) continue;
          const arr = modifierMap.get(a.menuItemId);
          if (arr) arr.push(g);
          else modifierMap.set(a.menuItemId, [g]);
        }

        const categories = allCategories.sort(
          (a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
        );

        const items = rows
          .map(r => {
            const ov = input?.outletId
              ? availabilityMap.get(r.item.id)
              : undefined;
            const effectiveAvailable = ov
              ? ov.available && r.item.available
              : r.item.available;
            const categoryComingSoon = Boolean(
              catById.get(r.item.categoryId)?.comingSoon
            );
            const itemComingSoon = Boolean((r.item as any).comingSoon);
            const effectiveComingSoon = itemComingSoon || categoryComingSoon;
            const rawVariants = (variantMap.get(r.item.id) ?? []).sort(
              (a: any, b: any) => a.sortOrder - b.sortOrder
            );
            const variants = rawVariants.map((v: any) => {
              const ova = variantAvailabilityMap.get(v.id);
              const vPrice = toNum(v.price);
              const vEffectivePrice = ova?.priceOverride ?? vPrice;
              const vAvailable =
                v.available &&
                (ova ? ova.available : true) &&
                effectiveAvailable;
              return {
                id: v.id,
                menuItemId: v.menuItemId,
                name: v.name,
                quantity: v.quantity != null ? toNum(v.quantity) : null,
                unit: v.unit,
                price: vPrice,
                effectivePrice: vEffectivePrice,
                sku: v.sku,
                available: vAvailable,
                globalAvailable: v.available,
                isDefault: v.isDefault,
                sortOrder: v.sortOrder,
              };
            });
            // Variant is the only sellable price — items without variants are not sellable
            if (!variants.length) return null;
            return {
              id: r.item.id,
              categoryId: r.item.categoryId,
              categoryName: r.categoryName,
              categoryComingSoon,
              name: r.item.name,
              description: r.item.description,
              imageUrl: r.item.imageUrl,
              veg: r.item.veg,
              available: effectiveAvailable,
              globalAvailable: r.item.available,
              comingSoon: itemComingSoon,
              effectiveComingSoon,
              modifierGroups: modifierMap.get(r.item.id) ?? [],
              variants,
              defaultVariantId:
                variants.find((v: any) => v.isDefault)?.id ??
                variants[0]?.id ??
                null,
            };
          })
          .filter((it): it is NonNullable<typeof it> => it !== null)
          .filter(
            it =>
              input?.includeUnavailable ||
              it.available ||
              Boolean((it as any).effectiveComingSoon)
          );

        return { categories, items };
      }),

    byId: publicProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          outletId: z.number().int().positive().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        publicRateLimit(clientThrottleKey(ctx.req, "menu_byId"));
        const supabase = getSupabaseAdmin();
        const { data: item, error: itemErr } = await supabase
          .from("menu_items")
          .select("*")
          .eq("id", input.id)
          .limit(1)
          .maybeSingle();
        if (itemErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: itemErr.message,
          });
        if (!item)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Item not found.",
          });
        const { data: cat } = await supabase
          .from("menu_categories")
          .select("*")
          .eq("id", (item as any).categoryId)
          .limit(1)
          .maybeSingle();
        const categoryName = (cat as any)?.name ?? "";
        const categoryComingSoon = Boolean((cat as any)?.comingSoon);
        const itemComingSoon = Boolean((item as any).comingSoon);
        const effectiveComingSoon = itemComingSoon || categoryComingSoon;
        let outletAvailable: boolean | null = null;
        if (input.outletId) {
          const { data: av } = await supabase
            .from("outlet_menu_availability")
            .select("*")
            .eq("outletId", input.outletId)
            .eq("menuItemId", input.id)
            .limit(1)
            .maybeSingle();
          if (av) {
            outletAvailable = (av as any).available;
          }
        }
        const { data: assigns } = await supabase
          .from("menu_item_modifiers")
          .select("*")
          .eq("menuItemId", input.id);
        let groups: any[] = [];
        if ((assigns ?? []).length) {
          const gids = (assigns as any[]).map((a: any) => a.modifierGroupId);
          const [{ data: gs }, { data: opts }] = await Promise.all([
            supabase.from("modifier_groups").select("*").in("id", gids),
            supabase.from("modifier_options").select("*").in("groupId", gids),
          ]);
          groups = (gs ?? []).map((g: any) => ({
            ...g,
            options: (opts ?? [])
              .filter((o: any) => o.groupId === g.id)
              .map((o: any) => ({ ...o, priceDelta: toNum(o.priceDelta) })),
          }));
        }
        const { data: variantRows } = await supabase
          .from("menu_item_variants")
          .select("*")
          .eq("menuItemId", input.id)
          .order("sortOrder", { ascending: true });
        const variantAvMap = new Map<number, any>();
        if (input.outletId && (variantRows ?? []).length) {
          const { data: ov } = await supabase
            .from("outlet_variant_availability")
            .select("*")
            .eq("outletId", input.outletId);
          for (const r of (ov ?? []) as any[]) variantAvMap.set(r.variantId, r);
        }
        const variants = ((variantRows ?? []) as any[]).map((v: any) => {
          const ova = variantAvMap.get(v.id);
          const vPrice = toNum(v.price);
          return {
            id: v.id,
            menuItemId: v.menuItemId,
            name: v.name,
            quantity: v.quantity != null ? toNum(v.quantity) : null,
            unit: v.unit,
            price: vPrice,
            effectivePrice: ova?.priceOverride
              ? toNum(ova.priceOverride)
              : vPrice,
            sku: v.sku,
            available:
              v.available &&
              (ova ? ova.available : true) &&
              (outletAvailable !== null
                ? outletAvailable
                : (item as any).available),
            globalAvailable: v.available,
            isDefault: v.isDefault,
            sortOrder: v.sortOrder,
          };
        });
        return {
          ...(item as any),
          outletAvailable,
          categoryName,
          categoryComingSoon,
          effectiveComingSoon,
          modifierGroups: groups,
          variants,
          defaultVariantId:
            variants.find(v => v.isDefault)?.id ?? variants[0]?.id ?? null,
        };
      }),
  }),

  // ── Coupon validation (public, rate-limited) ──
  coupons: router({
    validate: publicProcedure
      .input(
        z.object({
          code: z.string().trim().min(2).max(40),
          outletId: z.number().int().positive().nullable().optional(),
          orderType: z
            .enum(["delivery", "takeaway", "dine_in"])
            .nullable()
            .optional(),
          customerPhone: z.string().trim().max(32).nullable().optional(),
          orderAmount: z.number().min(0).optional(),
          items: z
            .array(
              z.object({
                menuItemId: z.number().int().positive().nullable(),
                categoryId: z.number().int().positive().nullable(),
                quantity: z.number().int().min(1),
                lineTotal: z.number().min(0),
              })
            )
            .optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        await publicWriteRateLimit(
          clientThrottleKey(ctx.req, "coupon_validate")
        );
        const supabase = getSupabaseAdmin();
        const code = input.code.trim().toUpperCase().replace(/\s+/g, "");
        const { data: row, error } = await supabase
          .from("coupons")
          .select("*")
          .eq("code", code)
          .limit(1)
          .maybeSingle();
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        if (!row) return { valid: false, reason: "Coupon not found." };
        const coupon: any = row;
        const dStatus = derivedStatus(coupon);
        if (dStatus !== "active")
          return { valid: false, reason: `Coupon is ${dStatus}.` };
        const now = new Date();
        if (coupon.startAt && new Date(coupon.startAt) > now)
          return { valid: false, reason: "Coupon not yet active." };
        if (coupon.endAt && new Date(coupon.endAt) < now)
          return { valid: false, reason: "Coupon expired." };
        if (
          coupon.usageLimit &&
          toNum(coupon.usedCount) >= toNum(coupon.usageLimit)
        )
          return { valid: false, reason: "Coupon usage limit reached." };
        if (
          coupon.applicableOutlets &&
          input.outletId &&
          !(coupon.applicableOutlets as number[]).includes(input.outletId)
        )
          return { valid: false, reason: "Coupon not valid for this outlet." };
        if (
          coupon.orderTypes &&
          input.orderType &&
          !(coupon.orderTypes as string[]).includes(input.orderType)
        )
          return {
            valid: false,
            reason: `Coupon not valid for ${input.orderType} orders.`,
          };
        // customer checks
        let customerOrdersCount = 0;
        let perCustomerUsed = 0;
        let customerId: number | null = null;
        if (input.customerPhone) {
          const { data: cust } = await supabase
            .from("customers")
            .select("*")
            .eq("phone", input.customerPhone.trim())
            .limit(1)
            .maybeSingle();
          if (cust) {
            customerId = (cust as any).id;
            const { data: custOrders } = await supabase
              .from("orders")
              .select("id")
              .eq("customerId", customerId!)
              .neq("status", "cancelled");
            customerOrdersCount = (custOrders ?? []).length;
            if (coupon.perCustomerLimit) {
              const { data: pc } = await supabase
                .from("coupon_redemptions")
                .select("id")
                .eq("couponId", coupon.id)
                .eq("customerId", customerId!)
                .eq("status", "applied");
              perCustomerUsed = (pc ?? []).length;
              if (perCustomerUsed >= coupon.perCustomerLimit)
                return { valid: false, reason: "Per-customer limit reached." };
            }
          }
        }
        const elig = coupon.customerEligibility as string;
        if (elig === "new" && customerOrdersCount > 0)
          return {
            valid: false,
            reason: "Coupon only for first-time customers.",
          };
        if (elig === "returning" && customerOrdersCount === 0)
          return {
            valid: false,
            reason: "Coupon only for returning customers.",
          };
        if (elig === "vip" && customerOrdersCount < 5)
          return { valid: false, reason: "Coupon only for VIP customers." };
        // product/category check
        if (
          input.items &&
          (coupon.applicableProducts?.length ||
            coupon.applicableCategories?.length)
        ) {
          const hasEligible = input.items.some(it => {
            if (
              coupon.excludeProducts &&
              it.menuItemId &&
              (coupon.excludeProducts as number[]).includes(it.menuItemId)
            )
              return false;
            if (
              coupon.excludeCategories &&
              it.categoryId &&
              (coupon.excludeCategories as number[]).includes(it.categoryId)
            )
              return false;
            if (
              coupon.applicableProducts &&
              it.menuItemId &&
              (coupon.applicableProducts as number[]).includes(it.menuItemId)
            )
              return true;
            if (
              coupon.applicableCategories &&
              it.categoryId &&
              (coupon.applicableCategories as number[]).includes(it.categoryId)
            )
              return true;
            return false;
          });
          if (!hasEligible)
            return {
              valid: false,
              reason: "Coupon not applicable to items in cart.",
            };
        }
        const orderAmount = input.orderAmount ?? 0;
        let eligibleAmount = orderAmount;
        if (
          input.items &&
          (coupon.applicableProducts?.length ||
            coupon.applicableCategories?.length ||
            coupon.excludeProducts?.length ||
            coupon.excludeCategories?.length)
        ) {
          eligibleAmount = 0;
          const hasInclude =
            (coupon.applicableProducts && coupon.applicableProducts.length) ||
            (coupon.applicableCategories && coupon.applicableCategories.length);
          for (const it of input.items) {
            if (
              coupon.excludeProducts &&
              it.menuItemId &&
              (coupon.excludeProducts as number[]).includes(it.menuItemId)
            )
              continue;
            if (
              coupon.excludeCategories &&
              it.categoryId &&
              (coupon.excludeCategories as number[]).includes(it.categoryId)
            )
              continue;
            if (hasInclude) {
              const inProd =
                coupon.applicableProducts &&
                it.menuItemId &&
                (coupon.applicableProducts as number[]).includes(it.menuItemId);
              const inCat =
                coupon.applicableCategories &&
                it.categoryId &&
                (coupon.applicableCategories as number[]).includes(
                  it.categoryId
                );
              if (!inProd && !inCat) continue;
            }
            eligibleAmount += it.lineTotal;
          }
        }
        if (toNum(coupon.minimumOrder) > eligibleAmount)
          return {
            valid: false,
            reason: `Minimum order ₹${coupon.minimumOrder} required.`,
          };
        // discount calc
        let discount = 0;
        if (coupon.discountType === "percentage") {
          discount = eligibleAmount * (toNum(coupon.discountValue) / 100);
          if (coupon.maximumDiscount)
            discount = Math.min(discount, toNum(coupon.maximumDiscount));
        } else if (coupon.discountType === "fixed") {
          discount = Math.min(toNum(coupon.discountValue), eligibleAmount);
        }
        discount = Math.min(discount, orderAmount);
        return {
          valid: true,
          discount,
          eligibleAmount,
          coupon: {
            code: coupon.code,
            name: coupon.name,
            discountType: coupon.discountType,
            discountValue: toNum(coupon.discountValue),
          },
        };
      }),
  }),

  // ── Storefront Instagram section: settings + active posts in one read ──
  // Returns an empty `posts` array (never an error) when the migration has not
  // been applied or the operator has not added anything yet, so the storefront
  // hides the section instead of showing a failure card on the home page.
  instagram: publicProcedure.query(async ({ ctx }) => {
    publicRateLimit(clientThrottleKey(ctx.req, "instagram_feed"));
    const supabase = getSupabaseAdmin();

    const { data: settingsRow, error: settingsErr } = await supabase
      .from("instagram_settings")
      .select(
        "enabled,eyebrow,heading,subheading,profileHandle,profileUrl,followButtonLabel,scrollSpeed,maxItems,pauseOnHover"
      )
      .eq("id", 1)
      .maybeSingle();
    if (settingsErr)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: settingsErr.message,
      });

    const settings = settingsRow
      ? {
          enabled: Boolean((settingsRow as any).enabled),
          eyebrow: String((settingsRow as any).eyebrow ?? "Follow along"),
          heading: String((settingsRow as any).heading ?? "Follow the froth"),
          subheading: (settingsRow as any).subheading ?? null,
          profileHandle:
            sanitizeProfileHandle((settingsRow as any).profileHandle) ||
            "starkupps",
          profileUrl: resolveProfileUrl(
            (settingsRow as any).profileUrl,
            (settingsRow as any).profileHandle
          ),
          followButtonLabel: String(
            (settingsRow as any).followButtonLabel ?? "Follow"
          ),
          scrollSpeed: (["slow", "normal", "fast"] as const).includes(
            (settingsRow as any).scrollSpeed
          )
            ? ((settingsRow as any).scrollSpeed as "slow" | "normal" | "fast")
            : ("normal" as const),
          // Clamp here as well as on write: a bad stored value must never flood
          // the storefront with iframes.
          maxItems: Math.min(
            INSTAGRAM_LIMITS.maxItems,
            Math.max(
              INSTAGRAM_LIMITS.minItems,
              Math.trunc(Number((settingsRow as any).maxItems ?? 10) || 10)
            )
          ),
          pauseOnHover: (settingsRow as any).pauseOnHover !== false,
        }
      : null;

    if (!settings?.enabled) {
      return {
        settings: settings ? { ...settings, enabled: false } : null,
        posts: [],
        durationSeconds: 0,
      };
    }

    const { data: postRows, error: postErr } = await supabase
      .from("instagram_posts")
      .select(
        "id,url,shortcode,type,caption,thumbnailUrl,previewVideoUrl,sortOrder,isActive,createdAt,updatedAt"
      )
      .eq("isActive", true)
      .order("sortOrder", { ascending: true })
      .order("id", { ascending: true })
      .limit(settings.maxItems);
    if (postErr)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: postErr.message,
      });

    const posts = ((postRows ?? []) as any[]).map((row: any) => ({
      id: Number(row.id),
      url: String(row.url),
      shortcode: String(row.shortcode),
      type: row.type === "reel" ? ("reel" as const) : ("post" as const),
      caption: row.caption ?? null,
      thumbnailUrl: row.thumbnailUrl ?? null,
      previewVideoUrl: row.previewVideoUrl ?? null,
      sortOrder: Number(row.sortOrder ?? 0),
      isActive: Boolean(row.isActive),
      createdAt: String(row.createdAt ?? ""),
      updatedAt: String(row.updatedAt ?? ""),
    }));

    return {
      settings,
      posts,
      // Computed once, server-side, so every visitor derives the same lap time
      // and the marquee speed stays consistent between visits.
      durationSeconds: marqueeDurationSeconds(
        settings.scrollSpeed,
        posts.length
      ),
    };
  }),

  /** Public cover-image lookup, separate so resolving images never delays feed copy. */
  instagramThumbnails: publicProcedure
    .input(
      z.object({
        shortcodes: z
          .array(
            z
              .string()
              .trim()
              .regex(/^[A-Za-z0-9_-]{1,64}$/)
          )
          .min(1)
          .max(INSTAGRAM_LIMITS.maxItems),
      })
    )
    .query(async ({ ctx, input }) => {
      publicRateLimit(clientThrottleKey(ctx.req, "instagram_thumbnails"));
      const shortcodes = [...new Set(input.shortcodes)];
      const entries = await Promise.all(
        shortcodes.map(
          async shortcode =>
            [shortcode, await resolveInstagramThumbnail(shortcode)] as const
        )
      );
      return Object.fromEntries(entries);
    }),

  // ── Storefront charge quote (packing/delivery/taxes for an outlet) ──
  settings: router({
    charges: publicProcedure
      .input(
        z.object({
          outletId: z.number().int().positive(),
          type: z.enum(["delivery", "takeaway", "dine_in"]),
          taxable: z.number().min(0).max(1_000_000),
        })
      )
      .query(async ({ ctx, input }) => {
        publicRateLimit(clientThrottleKey(ctx.req, "charges_quote"));
        const supabase = getSupabaseAdmin();
        const { data: outletRow, error: outletErr } = await supabase
          .from("outlets")
          .select("*")
          .eq("id", input.outletId)
          .limit(1)
          .maybeSingle();
        if (outletErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: outletErr.message,
          });
        if (!outletRow)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Selected outlet not found.",
          });
        const config = await resolveChargeConfig(supabase, outletRow);
        const quote = computeOrderQuote({
          type: input.type,
          taxable: input.taxable,
          ...config,
        });
        return {
          outletId: input.outletId,
          ...quote,
          freeDeliveryAbove: config.freeDeliveryAbove,
          packingCharge: config.packingCharge,
          deliveryFee: config.deliveryFee,
        };
      }),
  }),

  // ── Orders: public creation (server-authoritative pricing) ──
  orders: router({
    create: publicProcedure
      .input(
        z.object({
          outletId: z.number().int().positive(),
          type: z.enum(["dine_in", "takeaway", "delivery"]),
          customer: z.object({
            name: z.string().trim().min(1).max(160),
            phone: z.string().trim().min(8).max(32),
            address: z.string().trim().max(1000).nullable().optional(),
            email: z.string().trim().email().max(320).nullable().optional(),
          }),
          notes: z.string().trim().max(1000).nullable().optional(),
          couponCode: z.string().trim().max(40).nullable().optional(),
          idempotencyKey: z.string().trim().max(80).nullable().optional(),
          items: z
            .array(
              z.object({
                menuItemId: z.number().int().positive(),
                variantId: z.number().int().positive(),
                quantity: z.number().int().min(1).max(99),
                selectedModifiers: z
                  .array(
                    z.object({
                      name: z.string().min(1).max(120),
                      priceDelta: z.number().min(-100000).max(100000),
                      groupId: z.number().int().positive().optional(),
                      optionId: z.number().int().positive().optional(),
                    })
                  )
                  .max(30)
                  .nullable()
                  .optional(),
              })
            )
            .min(1)
            .max(40),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await publicWriteRateLimit(clientThrottleKey(ctx.req, "order_create"));
        const supabase = getSupabaseAdmin();

        // ── Validate outlet ──
        const { data: outletRow, error: outletErr } = await supabase
          .from("outlets")
          .select("*")
          .eq("id", input.outletId)
          .limit(1)
          .maybeSingle();
        if (outletErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: outletErr.message,
          });
        if (!outletRow)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Selected outlet not found.",
          });
        const outlet = outletRow as any;
        if (outlet.status !== "active")
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Selected outlet is not accepting orders right now.",
          });
        const services = outlet.services as any;
        if (input.type === "delivery" && services && !services.delivery)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Delivery not available at this outlet.",
          });
        if (input.type === "takeaway" && services && !services.takeaway)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Takeaway not available at this outlet.",
          });
        if (input.type === "dine_in" && services && !services.dineIn)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Dine-in not available at this outlet.",
          });
        if (input.type === "delivery" && !input.customer.address)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Delivery address is required.",
          });

        // ── Idempotency: check by key ──
        if (input.idempotencyKey) {
          // Canonical idempotency lives on orders.idempotencyKey (unique index).
          const { data: existingOrder } = await supabase
            .from("orders")
            .select("*")
            .eq("idempotencyKey", input.idempotencyKey)
            .limit(1)
            .maybeSingle();
          if (existingOrder) {
            const o: any = existingOrder;
            return {
              id: o.id,
              orderNumber: o.orderNumber,
              status: o.status,
              subtotal: toNum(o.subtotal),
              couponDiscount: toNum(o.couponDiscount),
              charges: 0,
              total: toNum(o.total),
              outletId: o.outletId,
              already: true,
            };
          }
          // Legacy: coupon redemptions stored the key before orders did.
          const { data: existingRedeem } = await supabase
            .from("coupon_redemptions")
            .select("*")
            .eq("idempotencyKey", input.idempotencyKey)
            .limit(1)
            .maybeSingle();
          if (existingRedeem) {
            const { data: ord } = await supabase
              .from("orders")
              .select("*")
              .eq("id", (existingRedeem as any).orderId)
              .limit(1)
              .maybeSingle();
            if (ord)
              return {
                id: (ord as any).id,
                orderNumber: (ord as any).orderNumber,
                status: (ord as any).status,
                subtotal: toNum((ord as any).subtotal),
                couponDiscount: toNum((ord as any).couponDiscount),
                charges: 0,
                total: toNum((ord as any).total),
                outletId: (ord as any).outletId,
                already: true,
              };
          }
          // Check orders created in last 5 minutes with same phone+outlet+type (fallback dedup)
          const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
          const { data: recentOrders } = await supabase
            .from("orders")
            .select(
              "id,customerId,outletId,type,createdAt,orderNumber,status,total,subtotal"
            )
            .eq("outletId", input.outletId)
            .eq("type", input.type)
            .gte("createdAt", fiveMinAgo)
            .limit(20);
          if ((recentOrders ?? []).length) {
            const cIds = Array.from(
              new Set(
                (recentOrders as any[]).map(r => r.customerId).filter(Boolean)
              )
            );
            const phoneByCustomerId = new Map<number, string>();
            if (cIds.length) {
              const { data: custs } = await supabase
                .from("customers")
                .select("id,phone")
                .in("id", cIds);
              for (const c of (custs ?? []) as any[])
                phoneByCustomerId.set(c.id, c.phone);
            }
            for (const r of recentOrders as any[]) {
              const ph = r.customerId
                ? phoneByCustomerId.get(r.customerId)
                : null;
              if (ph === input.customer.phone) {
                const { data: lines } = await supabase
                  .from("order_items")
                  .select("*")
                  .eq("orderId", r.id);
                const arr = (lines ?? []) as any[];
                if (
                  arr.length === input.items.length &&
                  arr.every(
                    (l: any, i: number) =>
                      l.menuItemId === input.items[i].menuItemId &&
                      l.quantity === input.items[i].quantity
                  )
                ) {
                  return {
                    id: r.id,
                    orderNumber: r.orderNumber,
                    status: r.status,
                    total: toNum(r.total),
                    subtotal: toNum(r.subtotal),
                    already: true,
                  };
                }
              }
            }
          }
        }

        // ── Load menu items + variants + validate availability + comingSoon + compute authoritative pricing ──
        const itemIds = input.items.map(i => i.menuItemId);
        const { data: menuRows } = await supabase
          .from("menu_items")
          .select("*")
          .in("id", itemIds);
        const menuById = new Map((menuRows ?? []).map((r: any) => [r.id, r]));
        // Category comingSoon map (category-level comingSoon blocks purchasing of its products)
        const categoryIdsForCheck = Array.from(
          new Set(
            (menuRows ?? []).map((r: any) => r.categoryId).filter(Boolean)
          )
        );
        const catComingSoonMap = new Map<number, boolean>();
        if (categoryIdsForCheck.length) {
          const { data: catRows } = await supabase
            .from("menu_categories")
            .select("id,comingSoon")
            .in("id", categoryIdsForCheck);
          for (const c of (catRows ?? []) as any[])
            catComingSoonMap.set(c.id, Boolean(c.comingSoon));
        }
        // availability (product-level, variant is sellable)
        const { data: avRows } = await supabase
          .from("outlet_menu_availability")
          .select("*")
          .eq("outletId", input.outletId);
        const avMap = new Map(
          (avRows ?? []).map((r: any) => [
            r.menuItemId,
            { available: r.available },
          ])
        );
        // variants for pricing/validation — variantId is now required
        const variantIds = input.items.map(i => i.variantId) as number[];
        const variantById = new Map<number, any>();
        const variantAvMap = new Map<number, any>();
        if (variantIds.length) {
          const { data: vRows } = await supabase
            .from("menu_item_variants")
            .select("*")
            .in("id", variantIds);
          for (const v of (vRows ?? []) as any[]) variantById.set(v.id, v);
          const { data: ovRows } = await supabase
            .from("outlet_variant_availability")
            .select("*")
            .eq("outletId", input.outletId);
          for (const r of (ovRows ?? []) as any[])
            variantAvMap.set(r.variantId, r);
        }

        // Load modifier options for validation
        const allOptionIds = input.items.flatMap(
          i =>
            (i.selectedModifiers ?? [])
              .map(m => m.optionId)
              .filter(Boolean) as number[]
        );
        const optionMap = new Map<number, any>();
        if (allOptionIds.length) {
          const { data: opts } = await supabase
            .from("modifier_options")
            .select("*")
            .in("id", allOptionIds);
          for (const o of (opts ?? []) as any[]) optionMap.set(o.id, o);
        }

        let subtotal = 0;
        const validatedLines: Array<{
          menuItemId: number;
          variantId: number;
          itemName: string;
          variantName: string | null;
          variantQuantity: number | null;
          variantUnit: string | null;
          sku: string | null;
          unitPrice: number;
          quantity: number;
          selectedModifiers: any[];
          lineTotal: number;
        }> = [];
        for (const it of input.items) {
          const menu = menuById.get(it.menuItemId) as any;
          if (!menu)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Menu item ${it.menuItemId} not found.`,
            });
          // Coming Soon check — server-authoritative block (cannot be bypassed via API)
          const isCategoryComingSoon =
            catComingSoonMap.get(menu.categoryId) ?? false;
          const isItemComingSoon = Boolean(menu.comingSoon);
          if (isItemComingSoon || isCategoryComingSoon) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `${menu.name} is COMING SOON and cannot be ordered yet.`,
            });
          }
          const av = avMap.get(it.menuItemId);
          const available = av
            ? av.available && menu.available
            : menu.available;
          if (!available)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `${menu.name} is not available at this outlet.`,
            });
          // Variant handling — server authoritative
          let vName: string | null = null;
          let vQty: number | null = null;
          let vUnit: string | null = null;
          let vSku: string | null = null;
          const vId: number = it.variantId;
          if (!vId)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Please select a size for ${menu.name}.`,
            });
          const variant = variantById.get(vId);
          if (!variant)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Variant ${vId} not found.`,
            });
          if (Number(variant.menuItemId) !== Number(it.menuItemId))
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Variant does not belong to ${menu.name}.`,
            });
          const vAv = variantAvMap.get(variant.id);
          const variantAvailable =
            variant.available && (vAv ? vAv.available : true) && available;
          if (!variantAvailable)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `${menu.name} — ${variant.name} is not available.`,
            });
          const basePrice = toNum(vAv?.priceOverride ?? variant.price);
          vName = variant.name;
          vQty = variant.quantity != null ? toNum(variant.quantity) : null;
          vUnit = variant.unit ?? null;
          vSku = variant.sku ?? null;
          // modifiers validation: priceDelta must match DB if optionId provided, otherwise trust client delta but cap
          let modifiersTotal = 0;
          const mods: any[] = [];
          for (const m of it.selectedModifiers ?? []) {
            if (m.optionId) {
              const opt = optionMap.get(m.optionId);
              if (!opt)
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: `Modifier option ${m.optionId} not found.`,
                });
              const delta = toNum(opt.priceDelta);
              if (Math.abs(delta - m.priceDelta) > 0.01)
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: `Invalid modifier price for ${m.name}.`,
                });
              modifiersTotal += delta;
              mods.push({
                name: opt.name,
                priceDelta: delta,
                groupId: m.groupId,
                optionId: m.optionId,
              });
            } else {
              // Security: never trust a client-supplied modifier price. Every
              // modifier must reference a real modifier_options row by id.
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Invalid modifier selection for ${m.name}. Please reselect the item.`,
              });
            }
          }
          const unitPrice = basePrice + modifiersTotal;
          const lineTotal = unitPrice * it.quantity;
          subtotal += lineTotal;
          validatedLines.push({
            menuItemId: it.menuItemId,
            variantId: vId,
            itemName: menu.name,
            variantName: vName,
            variantQuantity: vQty,
            variantUnit: vUnit,
            sku: vSku,
            unitPrice,
            quantity: it.quantity,
            selectedModifiers: mods,
            lineTotal,
          });
        }

        // ── Coupon revalidation (server-authoritative) ──
        let couponDiscount = 0;
        let couponId: number | null = null;
        let couponCode: string | null = null;
        if (input.couponCode) {
          const code = input.couponCode
            .trim()
            .toUpperCase()
            .replace(/\s+/g, "");
          const { data: crow } = await supabase
            .from("coupons")
            .select("*")
            .eq("code", code)
            .limit(1)
            .maybeSingle();
          if (!crow)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Coupon not found.",
            });
          const c: any = crow;
          const dStatus = derivedStatus(c);
          if (dStatus !== "active")
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Coupon is ${dStatus}.`,
            });
          const now = new Date();
          if (c.startAt && new Date(c.startAt) > now)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Coupon not yet active.",
            });
          if (c.endAt && new Date(c.endAt) < now)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Coupon expired.",
            });
          if (c.usageLimit && toNum(c.usedCount) >= toNum(c.usageLimit))
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Coupon usage limit reached.",
            });
          if (
            c.applicableOutlets &&
            !(c.applicableOutlets as number[]).includes(input.outletId)
          )
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Coupon not valid for this outlet.",
            });
          if (c.orderTypes && !(c.orderTypes as string[]).includes(input.type))
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Coupon not valid for ${input.type} orders.`,
            });
          // resolve customer for eligibility checks
          const { data: custForCoupon } = await supabase
            .from("customers")
            .select("*")
            .eq("phone", input.customer.phone.trim())
            .limit(1)
            .maybeSingle();
          let custCount = 0;
          if (custForCoupon) {
            const { data: co } = await supabase
              .from("orders")
              .select("id")
              .eq("customerId", (custForCoupon as any).id)
              .neq("status", "cancelled");
            custCount = (co ?? []).length;
            if (c.perCustomerLimit) {
              const { data: pc } = await supabase
                .from("coupon_redemptions")
                .select("id")
                .eq("couponId", (c as any).id)
                .eq("customerId", (custForCoupon as any).id)
                .eq("status", "applied");
              if ((pc ?? []).length >= (c as any).perCustomerLimit)
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: "Per-customer coupon limit reached.",
                });
            }
          }
          if ((c as any).customerEligibility === "new" && custCount > 0)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Coupon only for new customers.",
            });
          if ((c as any).customerEligibility === "returning" && custCount === 0)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Coupon only for returning customers.",
            });
          if ((c as any).customerEligibility === "vip" && custCount < 5)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Coupon only for VIP customers.",
            });
          // product/category filter
          if (c.applicableProducts?.length || c.applicableCategories?.length) {
            const hasEligible = validatedLines.some(l => {
              const menu = menuById.get(l.menuItemId) as any;
              if (
                c.excludeProducts &&
                (c.excludeProducts as number[]).includes(l.menuItemId)
              )
                return false;
              if (
                c.excludeCategories &&
                (c.excludeCategories as number[]).includes(menu?.categoryId)
              )
                return false;
              if (
                c.applicableProducts &&
                (c.applicableProducts as number[]).includes(l.menuItemId)
              )
                return true;
              if (
                c.applicableCategories &&
                (c.applicableCategories as number[]).includes(menu?.categoryId)
              )
                return true;
              return false;
            });
            if (!hasEligible)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Coupon not applicable to items in cart.",
              });
          }
          let eligibleAmount = subtotal;
          if (
            c.applicableProducts?.length ||
            c.applicableCategories?.length ||
            c.excludeProducts?.length ||
            c.excludeCategories?.length
          ) {
            eligibleAmount = 0;
            const hasInclude =
              (c.applicableProducts && c.applicableProducts.length) ||
              (c.applicableCategories && c.applicableCategories.length);
            for (const l of validatedLines) {
              const menu = menuById.get(l.menuItemId) as any;
              if (
                c.excludeProducts &&
                (c.excludeProducts as number[]).includes(l.menuItemId)
              )
                continue;
              if (
                c.excludeCategories &&
                (c.excludeCategories as number[]).includes(menu?.categoryId)
              )
                continue;
              if (hasInclude) {
                const inProd =
                  c.applicableProducts &&
                  (c.applicableProducts as number[]).includes(l.menuItemId);
                const inCat =
                  c.applicableCategories &&
                  (c.applicableCategories as number[]).includes(
                    menu?.categoryId
                  );
                if (!inProd && !inCat) continue;
              }
              eligibleAmount += l.lineTotal;
            }
          }
          if (toNum(c.minimumOrder) > eligibleAmount)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Minimum order ₹${c.minimumOrder} required for this coupon.`,
            });
          if (c.discountType === "percentage") {
            couponDiscount = eligibleAmount * (toNum(c.discountValue) / 100);
            if (c.maximumDiscount)
              couponDiscount = Math.min(
                couponDiscount,
                toNum(c.maximumDiscount)
              );
          } else if (c.discountType === "fixed") {
            couponDiscount = Math.min(toNum(c.discountValue), eligibleAmount);
          } else if (c.discountType === "free_delivery") {
            couponDiscount = 0; // delivery fee waived later if applicable
          }
          couponDiscount = Math.min(couponDiscount, subtotal);
          couponId = c.id;
          couponCode = c.code;
        }

        // ── Charges + taxes (configurable, server-authoritative) ──
        const chargeConfig = await resolveChargeConfig(supabase, outlet);
        // free_delivery coupon waives delivery fee
        let freeDeliveryCoupon = false;
        if (couponId) {
          const { data: crow } = await supabase
            .from("coupons")
            .select("discountType")
            .eq("id", couponId as number)
            .limit(1)
            .maybeSingle();
          if ((crow as any)?.discountType === "free_delivery")
            freeDeliveryCoupon = true;
        }
        const taxable = subtotal - couponDiscount;
        const quote = computeOrderQuote({
          type: input.type,
          taxable,
          ...chargeConfig,
          freeDelivery: freeDeliveryCoupon,
        });
        const chargesTotal = quote.chargesTotal;
        const total = quote.total;

        // Minimum order check for outlet
        if (
          toNum(outlet.minimumOrder) > 0 &&
          total < toNum(outlet.minimumOrder)
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Minimum order ₹${outlet.minimumOrder} required for this outlet.`,
          });
        }

        // ── Upsert customer ──
        let customerId: number | null = null;
        const phoneNorm = input.customer.phone.trim();
        const { data: existingCust } = await supabase
          .from("customers")
          .select("*")
          .eq("phone", phoneNorm)
          .limit(1)
          .maybeSingle();
        if (existingCust) {
          customerId = (existingCust as any).id;
          // update name/email if newer
          if (
            input.customer.name &&
            input.customer.name !== (existingCust as any).name
          ) {
            await supabase
              .from("customers")
              .update({
                name: input.customer.name,
                email: input.customer.email ?? (existingCust as any).email,
              } as any)
              .eq("id", customerId as number);
          }
        } else {
          const { data: ins, error: insErr } = await supabase
            .from("customers")
            .insert({
              phone: phoneNorm,
              name: input.customer.name,
              email: input.customer.email ?? null,
            } as any)
            .select("id")
            .single();
          if (insErr)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: insErr.message,
            });
          customerId = Number((ins as any).id);
        }

        // ── Generate orderNumber (max +1, race-safe via unique index retry) + active shift ──
        const sql = await getSql();
        let maxRow: any[] = [];
        try {
          maxRow = await sql.unsafe(
            `SELECT COALESCE(MAX("orderNumber"), 1000)::int as max FROM "orders"`
          );
        } catch {
          maxRow = [{ max: 1000 }];
        }
        let orderNumber = Number(maxRow[0]?.max ?? 1000) + 1;
        let activeShiftId: number | null = null;
        try {
          const sh = await sql.unsafe(
            `SELECT "id" FROM "shifts" WHERE "active" = true ORDER BY "startedAt" DESC LIMIT 1`
          );
          activeShiftId = sh[0]?.id ?? null;
        } catch {
          const { data: sd } = await supabase
            .from("shifts")
            .select("id")
            .eq("active", true)
            .order("startedAt", { ascending: false })
            .limit(1)
            .maybeSingle();
          activeShiftId = (sd as any)?.id ?? null;
        }

        // ── Atomic insert via Postgres transaction (getSql) ──
        let resultOrder: any = null;
        let already = false;

        try {
          const txResult: any = await sql.begin(async (tx: any) => {
            // Idempotency re-check inside the transaction (covers coupon-less orders).
            if (input.idempotencyKey) {
              const dupOrder = await tx.unsafe(
                `SELECT * FROM "orders" WHERE "idempotencyKey" = $1 LIMIT 1`,
                [input.idempotencyKey]
              );
              if (dupOrder[0]) return { already: true, order: dupOrder[0] };
            }
            // re-check coupon usage inside tx
            if (couponId) {
              const freshRows = await tx.unsafe(
                `SELECT * FROM "coupons" WHERE "id" = $1 LIMIT 1`,
                [couponId]
              );
              const fresh = freshRows[0];
              if (!fresh)
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: "Coupon not found (race).",
                });
              if (
                fresh.usageLimit &&
                toNum(fresh.usedCount) >= toNum(fresh.usageLimit)
              )
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: "Coupon just reached its limit. Try without coupon.",
                });
              if (fresh.perCustomerLimit && customerId) {
                const pc = await tx.unsafe(
                  `SELECT "id" FROM "coupon_redemptions" WHERE "couponId" = $1 AND "customerId" = $2 AND "status" = 'applied'`,
                  [couponId, customerId]
                );
                if (pc.length >= fresh.perCustomerLimit)
                  throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Per-customer limit reached (race).",
                  });
              }
              // idempotency inside tx
              if (input.idempotencyKey) {
                const dup = await tx.unsafe(
                  `SELECT * FROM "coupon_redemptions" WHERE "idempotencyKey" = $1 LIMIT 1`,
                  [input.idempotencyKey]
                );
                if (dup[0]) {
                  const ord = await tx.unsafe(
                    `SELECT * FROM "orders" WHERE "id" = $1 LIMIT 1`,
                    [dup[0].orderId]
                  );
                  if (ord[0]) return { already: true, order: ord[0] };
                }
              }
            }

            let insertedOrder: any = null;
            // try with incrementing orderNumber on conflict
            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                const rows = await tx.unsafe(
                  `INSERT INTO "orders" ("orderNumber","customerId","outletId","shiftId","type","source","status","subtotal","total","paymentStatus","couponId","couponCode","couponDiscount","notes","idempotencyKey") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
                  [
                    orderNumber,
                    customerId,
                    input.outletId,
                    activeShiftId,
                    input.type,
                    "website",
                    "new",
                    subtotal.toFixed(2),
                    total.toFixed(2),
                    "unpaid",
                    couponId,
                    couponCode,
                    couponDiscount.toFixed(2),
                    input.notes ?? null,
                    input.idempotencyKey ?? null,
                  ]
                );
                insertedOrder = rows[0];
                break;
              } catch (e: any) {
                const msg = String(e?.message ?? "");
                if (/duplicate|unique/i.test(msg) && attempt < 2) {
                  orderNumber += 1;
                  continue;
                }
                throw e;
              }
            }
            if (!insertedOrder) throw new Error("Failed to insert order");
            const orderId = insertedOrder.id;

            // insert order items
            for (const l of validatedLines) {
              await tx.unsafe(
                `INSERT INTO "order_items" ("orderId","menuItemId","variantId","itemName","variantName","variantQuantity","variantUnit","sku","unitPrice","quantity","selectedModifiers","lineTotal") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)`,
                [
                  orderId,
                  l.menuItemId,
                  l.variantId,
                  l.itemName,
                  l.variantName,
                  l.variantQuantity != null ? String(l.variantQuantity) : null,
                  l.variantUnit,
                  l.sku,
                  l.unitPrice.toFixed(2),
                  l.quantity,
                  // Pass the array itself, not JSON.stringify(...). A JS string
                  // handed to a jsonb parameter is JSON-encoded a second time by
                  // the driver, so the column ended up holding the string "[]"
                  // instead of an array — which crashed the Admin order dialog
                  // on "item.selectedModifiers.map is not a function".
                  l.selectedModifiers ?? [],
                  l.lineTotal.toFixed(2),
                ]
              );
            }

            // ── Inventory consumption (variant-aware, best-effort) ──
            try {
              for (const line of validatedLines) {
                let ingredients: any[] = [];
                if (line.variantId) {
                  const vIngs = await tx.unsafe(
                    `SELECT * FROM "menu_variant_ingredients" WHERE "variantId" = $1`,
                    [line.variantId]
                  );
                  if ((vIngs as any[]).length) ingredients = vIngs as any[];
                  else {
                    const pIngs = await tx.unsafe(
                      `SELECT * FROM "menu_item_ingredients" WHERE "menuItemId" = $1`,
                      [line.menuItemId]
                    );
                    ingredients = pIngs as any[];
                  }
                } else {
                  const pIngs = await tx.unsafe(
                    `SELECT * FROM "menu_item_ingredients" WHERE "menuItemId" = $1`,
                    [line.menuItemId]
                  );
                  ingredients = pIngs as any[];
                }
                for (const ing of ingredients) {
                  const need = Number(ing.quantityPerSale) * line.quantity;
                  const invRows = await tx.unsafe(
                    `SELECT * FROM "inventory_items" WHERE "id" = $1 LIMIT 1`,
                    [ing.inventoryItemId]
                  );
                  const inv = (invRows as any[])[0];
                  if (!inv) continue;
                  const prev = toNum(inv.quantity);
                  const next = Math.max(0, prev - need);
                  await tx.unsafe(
                    `UPDATE "inventory_items" SET "quantity" = $1 WHERE "id" = $2`,
                    [String(next), ing.inventoryItemId]
                  );
                  await tx.unsafe(
                    `INSERT INTO "inventory_transactions" ("inventoryItemId","type","quantityChange","previousQuantity","newQuantity","reason","referenceType","referenceId","createdBy") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                    [
                      ing.inventoryItemId,
                      "consumption",
                      String(-need),
                      String(prev),
                      String(next),
                      `Order #${orderNumber} — ${line.itemName}${line.variantName ? ` ${line.variantName}` : ""}`,
                      "order",
                      orderId,
                      null,
                    ]
                  );
                }
              }
            } catch {}

            if (couponId && couponDiscount >= 0) {
              const key =
                input.idempotencyKey ?? `order-${orderId}-coupon-${couponId}`;
              await tx.unsafe(
                `INSERT INTO "coupon_redemptions" ("couponId","customerId","orderId","outletId","discountAmount","status","idempotencyKey") VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT ("idempotencyKey") DO NOTHING`,
                [
                  couponId,
                  customerId,
                  orderId,
                  input.outletId,
                  couponDiscount.toFixed(2),
                  "applied",
                  key,
                ]
              );
              await tx.unsafe(
                `UPDATE "coupons" SET "usedCount" = "usedCount" + 1 WHERE "id" = $1`,
                [couponId]
              );
            }

            const orderRows = await tx.unsafe(
              `SELECT * FROM "orders" WHERE "id" = $1 LIMIT 1`,
              [insertedOrder.id]
            );
            return { already: false, order: orderRows[0] };
          });

          if (txResult.already) {
            already = true;
            resultOrder = txResult.order;
          } else {
            resultOrder = txResult.order;
          }
        } catch (e: any) {
          if (e instanceof TRPCError) throw e;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: e.message ?? "Failed to create order.",
          });
        }

        return {
          id: resultOrder.id,
          orderNumber: resultOrder.orderNumber,
          status: resultOrder.status,
          subtotal,
          couponDiscount,
          charges: chargesTotal,
          tax: quote.tax,
          total,
          outletId: input.outletId,
          already,
        };
      }),

    // Public status polling (for web order tracking). Requires the order's
    // phone number to prevent sequential order enumeration / PII disclosure.
    trackToken: publicProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          phone: z.string().trim().min(8).max(32),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await publicWriteRateLimit(clientThrottleKey(ctx.req, "track_token"));
        const supabase = getSupabaseAdmin();
        const { data: order, error: oErr } = await supabase
          .from("orders")
          .select("id,customerId")
          .eq("id", input.id)
          .limit(1)
          .maybeSingle();
        if (oErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: oErr.message,
          });
        if (!order)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Order not found.",
          });
        let customerPhone: string | null = null;
        if ((order as any).customerId) {
          const { data: cust } = await supabase
            .from("customers")
            .select("phone")
            .eq("id", (order as any).customerId)
            .limit(1)
            .maybeSingle();
          customerPhone = (cust as any)?.phone ?? null;
        }
        if (!customerPhone || customerPhone !== input.phone.trim())
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Order not found.",
          });
        const { createTrackToken } = await import("../auth/auth");
        return { token: await createTrackToken(input.id) };
      }),
    byId: publicProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          phone: z.string().trim().min(8).max(32),
        })
      )
      .query(async ({ ctx, input }) => {
        await publicWriteRateLimit(clientThrottleKey(ctx.req, "order_status"));
        const supabase = getSupabaseAdmin();
        const { data: order, error: oErr } = await supabase
          .from("orders")
          .select("*")
          .eq("id", input.id)
          .limit(1)
          .maybeSingle();
        if (oErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: oErr.message,
          });
        if (!order)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Order not found.",
          });
        let customerPhone: string | null = null;
        if ((order as any).customerId) {
          const { data: cust } = await supabase
            .from("customers")
            .select("phone")
            .eq("id", (order as any).customerId)
            .limit(1)
            .maybeSingle();
          customerPhone = (cust as any)?.phone ?? null;
        }
        // Generic NOT_FOUND on mismatch so callers cannot probe which order ids exist.
        if (!customerPhone || customerPhone !== input.phone.trim())
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Order not found.",
          });
        const { data: lines } = await supabase
          .from("order_items")
          .select("*")
          .eq("orderId", input.id);
        return {
          ...(order as any),
          subtotal: toNum((order as any).subtotal),
          total: toNum((order as any).total),
          couponDiscount: toNum((order as any).couponDiscount),
          items: ((lines ?? []) as any[]).map((l: any) => ({
            ...l,
            selectedModifiers: normalizeSelectedModifiers(l.selectedModifiers),
            lineTotal: toNum(l.lineTotal),
            unitPrice: l.unitPrice != null ? toNum(l.unitPrice) : null,
            variantQuantity:
              l.variantQuantity != null ? toNum(l.variantQuantity) : null,
          })),
        };
      }),
    byNumber: publicProcedure
      .input(
        z.object({
          orderNumber: z.number().int().positive(),
          phone: z.string().trim().min(8).max(32),
        })
      )
      .query(async ({ ctx, input }) => {
        await publicWriteRateLimit(clientThrottleKey(ctx.req, "order_status"));
        const supabase = getSupabaseAdmin();
        const { data: order, error: oErr } = await supabase
          .from("orders")
          .select("*")
          .eq("orderNumber", input.orderNumber)
          .limit(1)
          .maybeSingle();
        if (oErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: oErr.message,
          });
        if (!order)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Order not found.",
          });
        let customerPhone: string | null = null;
        if ((order as any).customerId) {
          const { data: cust } = await supabase
            .from("customers")
            .select("phone")
            .eq("id", (order as any).customerId)
            .limit(1)
            .maybeSingle();
          customerPhone = (cust as any)?.phone ?? null;
        }
        if (!customerPhone || customerPhone !== input.phone.trim())
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Order not found.",
          });
        const { data: lines } = await supabase
          .from("order_items")
          .select("*")
          .eq("orderId", (order as any).id);
        return {
          ...(order as any),
          subtotal: toNum((order as any).subtotal),
          total: toNum((order as any).total),
          couponDiscount: toNum((order as any).couponDiscount),
          items: ((lines ?? []) as any[]).map((l: any) => ({
            ...l,
            selectedModifiers: normalizeSelectedModifiers(l.selectedModifiers),
            lineTotal: toNum(l.lineTotal),
            unitPrice: l.unitPrice != null ? toNum(l.unitPrice) : null,
            variantQuantity:
              l.variantQuantity != null ? toNum(l.variantQuantity) : null,
          })),
        };
      }),
  }),
});
