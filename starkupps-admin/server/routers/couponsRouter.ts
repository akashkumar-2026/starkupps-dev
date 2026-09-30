import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  assertOutletAccess,
  getOutletScope,
  hasPermission,
  recordAudit,
  resolveStaffRole,
} from "../db/index";
import { protectedProcedure, router } from "../lib/trpc";
import { getSupabaseAdmin, getSql } from "../db/supabase";

// Helpers
async function need(user: any, perm: any) {
  const r = await resolveStaffRole(user);
  if (!r || !hasPermission(r, perm))
    throw new TRPCError({ code: "FORBIDDEN", message: "Access denied." });
  return r;
}
function normalizeCode(code: string) {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}
function derivedStatus(coupon: any): string {
  const now = new Date();
  const status = coupon.status as string;
  if (status === "archived") return "archived";
  if (status === "paused") return "paused";
  if (status === "draft") return "draft";
  if (
    coupon.usageLimit &&
    Number(coupon.usedCount) >= Number(coupon.usageLimit)
  )
    return "exhausted";
  if (coupon.startAt && new Date(coupon.startAt) > now) return "scheduled";
  if (coupon.endAt && new Date(coupon.endAt) < now) return "expired";
  if (status === "expired") return "expired";
  if (status === "exhausted") return "exhausted";
  return "active";
}
function toNum(v: any) {
  return Number(v ?? 0);
}

// Centralized validation engine
async function validateCouponEngine(
  coupon: any,
  ctx: {
    customerId?: number | null;
    outletId?: number | null;
    orderType?: string | null;
    paymentMethod?: string | null;
    orderAmount: number;
    eligibleAmount: number;
    items?: Array<{
      menuItemId?: number | null;
      categoryId?: number | null;
      quantity: number;
      lineTotal: number;
    }>;
    customerOrdersCount?: number;
    existingCouponOnOrder?: boolean;
  }
) {
  const now = new Date();
  const dStatus = derivedStatus(coupon);
  if (dStatus !== "active")
    return { valid: false, reason: `Coupon is ${dStatus}.` };
  if (coupon.startAt && new Date(coupon.startAt) > now)
    return { valid: false, reason: "Coupon not yet active." };
  if (coupon.endAt && new Date(coupon.endAt) < now)
    return { valid: false, reason: "Coupon expired." };
  if (coupon.usageLimit && toNum(coupon.usedCount) >= toNum(coupon.usageLimit))
    return { valid: false, reason: "Coupon usage limit reached." };
  // Outlet
  if (
    coupon.applicableOutlets &&
    ctx.outletId &&
    !(coupon.applicableOutlets as number[]).includes(ctx.outletId)
  )
    return { valid: false, reason: "Coupon not applicable for this outlet." };
  // Order type
  if (
    coupon.orderTypes &&
    ctx.orderType &&
    !(coupon.orderTypes as string[]).includes(ctx.orderType)
  )
    return {
      valid: false,
      reason: `Coupon not valid for ${ctx.orderType} orders.`,
    };
  // Payment method
  if (
    coupon.paymentMethods &&
    ctx.paymentMethod &&
    !(coupon.paymentMethods as string[]).includes(ctx.paymentMethod)
  )
    return {
      valid: false,
      reason: "Coupon not valid for this payment method.",
    };
  // Customer eligibility
  const elig = coupon.customerEligibility as string;
  if (elig === "new" && (ctx.customerOrdersCount ?? 0) > 0)
    return { valid: false, reason: "Coupon only for first-time customers." };
  if (elig === "returning" && (ctx.customerOrdersCount ?? 0) === 0)
    return { valid: false, reason: "Coupon only for returning customers." };
  if (elig === "vip" && (ctx.customerOrdersCount ?? 0) < 5)
    return { valid: false, reason: "Coupon only for VIP customers." }; // simplistic: 5+ orders
  // Product/category eligibility
  if (ctx.items && ctx.items.length) {
    const applicableProducts = coupon.applicableProducts as number[] | null;
    const applicableCategories = coupon.applicableCategories as number[] | null;
    const excludeProducts = coupon.excludeProducts as number[] | null;
    const excludeCategories = coupon.excludeCategories as number[] | null;
    const hasFilter =
      (applicableProducts && applicableProducts.length) ||
      (applicableCategories && applicableCategories.length);
    if (hasFilter) {
      const hasEligible = ctx.items.some(it => {
        if (
          excludeProducts &&
          it.menuItemId &&
          excludeProducts.includes(it.menuItemId)
        )
          return false;
        if (
          excludeCategories &&
          it.categoryId &&
          excludeCategories.includes(it.categoryId)
        )
          return false;
        if (
          applicableProducts &&
          it.menuItemId &&
          applicableProducts.includes(it.menuItemId)
        )
          return true;
        if (
          applicableCategories &&
          it.categoryId &&
          applicableCategories.includes(it.categoryId)
        )
          return true;
        return false;
      });
      if (!hasEligible)
        return {
          valid: false,
          reason: "Coupon not applicable to items in cart.",
        };
    } else {
      // check excludes even when no include filter
      if (excludeProducts || excludeCategories) {
        const allExcluded = ctx.items.every(it => {
          if (
            excludeProducts &&
            it.menuItemId &&
            excludeProducts.includes(it.menuItemId)
          )
            return true;
          if (
            excludeCategories &&
            it.categoryId &&
            excludeCategories.includes(it.categoryId)
          )
            return true;
          return false;
        });
        if (allExcluded && ctx.items.length > 0)
          return { valid: false, reason: "Coupon excludes all items in cart." };
      }
    }
  }
  // Minimum order (against eligible amount)
  const checkAmount = ctx.eligibleAmount ?? ctx.orderAmount;
  if (toNum(coupon.minimumOrder) > checkAmount)
    return {
      valid: false,
      reason: `Minimum order ₹${coupon.minimumOrder} required.`,
    };
  // Stacking
  if (ctx.existingCouponOnOrder && !coupon.allowStacking)
    return {
      valid: false,
      reason: "Coupon cannot be stacked with another coupon.",
    };
  // Calculate discount (against eligible amount)
  let discount = 0;
  const eligible = ctx.eligibleAmount ?? ctx.orderAmount;
  if (coupon.discountType === "percentage") {
    discount = eligible * (toNum(coupon.discountValue) / 100);
    if (coupon.maximumDiscount)
      discount = Math.min(discount, toNum(coupon.maximumDiscount));
  } else if (coupon.discountType === "fixed") {
    discount = Math.min(toNum(coupon.discountValue), eligible);
  } else if (coupon.discountType === "free_delivery") {
    discount = 0; // delivery fee handled separately
  }
  discount = Math.min(discount, ctx.orderAmount);
  return { valid: true, discount, coupon };
}

export const couponsRouter = router({
  // KPI
  kpi: protectedProcedure.query(async ({ ctx }) => {
    await need(ctx.user, "coupons.read");
    const supabase = getSupabaseAdmin();
    const scope = await getOutletScope(ctx.user);

    const { data: allRaw, error: allErr } = await supabase
      .from("coupons")
      .select(
        "id,code,name,status,usageLimit,usedCount,startAt,endAt,applicableOutlets"
      )
      .order("createdAt", { ascending: false });
    if (allErr)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: allErr.message,
      });
    const all = (allRaw ?? []) as any[];

    // outlet scoping for KPI: only coupons applicable to scope
    let filtered = all;
    if (scope !== null && scope.length) {
      filtered = all.filter(
        (c: any) =>
          !c.applicableOutlets ||
          (c.applicableOutlets as number[]).some(id => scope.includes(id)) ||
          (c.applicableOutlets as number[]).length === 0
      );
    }
    const active = filtered.filter(
      (c: any) => derivedStatus(c) === "active"
    ).length;
    const scheduled = filtered.filter(
      (c: any) => derivedStatus(c) === "scheduled"
    ).length;
    const expired = filtered.filter(
      (c: any) => derivedStatus(c) === "expired"
    ).length;
    const exhausted = filtered.filter(
      (c: any) => derivedStatus(c) === "exhausted"
    ).length;

    // Aggregate redemptions in SQL instead of loading every redemption row.
    const scoped = scope !== null && scope.length > 0;
    const sql = await getSql();
    const scopeWhere = scoped
      ? `WHERE ("outletId" IS NULL OR "outletId" = ANY($1))`
      : "";
    const scopeParams: any[] = scoped ? [scope] : [];

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayParams: any[] = [todayStart.toISOString()];
    let todayWhere = `"createdAt" >= $1`;
    if (scoped) {
      todayWhere += ` AND ("outletId" IS NULL OR "outletId" = ANY($2))`;
      todayParams.push(scope);
    }
    const todayRows = (await sql.unsafe(
      `SELECT count(*)::int AS "c" FROM "coupon_redemptions" WHERE ${todayWhere}`,
      todayParams
    )) as any[];
    const usedToday = Number(todayRows[0]?.c ?? 0);

    const totalRows = (await sql.unsafe(
      `SELECT count(*)::int AS "c", COALESCE(sum("discountAmount"), 0) AS "d" FROM "coupon_redemptions" ${scopeWhere}`,
      scopeParams
    )) as any[];
    const totalRedemptions = Number(totalRows[0]?.c ?? 0);
    const discountGiven = Number(totalRows[0]?.d ?? 0);

    const topRows = (await sql.unsafe(
      `SELECT "couponId", count(*)::int AS "c" FROM "coupon_redemptions" ${scopeWhere} GROUP BY "couponId" ORDER BY "c" DESC LIMIT 1`,
      scopeParams
    )) as any[];
    const topCouponId =
      topRows[0]?.couponId != null ? Number(topRows[0].couponId) : null;
    const mostUsed =
      topCouponId != null
        ? filtered.find((c: any) => c.id === topCouponId)
        : null;

    return {
      active,
      scheduled,
      expired,
      exhausted,
      usedToday,
      totalRedemptions,
      discountGiven,
      mostUsed: mostUsed
        ? {
            code: mostUsed.code,
            name: mostUsed.name,
            count: Number(topRows[0]?.c ?? 0),
          }
        : null,
    };
  }),

  list: protectedProcedure
    .input(
      z
        .object({
          search: z.string().trim().max(80).optional(),
          status: z
            .enum([
              "draft",
              "scheduled",
              "active",
              "paused",
              "expired",
              "exhausted",
              "archived",
            ])
            .optional(),
          discountType: z
            .enum(["percentage", "fixed", "free_delivery"])
            .optional(),
          outletId: z.number().int().positive().optional(),
          customerEligibility: z
            .enum(["all", "new", "returning", "vip", "segment", "specific"])
            .optional(),
          from: z.date().optional(),
          to: z.date().optional(),
          limit: z.number().int().min(1).max(100).default(20),
          cursor: z.number().int().positive().optional(),
        })
        .nullish()
    )
    .query(async ({ ctx, input }) => {
      await need(ctx.user, "coupons.read");
      const scope = await getOutletScope(ctx.user);
      const limit = input?.limit ?? 20;

      if (input?.outletId) await assertOutletAccess(ctx.user, input.outletId);

      const conditions: string[] = [];
      const params: any[] = [];
      let idx = 1;
      if (input?.cursor) {
        conditions.push(`c."id" < $${idx++}`);
        params.push(input.cursor);
      }
      if (input?.discountType) {
        conditions.push(`c."discountType" = $${idx++}`);
        params.push(input.discountType);
      }
      if (input?.customerEligibility) {
        conditions.push(`c."customerEligibility" = $${idx++}`);
        params.push(input.customerEligibility);
      }
      if (input?.from) {
        conditions.push(`c."startAt" >= $${idx++}`);
        params.push(input.from.toISOString());
      }
      if (input?.to) {
        conditions.push(`c."endAt" <= $${idx++}`);
        params.push(input.to.toISOString());
      }
      if (input?.search) {
        const like = `%${input.search}%`;
        conditions.push(
          `(c."code" ILIKE $${idx} OR c."name" ILIKE $${idx} OR c."description" ILIKE $${idx})`
        );
        params.push(like);
        idx++;
      }
      // Outlet applicability filter applied in SQL so pagination stays correct.
      if (input?.outletId) {
        conditions.push(
          `(c."applicableOutlets" IS NULL OR json_array_length(c."applicableOutlets") = 0 OR EXISTS (SELECT 1 FROM json_array_elements_text(c."applicableOutlets") e WHERE e::int = $${idx++}))`
        );
        params.push(input.outletId);
      } else if (scope !== null && scope.length) {
        conditions.push(
          `(c."applicableOutlets" IS NULL OR json_array_length(c."applicableOutlets") = 0 OR EXISTS (SELECT 1 FROM json_array_elements_text(c."applicableOutlets") e WHERE e::int = ANY($${idx++})))`
        );
        params.push(scope);
      }
      const innerWhere = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";
      const statusCase = `CASE
        WHEN c."status" = 'archived' THEN 'archived'
        WHEN c."status" = 'paused' THEN 'paused'
        WHEN c."status" = 'draft' THEN 'draft'
        WHEN c."usageLimit" IS NOT NULL AND c."usedCount" >= c."usageLimit" THEN 'exhausted'
        WHEN c."startAt" IS NOT NULL AND c."startAt" > now() THEN 'scheduled'
        WHEN c."endAt" IS NOT NULL AND c."endAt" < now() THEN 'expired'
        WHEN c."status" = 'expired' THEN 'expired'
        WHEN c."status" = 'exhausted' THEN 'exhausted'
        ELSE 'active'
      END`;
      const statusWhere = input?.status
        ? `WHERE t."derivedStatus" = $${idx++}`
        : "";
      if (input?.status) params.push(input.status);
      const limitParam = `$${idx++}`;
      params.push(limit + 1);

      const sql = await getSql();
      const rows = (await sql.unsafe(
        `
        SELECT t.* FROM (
          SELECT c.*, ${statusCase} AS "derivedStatus"
          FROM "coupons" c
          ${innerWhere}
        ) t
        ${statusWhere}
        ORDER BY t."id" DESC
        LIMIT ${limitParam}
      `,
        params
      )) as any[];

      const page = rows.slice(0, limit);
      const enriched = page.map((c: any) => ({
        ...c,
        discountValue: toNum(c.discountValue),
        minimumOrder: toNum(c.minimumOrder),
        maximumDiscount: c.maximumDiscount ? toNum(c.maximumDiscount) : null,
        derivedStatus: c.derivedStatus ?? derivedStatus(c),
      }));
      return {
        items: enriched,
        nextCursor: rows.length > limit ? page.at(-1)?.id : undefined,
      };
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await need(ctx.user, "coupons.read");
      const supabase = getSupabaseAdmin();
      const { data: couponRaw, error } = await supabase
        .from("coupons")
        .select("*")
        .eq("id", input.id)
        .limit(1)
        .maybeSingle();
      if (error)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      if (!couponRaw)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Coupon not found.",
        });
      const coupon = couponRaw as any;
      // outlet access check
      if (coupon.applicableOutlets && coupon.applicableOutlets.length) {
        const scope = await getOutletScope(ctx.user);
        if (
          scope !== null &&
          scope.length &&
          !coupon.applicableOutlets.some((id: number) => scope.includes(id))
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "No access to this coupon's outlet.",
          });
        }
      }
      // redemptions
      let redemptions: any[] = [];
      try {
        const { data, error: redErr } = await supabase
          .from("coupon_redemptions")
          .select("*")
          .eq("couponId", input.id)
          .order("createdAt", { ascending: false })
          .limit(100);
        if (redErr) throw redErr;
        redemptions = (data ?? []) as any[];
      } catch {
        redemptions = [];
      }
      // analytics
      const totalRedemptions = redemptions.length;
      const uniqueCustomers = new Set(
        redemptions.map((r: any) => r.customerId).filter(Boolean)
      ).size;
      const orderIds = redemptions.map((r: any) => r.orderId).filter(Boolean);
      let gross = 0;
      let discount = 0;
      if (orderIds.length) {
        try {
          const { data: orderRows } = await supabase
            .from("orders")
            .select("*")
            .in("id", orderIds);
          gross = (orderRows ?? []).reduce(
            (s: number, o: any) => s + toNum(o.total),
            0
          );
          discount = redemptions.reduce(
            (s: number, r: any) => s + toNum(r.discountAmount),
            0
          );
        } catch {
          gross = 0;
          discount = redemptions.reduce(
            (s: number, r: any) => s + toNum(r.discountAmount),
            0
          );
        }
      } else {
        discount = redemptions.reduce(
          (s: number, r: any) => s + toNum(r.discountAmount),
          0
        );
      }
      const net = gross - discount;
      const aov = totalRedemptions ? gross / totalRedemptions : 0;
      // acquisition
      let newCustomers = 0;
      let repeatRate = 0;
      try {
        newCustomers =
          coupon.customerEligibility === "new" ? redemptions.length : 0;
        const customerCounts = new Map<number, number>();
        for (const r of redemptions) {
          if (r.customerId)
            customerCounts.set(
              r.customerId,
              (customerCounts.get(r.customerId) ?? 0) + 1
            );
        }
        const repeatCustomers = Array.from(customerCounts.values()).filter(
          c => c > 1
        ).length;
        repeatRate = uniqueCustomers
          ? (repeatCustomers / uniqueCustomers) * 100
          : 0;
      } catch {}
      return {
        coupon: {
          ...coupon,
          discountValue: toNum(coupon.discountValue),
          minimumOrder: toNum(coupon.minimumOrder),
          maximumDiscount: coupon.maximumDiscount
            ? toNum(coupon.maximumDiscount)
            : null,
          derivedStatus: derivedStatus(coupon),
        },
        redemptions: redemptions.map((r: any) => ({
          ...r,
          discountAmount: toNum(r.discountAmount),
        })),
        analytics: {
          totalRedemptions,
          uniqueCustomers,
          ordersGenerated: totalRedemptions,
          gross,
          discount,
          net,
          aov,
          newCustomers,
          repeatRate,
        },
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(2).max(160),
        code: z
          .string()
          .trim()
          .min(3)
          .max(40)
          .regex(/^[A-Z0-9\-_]+$/i, "Code must be alphanumeric with -_"),
        description: z.string().trim().max(500).nullable(),
        status: z
          .enum(["draft", "scheduled", "active", "paused", "archived"])
          .default("draft"),
        discountType: z.enum(["percentage", "fixed", "free_delivery"]),
        discountValue: z.number().min(0).max(1000000),
        minimumOrder: z.number().min(0).max(1000000).default(0),
        maximumDiscount: z.number().min(0).max(1000000).nullable(),
        startAt: z.date().nullable(),
        endAt: z.date().nullable(),
        timezone: z.string().trim().max(80).default("Asia/Kolkata"),
        usageLimit: z.number().int().min(1).max(1000000).nullable(),
        perCustomerLimit: z.number().int().min(1).max(1000000).nullable(),
        priority: z.number().int().min(0).max(100).default(0),
        allowStacking: z.boolean().default(false),
        paymentMethods: z.array(z.string()).max(10).nullable(),
        orderTypes: z
          .array(z.enum(["delivery", "takeaway", "dine_in"]))
          .max(10)
          .nullable(),
        customerEligibility: z
          .enum(["all", "new", "returning", "vip", "segment", "specific"])
          .default("all"),
        customerEligibilityValue: z.record(z.string(), z.unknown()).nullable(),
        applicableOutlets: z
          .array(z.number().int().positive())
          .max(100)
          .nullable(),
        applicableProducts: z
          .array(z.number().int().positive())
          .max(500)
          .nullable(),
        applicableCategories: z
          .array(z.number().int().positive())
          .max(100)
          .nullable(),
        excludeProducts: z
          .array(z.number().int().positive())
          .max(500)
          .nullable(),
        excludeCategories: z
          .array(z.number().int().positive())
          .max(100)
          .nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await need(ctx.user, "coupons.create");
      // validation
      if (input.startAt && input.endAt && input.endAt <= input.startAt)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "End must be after start.",
        });
      if (input.discountType === "percentage" && input.discountValue > 100)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Percentage cannot exceed 100.",
        });
      if (input.discountType !== "free_delivery" && input.discountValue <= 0)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Discount value must be positive.",
        });
      // outlet access for applicableOutlets
      if (input.applicableOutlets && input.applicableOutlets.length) {
        for (const oid of input.applicableOutlets)
          await assertOutletAccess(ctx.user, oid);
      }
      const supabase = getSupabaseAdmin();
      const code = normalizeCode(input.code);
      if (code.length < 3 || code.length > 40)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Code length invalid.",
        });
      const { data: dup, error: dupErr } = await supabase
        .from("coupons")
        .select("id")
        .eq("code", code)
        .limit(1)
        .maybeSingle();
      if (dupErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: dupErr.message,
        });
      if (dup)
        throw new TRPCError({
          code: "CONFLICT",
          message: "Coupon code already exists.",
        });
      const payload: any = {
        code,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        status: input.status,
        discountType: input.discountType,
        discountValue: Number(input.discountValue.toFixed(2)),
        minimumOrder: Number(input.minimumOrder.toFixed(2)),
        maximumDiscount:
          input.maximumDiscount != null
            ? Number(input.maximumDiscount.toFixed(2))
            : null,
        startAt: input.startAt ? input.startAt.toISOString() : null,
        endAt: input.endAt ? input.endAt.toISOString() : null,
        timezone: input.timezone,
        usageLimit: input.usageLimit,
        perCustomerLimit: input.perCustomerLimit,
        priority: input.priority,
        allowStacking: input.allowStacking,
        paymentMethods: input.paymentMethods as any,
        orderTypes: input.orderTypes as any,
        customerEligibility: input.customerEligibility,
        customerEligibilityValue: input.customerEligibilityValue as any,
        applicableOutlets: input.applicableOutlets as any,
        applicableProducts: input.applicableProducts as any,
        applicableCategories: input.applicableCategories as any,
        excludeProducts: input.excludeProducts as any,
        excludeCategories: input.excludeCategories as any,
        active: input.status === "active",
        createdBy: ctx.user.id,
      };
      const { data: inserted, error: insErr } = await supabase
        .from("coupons")
        .insert(payload)
        .select("id")
        .single();
      if (insErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: insErr.message,
        });
      const id = Number((inserted as any).id);
      await recordAudit({
        actorUserId: ctx.user.id,
        entityType: "coupon",
        entityId: id,
        action: "created",
        after: { code, name: payload.name, discountType: payload.discountType },
      });
      return { id };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().trim().min(2).max(160).optional(),
        description: z.string().trim().max(500).nullable().optional(),
        discountValue: z.number().min(0).max(1000000).optional(),
        minimumOrder: z.number().min(0).max(1000000).optional(),
        maximumDiscount: z.number().min(0).max(1000000).nullable().optional(),
        startAt: z.date().nullable().optional(),
        endAt: z.date().nullable().optional(),
        usageLimit: z.number().int().min(1).max(1000000).nullable().optional(),
        perCustomerLimit: z
          .number()
          .int()
          .min(1)
          .max(1000000)
          .nullable()
          .optional(),
        priority: z.number().int().min(0).max(100).optional(),
        allowStacking: z.boolean().optional(),
        paymentMethods: z.array(z.string()).max(10).nullable().optional(),
        orderTypes: z
          .array(z.enum(["delivery", "takeaway", "dine_in"]))
          .max(10)
          .nullable()
          .optional(),
        customerEligibility: z
          .enum(["all", "new", "returning", "vip", "segment", "specific"])
          .optional(),
        applicableOutlets: z
          .array(z.number().int().positive())
          .max(100)
          .nullable()
          .optional(),
        applicableProducts: z
          .array(z.number().int().positive())
          .max(500)
          .nullable()
          .optional(),
        applicableCategories: z
          .array(z.number().int().positive())
          .max(100)
          .nullable()
          .optional(),
        excludeProducts: z
          .array(z.number().int().positive())
          .max(500)
          .nullable()
          .optional(),
        excludeCategories: z
          .array(z.number().int().positive())
          .max(100)
          .nullable()
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await need(ctx.user, "coupons.update");
      const supabase = getSupabaseAdmin();
      const { data: cur, error: curErr } = await supabase
        .from("coupons")
        .select("*")
        .eq("id", input.id)
        .limit(1)
        .maybeSingle();
      if (curErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: curErr.message,
        });
      if (!cur)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Coupon not found.",
        });
      if ((cur as any).status === "archived")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Archived coupons cannot be edited.",
        });
      // outlet access check for new outlets
      if (input.applicableOutlets && input.applicableOutlets.length)
        for (const oid of input.applicableOutlets)
          await assertOutletAccess(ctx.user, oid);
      const patch: any = {};
      if (input.name !== undefined) patch.name = input.name.trim();
      if (input.description !== undefined)
        patch.description = input.description?.trim() || null;
      if (input.discountValue !== undefined)
        patch.discountValue = Number(input.discountValue.toFixed(2));
      if (input.minimumOrder !== undefined)
        patch.minimumOrder = Number(input.minimumOrder.toFixed(2));
      if (input.maximumDiscount !== undefined)
        patch.maximumDiscount =
          input.maximumDiscount != null
            ? Number(input.maximumDiscount.toFixed(2))
            : null;
      if (input.startAt !== undefined)
        patch.startAt = input.startAt
          ? (input.startAt as Date).toISOString()
          : null;
      if (input.endAt !== undefined)
        patch.endAt = input.endAt ? (input.endAt as Date).toISOString() : null;
      if (input.usageLimit !== undefined) patch.usageLimit = input.usageLimit;
      if (input.perCustomerLimit !== undefined)
        patch.perCustomerLimit = input.perCustomerLimit;
      if (input.priority !== undefined) patch.priority = input.priority;
      if (input.allowStacking !== undefined)
        patch.allowStacking = input.allowStacking;
      if (input.paymentMethods !== undefined)
        patch.paymentMethods = input.paymentMethods as any;
      if (input.orderTypes !== undefined)
        patch.orderTypes = input.orderTypes as any;
      if (input.customerEligibility !== undefined)
        patch.customerEligibility = input.customerEligibility;
      if (input.applicableOutlets !== undefined)
        patch.applicableOutlets = input.applicableOutlets as any;
      if (input.applicableProducts !== undefined)
        patch.applicableProducts = input.applicableProducts as any;
      if (input.applicableCategories !== undefined)
        patch.applicableCategories = input.applicableCategories as any;
      if (input.excludeProducts !== undefined)
        patch.excludeProducts = input.excludeProducts as any;
      if (input.excludeCategories !== undefined)
        patch.excludeCategories = input.excludeCategories as any;
      if (Object.keys(patch).length === 0)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No fields to update.",
        });
      const { error: updErr } = await supabase
        .from("coupons")
        .update(patch)
        .eq("id", input.id);
      if (updErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: updErr.message,
        });
      await recordAudit({
        actorUserId: ctx.user.id,
        entityType: "coupon",
        entityId: input.id,
        action: "updated",
        before: cur as any,
        after: patch,
      });
      return { success: true };
    }),

  setStatus: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        status: z.enum(["draft", "scheduled", "active", "paused", "archived"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const perm =
        input.status === "paused"
          ? "coupons.pause"
          : input.status === "archived"
            ? "coupons.archive"
            : "coupons.update";
      await need(ctx.user, perm as any);
      const supabase = getSupabaseAdmin();
      const { data: cur, error: curErr } = await supabase
        .from("coupons")
        .select("id,status,applicableOutlets")
        .eq("id", input.id)
        .limit(1)
        .maybeSingle();
      if (curErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: curErr.message,
        });
      if (!cur)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Coupon not found.",
        });
      // A scoped user may only change a coupon whose outlets are all in scope.
      {
        const scope = await getOutletScope(ctx.user);
        if (scope !== null) {
          const outlets = Array.isArray((cur as any).applicableOutlets)
            ? ((cur as any).applicableOutlets as number[])
            : [];
          if (!outlets.length || !outlets.every(o => scope.includes(o))) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You do not have access to this coupon's outlets.",
            });
          }
        }
      }
      if ((cur as any).status === "archived")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Archived coupon cannot change status.",
        });
      const { error: updErr } = await supabase
        .from("coupons")
        .update({
          status: input.status,
          active: input.status === "active",
        } as any)
        .eq("id", input.id);
      if (updErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: updErr.message,
        });
      await recordAudit({
        actorUserId: ctx.user.id,
        entityType: "coupon",
        entityId: input.id,
        action: `status_${input.status}`,
        before: { status: (cur as any).status },
        after: { status: input.status },
      });
      return { success: true };
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await need(ctx.user, "coupons.delete");
      const supabase = getSupabaseAdmin();
      const { data: cur, error: curErr } = await supabase
        .from("coupons")
        .select("*")
        .eq("id", input.id)
        .limit(1)
        .maybeSingle();
      if (curErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: curErr.message,
        });
      if (!cur)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Coupon not found.",
        });
      {
        const scope = await getOutletScope(ctx.user);
        if (scope !== null) {
          const outlets = Array.isArray((cur as any).applicableOutlets)
            ? ((cur as any).applicableOutlets as number[])
            : [];
          if (!outlets.length || !outlets.every(o => scope.includes(o))) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You do not have access to this coupon's outlets.",
            });
          }
        }
      }
      const { data: redemptions, error: redErr } = await supabase
        .from("coupon_redemptions")
        .select("id")
        .eq("couponId", input.id)
        .limit(1);
      if (redErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: redErr.message,
        });
      if (redemptions && redemptions.length)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Coupon has redemptions and cannot be deleted. Archive it instead.",
        });
      const { error: delErr } = await supabase
        .from("coupons")
        .delete()
        .eq("id", input.id);
      if (delErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: delErr.message,
        });
      await recordAudit({
        actorUserId: ctx.user.id,
        entityType: "coupon",
        entityId: input.id,
        action: "deleted",
        before: cur as any,
      });
      return { success: true };
    }),

  // Validation engine (centralized)
  validate: protectedProcedure
    .input(
      z.object({
        code: z.string().trim().min(2).max(40),
        outletId: z.number().int().positive().nullable(),
        customerId: z.number().int().positive().nullable(),
        orderType: z
          .enum(["delivery", "takeaway", "dine_in"])
          .nullable()
          .optional(),
        paymentMethod: z.string().nullable().optional(),
        orderAmount: z.number().min(0),
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
        existingCouponOnOrder: z.boolean().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await need(ctx.user, "coupons.read");
      if (input.outletId) await assertOutletAccess(ctx.user, input.outletId);
      const supabase = getSupabaseAdmin();
      const code = normalizeCode(input.code);
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
      const coupon = row as any;
      // per-customer usage check needs DB
      let customerOrdersCount = 0;
      let perCustomerUsed = 0;
      if (input.customerId) {
        try {
          const { data: custOrders, error: custErr } = await supabase
            .from("orders")
            .select("id")
            .eq("customerId", input.customerId)
            .eq("status", "completed");
          if (custErr) throw custErr;
          customerOrdersCount = (custOrders ?? []).length;
        } catch {
          customerOrdersCount = 0;
        }
        if (coupon.perCustomerLimit) {
          try {
            const { data: pc, error: pcErr } = await supabase
              .from("coupon_redemptions")
              .select("id")
              .eq("couponId", coupon.id)
              .eq("customerId", input.customerId)
              .eq("status", "applied");
            if (pcErr) throw pcErr;
            perCustomerUsed = (pc ?? []).length;
            if (perCustomerUsed >= coupon.perCustomerLimit)
              return { valid: false, reason: "Per-customer limit reached." };
          } catch {
            // if query fails, skip per-customer check
          }
        }
      }
      // compute eligible amount
      let eligibleAmount = input.orderAmount;
      if (
        input.items &&
        (coupon.applicableProducts?.length ||
          coupon.applicableCategories?.length ||
          coupon.excludeProducts?.length ||
          coupon.excludeCategories?.length)
      ) {
        const applicableProducts = coupon.applicableProducts as number[] | null;
        const applicableCategories = coupon.applicableCategories as
          number[] | null;
        const excludeProducts = coupon.excludeProducts as number[] | null;
        const excludeCategories = coupon.excludeCategories as number[] | null;
        const hasInclude =
          (applicableProducts && applicableProducts.length) ||
          (applicableCategories && applicableCategories.length);
        eligibleAmount = 0;
        for (const it of input.items) {
          if (
            excludeProducts &&
            it.menuItemId &&
            excludeProducts.includes(it.menuItemId)
          )
            continue;
          if (
            excludeCategories &&
            it.categoryId &&
            excludeCategories.includes(it.categoryId)
          )
            continue;
          if (hasInclude) {
            const inProd =
              applicableProducts &&
              it.menuItemId &&
              applicableProducts.includes(it.menuItemId);
            const inCat =
              applicableCategories &&
              it.categoryId &&
              applicableCategories.includes(it.categoryId);
            if (!inProd && !inCat) continue;
          }
          eligibleAmount += it.lineTotal;
        }
      }
      const res = await validateCouponEngine(coupon, {
        customerId: input.customerId,
        outletId: input.outletId,
        orderType: input.orderType ?? null,
        paymentMethod: input.paymentMethod ?? null,
        orderAmount: input.orderAmount,
        eligibleAmount,
        items: input.items,
        customerOrdersCount,
        existingCouponOnOrder: input.existingCouponOnOrder ?? false,
      });
      if (!res.valid) return res;
      return {
        valid: true,
        discount: (res as any).discount,
        eligibleAmount,
        coupon: { ...coupon, discountValue: toNum(coupon.discountValue) },
      };
    }),

  // Redemption with race & idempotency handling
  redeem: protectedProcedure
    .input(
      z.object({
        couponId: z.number().int().positive().optional(),
        code: z.string().trim().min(2).max(40).optional(),
        customerId: z.number().int().positive().nullable(),
        orderId: z.number().int().positive(),
        outletId: z.number().int().positive().nullable(),
        orderType: z
          .enum(["delivery", "takeaway", "dine_in"])
          .nullable()
          .optional(),
        paymentMethod: z.string().nullable().optional(),
        orderAmount: z.number().min(0),
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
        idempotencyKey: z.string().trim().max(80).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await need(ctx.user, "coupons.update");
      const supabase = getSupabaseAdmin();
      const key =
        input.idempotencyKey?.trim() ||
        `order-${input.orderId}-coupon-${input.couponId ?? input.code}`;
      // idempotency check
      try {
        const { data: existing, error: exErr } = await supabase
          .from("coupon_redemptions")
          .select("*")
          .eq("idempotencyKey", key)
          .limit(1)
          .maybeSingle();
        if (exErr) throw exErr;
        if (existing)
          return {
            id: (existing as any).id,
            discount: toNum((existing as any).discountAmount),
            already: true,
          };
      } catch {
        // fallback via select list
        const { data: list } = await supabase
          .from("coupon_redemptions")
          .select("*")
          .eq("idempotencyKey", key)
          .limit(1);
        if (list && (list as any[])[0])
          return {
            id: (list as any[])[0].id,
            discount: toNum((list as any[])[0].discountAmount),
            already: true,
          };
      }
      // resolve coupon
      let coupon: any = null;
      if (input.couponId) {
        const { data, error } = await supabase
          .from("coupons")
          .select("*")
          .eq("id", input.couponId)
          .limit(1)
          .maybeSingle();
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        coupon = data;
      } else if (input.code) {
        const { data, error } = await supabase
          .from("coupons")
          .select("*")
          .eq("code", normalizeCode(input.code))
          .limit(1)
          .maybeSingle();
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        coupon = data;
      }
      if (!coupon)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Coupon not found.",
        });
      // check outlet access
      if (
        coupon.applicableOutlets &&
        input.outletId &&
        !(coupon.applicableOutlets as number[]).includes(input.outletId)
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Coupon not applicable for outlet.",
        });
      if (coupon.applicableOutlets && coupon.applicableOutlets.length)
        for (const oid of coupon.applicableOutlets)
          await assertOutletAccess(ctx.user, oid);
      // validate (reuse engine)
      let customerOrdersCount = 0;
      if (input.customerId) {
        try {
          const { data: custOrders } = await supabase
            .from("orders")
            .select("id")
            .eq("customerId", input.customerId)
            .eq("status", "completed");
          customerOrdersCount = (custOrders ?? []).length;
        } catch {
          customerOrdersCount = 0;
        }
      }
      let eligibleAmount = input.orderAmount;
      if (
        input.items &&
        (coupon.applicableProducts?.length ||
          coupon.applicableCategories?.length ||
          coupon.excludeProducts?.length ||
          coupon.excludeCategories?.length)
      ) {
        eligibleAmount = 0;
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
          if (
            (coupon.applicableProducts && coupon.applicableProducts.length) ||
            (coupon.applicableCategories && coupon.applicableCategories.length)
          ) {
            const inProd =
              coupon.applicableProducts &&
              it.menuItemId &&
              (coupon.applicableProducts as number[]).includes(it.menuItemId);
            const inCat =
              coupon.applicableCategories &&
              it.categoryId &&
              (coupon.applicableCategories as number[]).includes(it.categoryId);
            if (!inProd && !inCat) continue;
          }
          eligibleAmount += it.lineTotal;
        }
      }
      let order: any = null;
      try {
        const { data, error } = await supabase
          .from("orders")
          .select("*")
          .eq("id", input.orderId)
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        order = data;
      } catch {
        order = null;
      }
      if (!order)
        throw new TRPCError({ code: "NOT_FOUND", message: "Order not found." });
      if ((order as any).couponId)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Order already has a coupon.",
        });
      const v = await validateCouponEngine(coupon, {
        customerId: input.customerId,
        outletId: input.outletId,
        orderType: input.orderType ?? null,
        paymentMethod: input.paymentMethod ?? null,
        orderAmount: input.orderAmount,
        eligibleAmount,
        items: input.items,
        customerOrdersCount,
        existingCouponOnOrder: !!(order as any).couponId,
      });
      if (!v.valid)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (v as any).reason,
        });
      const discount = (v as any).discount as number;
      // atomic transaction: check usage, insert redemption, increment usedCount, snapshot order
      const sql = await getSql();
      const result = await sql.begin(async (tx: any) => {
        // re-check usage inside tx
        const freshRows = await tx.unsafe(
          `SELECT * FROM "coupons" WHERE "id" = $1 LIMIT 1`,
          [coupon.id]
        );
        const fresh = freshRows[0] as any;
        if (!fresh)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Coupon not found.",
          });
        if (
          fresh.usageLimit &&
          toNum(fresh.usedCount) >= toNum(fresh.usageLimit)
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Coupon usage limit reached (race).",
          });
        if (fresh.perCustomerLimit && input.customerId) {
          const pcRows = await tx.unsafe(
            `SELECT "id" FROM "coupon_redemptions" WHERE "couponId" = $1 AND "customerId" = $2 AND "status" = 'applied'`,
            [fresh.id, input.customerId]
          );
          if (pcRows.length >= fresh.perCustomerLimit)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Per-customer limit reached (race).",
            });
        }
        // idempotency double-check inside tx
        const dupRows = await tx.unsafe(
          `SELECT * FROM "coupon_redemptions" WHERE "idempotencyKey" = $1 LIMIT 1`,
          [key]
        );
        if (dupRows[0]) {
          return {
            id: Number(dupRows[0].id),
            discount: toNum(dupRows[0].discountAmount),
            already: true,
            couponId: fresh.id as number,
          };
        }
        const insRows = await tx.unsafe(
          `INSERT INTO "coupon_redemptions" ("couponId","customerId","orderId","outletId","discountAmount","status","idempotencyKey") VALUES ($1,$2,$3,$4,$5,'applied',$6) RETURNING "id"`,
          [
            fresh.id,
            input.customerId,
            input.orderId,
            input.outletId,
            discount.toFixed(2),
            key,
          ]
        );
        const redemptionId = Number(insRows[0].id);
        await tx.unsafe(
          `UPDATE "coupons" SET "usedCount" = "usedCount" + 1 WHERE "id" = $1`,
          [fresh.id]
        );
        await tx.unsafe(
          `UPDATE "orders" SET "couponId" = $1, "couponCode" = $2, "couponDiscount" = $3 WHERE "id" = $4`,
          [fresh.id, fresh.code, discount.toFixed(2), input.orderId]
        );
        return {
          id: redemptionId,
          discount,
          already: false,
          couponId: fresh.id as number,
        };
      });
      if (result.already)
        return { id: result.id, discount: result.discount, already: true };
      await recordAudit({
        actorUserId: ctx.user.id,
        entityType: "coupon_redemption",
        entityId: result.id,
        outletId: input.outletId ?? null,
        action: "redeemed",
        after: {
          couponId: result.couponId,
          orderId: input.orderId,
          discount: result.discount,
        },
      });
      return { id: result.id, discount: result.discount };
    }),

  redemptions: router({
    list: protectedProcedure
      .input(
        z
          .object({
            couponId: z.number().int().positive().optional(),
            outletId: z.number().int().positive().optional(),
            status: z
              .enum(["applied", "reversed", "refunded", "cancelled"])
              .optional(),
            from: z.date().optional(),
            to: z.date().optional(),
            limit: z.number().int().min(1).max(100).default(20),
            cursor: z.number().int().positive().optional(),
          })
          .nullish()
      )
      .query(async ({ ctx, input }) => {
        await need(ctx.user, "coupons.read");
        if (input?.outletId) await assertOutletAccess(ctx.user, input.outletId);
        const supabase = getSupabaseAdmin();
        const scope = await getOutletScope(ctx.user);
        if (scope !== null && scope.length === 0)
          return { items: [], nextCursor: undefined };
        const limit = input?.limit ?? 20;
        const limitPlusOne = limit + 1;

        let query: any = supabase
          .from("coupon_redemptions")
          .select("*")
          .order("id", { ascending: false })
          .limit(limitPlusOne);
        if (input?.cursor) query = query.lt("id", input.cursor);
        if (input?.couponId) query = query.eq("couponId", input.couponId);
        if (input?.status) query = query.eq("status", input.status);
        if (input?.from)
          query = query.gte("createdAt", input.from.toISOString());
        if (input?.to) query = query.lte("createdAt", input.to.toISOString());
        if (input?.outletId) {
          await assertOutletAccess(ctx.user, input.outletId);
          query = query.eq("outletId", input.outletId);
        } else if (scope !== null && scope.length) {
          if (scope.length === 1) query = query.eq("outletId", scope[0]);
          else query = query.in("outletId", scope);
        }

        const { data, error } = await query;
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        const rows = (data ?? []) as any[];
        const page = rows.slice(0, limit);

        if (!page.length) return { items: [], nextCursor: undefined };

        // Enrich via batch lookups
        const couponIds = Array.from(
          new Set(page.map((r: any) => r.couponId).filter(Boolean))
        ) as number[];
        const customerIds = Array.from(
          new Set(page.map((r: any) => r.customerId).filter(Boolean))
        ) as number[];
        const orderIds = Array.from(
          new Set(page.map((r: any) => r.orderId).filter(Boolean))
        ) as number[];
        const outletIds = Array.from(
          new Set(page.map((r: any) => r.outletId).filter(Boolean))
        ) as number[];

        let couponMap = new Map<number, any>();
        let customerMap = new Map<number, any>();
        let orderMap = new Map<number, any>();
        let outletMap = new Map<number, any>();

        try {
          if (couponIds.length) {
            const { data: coupons } = await supabase
              .from("coupons")
              .select("id,code,name")
              .in("id", couponIds);
            couponMap = new Map((coupons ?? []).map((c: any) => [c.id, c]));
          }
        } catch {}
        try {
          if (customerIds.length) {
            const { data: customers } = await supabase
              .from("customers")
              .select("id,name,phone")
              .in("id", customerIds);
            customerMap = new Map((customers ?? []).map((c: any) => [c.id, c]));
          }
        } catch {}
        try {
          if (orderIds.length) {
            const { data: orders } = await supabase
              .from("orders")
              .select("id,orderNumber")
              .in("id", orderIds);
            orderMap = new Map((orders ?? []).map((o: any) => [o.id, o]));
          }
        } catch {}
        try {
          if (outletIds.length) {
            const { data: outlets } = await supabase
              .from("outlets")
              .select("id,name")
              .in("id", outletIds);
            outletMap = new Map((outlets ?? []).map((o: any) => [o.id, o]));
          }
        } catch {}

        return {
          items: page.map((r: any) => ({
            ...r,
            discountAmount: toNum(r.discountAmount),
            couponCode: couponMap.get(r.couponId)?.code ?? null,
            couponName: couponMap.get(r.couponId)?.name ?? null,
            customerName: customerMap.get(r.customerId)?.name ?? null,
            customerPhone: customerMap.get(r.customerId)?.phone ?? null,
            orderNumber: orderMap.get(r.orderId)?.orderNumber ?? null,
            outletName: outletMap.get(r.outletId)?.name ?? null,
          })),
          nextCursor: rows.length > limit ? page.at(-1)?.id : undefined,
        };
      }),
    updateStatus: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          status: z.enum(["reversed", "refunded", "cancelled"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "coupons.update");
        const supabase = getSupabaseAdmin();
        const { data: cur, error: curErr } = await supabase
          .from("coupon_redemptions")
          .select("*")
          .eq("id", input.id)
          .limit(1)
          .maybeSingle();
        if (curErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: curErr.message,
          });
        if (!cur)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Redemption not found.",
          });
        await assertOutletAccess(ctx.user, (cur as any).outletId ?? null);
        const { error: updErr } = await supabase
          .from("coupon_redemptions")
          .update({ status: input.status } as any)
          .eq("id", input.id);
        if (updErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: updErr.message,
          });
        if (
          input.status === "refunded" ||
          input.status === "reversed" ||
          input.status === "cancelled"
        ) {
          // decrement usedCount if business rule says refund should free up usage
          try {
            const sql = await getSql();
            await sql.unsafe(
              `UPDATE "coupons" SET "usedCount" = GREATEST("usedCount" - 1, 0) WHERE "id" = $1`,
              [(cur as any).couponId]
            );
          } catch {
            // Fallback via Supabase read-modify-write
            try {
              const { data: c } = await supabase
                .from("coupons")
                .select("id,usedCount")
                .eq("id", (cur as any).couponId)
                .limit(1)
                .maybeSingle();
              if (c) {
                const next = Math.max(toNum((c as any).usedCount) - 1, 0);
                await supabase
                  .from("coupons")
                  .update({ usedCount: next } as any)
                  .eq("id", (c as any).id);
              }
            } catch {}
          }
          try {
            await supabase
              .from("orders")
              .update({ couponDiscount: 0 as any } as any)
              .eq("id", (cur as any).orderId);
          } catch {}
          // Also try via sql for orders discount
          try {
            const sql = await getSql();
            await sql.unsafe(
              `UPDATE "orders" SET "couponDiscount" = $1 WHERE "id" = $2`,
              ["0", (cur as any).orderId]
            );
          } catch {}
        }
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "coupon_redemption",
          entityId: input.id,
          action: `status_${input.status}`,
          before: { status: (cur as any).status } as any,
          after: { status: input.status },
        });
        return { success: true };
      }),
  }),

  analytics: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await need(ctx.user, "coupons.analytics");
      const supabase = getSupabaseAdmin();
      const { data: coupon, error: cErr } = await supabase
        .from("coupons")
        .select("*")
        .eq("id", input.id)
        .limit(1)
        .maybeSingle();
      if (cErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: cErr.message,
        });
      if (!coupon)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Coupon not found.",
        });
      {
        const scope = await getOutletScope(ctx.user);
        if (scope !== null) {
          const outlets = Array.isArray((coupon as any).applicableOutlets)
            ? ((coupon as any).applicableOutlets as number[])
            : [];
          if (!outlets.length || !outlets.every(o => scope.includes(o))) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You do not have access to this coupon's outlets.",
            });
          }
        }
      }
      let redemptions: any[] = [];
      try {
        const { data, error } = await supabase
          .from("coupon_redemptions")
          .select("*")
          .eq("couponId", input.id)
          .eq("status", "applied");
        if (error) throw error;
        redemptions = (data ?? []) as any[];
      } catch {
        redemptions = [];
      }
      const totalRedemptions = redemptions.length;
      const uniqueCustomers = new Set(
        redemptions.map((r: any) => r.customerId).filter(Boolean)
      ).size;
      const orderIds = redemptions.map((r: any) => r.orderId).filter(Boolean);
      let gross = 0;
      let discount = 0;
      let ordersCount = 0;
      if (orderIds.length) {
        try {
          const { data: orderRows } = await supabase
            .from("orders")
            .select("*")
            .in("id", orderIds);
          const rows = (orderRows ?? []) as any[];
          gross = rows.reduce(
            (s: number, o: any) => s + toNum(o.total) + toNum(o.couponDiscount),
            0
          );
          discount = redemptions.reduce(
            (s: number, r: any) => s + toNum(r.discountAmount),
            0
          );
          ordersCount = rows.length;
        } catch {
          discount = redemptions.reduce(
            (s: number, r: any) => s + toNum(r.discountAmount),
            0
          );
        }
      } else {
        discount = redemptions.reduce(
          (s: number, r: any) => s + toNum(r.discountAmount),
          0
        );
      }
      const net = gross - discount;
      const aov = ordersCount ? gross / ordersCount : 0;
      const revenuePerDiscount = discount ? gross / discount : 0;
      // new customers: those with coupon as first order (simplified: customerEligibility new)
      let newCustomers = 0;
      let repeatRate = 0;
      if (totalRedemptions) {
        newCustomers =
          (coupon as any).customerEligibility === "new"
            ? redemptions.length
            : 0;
        const byCust = new Map<number, number>();
        for (const r of redemptions) {
          if (r.customerId)
            byCust.set(r.customerId, (byCust.get(r.customerId) ?? 0) + 1);
        }
        const repeatCustomers = Array.from(byCust.values()).filter(
          c => c > 1
        ).length;
        repeatRate = uniqueCustomers
          ? (repeatCustomers / uniqueCustomers) * 100
          : 0;
      }
      return {
        totalRedemptions,
        uniqueCustomers,
        ordersGenerated: ordersCount,
        gross,
        discount,
        net,
        aov,
        revenuePerDiscount,
        newCustomers,
        repeatRate,
      };
    }),
});
