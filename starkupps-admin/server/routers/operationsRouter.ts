/** Kitchen Ledger operations APIs: durable supporting workflows beyond the order and menu core. */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSql, getSupabaseAdmin } from "../db/supabase";
import {
  escapePostgrestOr,
  getOutletScope,
  recordAudit,
  resolveStaffRole,
  roleCan,
} from "../db/index";
import { protectedProcedure, router } from "../lib/trpc";

const pageInput = z.object({
  limit: z.number().int().min(1).max(100).default(25),
  cursor: z.number().int().positive().optional(),
  search: z.string().trim().max(160).optional(),
});
const numberValue = (value: unknown) => Number(value ?? 0);

async function requireAccess(
  user: { id: number; role: "user" | "admin" },
  area: Parameters<typeof roleCan>[1]
) {
  const role = await resolveStaffRole(user);
  if (!role || !roleCan(role, area))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Your staff role does not have access to this operation.",
    });
  return role;
}

async function requireManagement(user: { id: number; role: "user" | "admin" }) {
  const role = await resolveStaffRole(user);
  if (!role || (role !== "owner" && role !== "manager"))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Manager or owner access is required.",
    });
  return role;
}

async function requireOwner(user: { id: number; role: "user" | "admin" }) {
  const role = await resolveStaffRole(user);
  if (role !== "owner")
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Owner access is required.",
    });
}

export const loyaltyRouter = router({
  list: protectedProcedure.input(pageInput).query(async ({ ctx, input }) => {
    await requireAccess(ctx.user, "loyalty.read");
    const supabase = getSupabaseAdmin();
    const limitPlusOne = input.limit + 1;
    let query: any = supabase
      .from("customers")
      .select("*")
      .order("id", { ascending: false })
      .limit(limitPlusOne);
    if (input.cursor) query = query.lt("id", input.cursor);
    if (input.search) {
      const escaped = escapePostgrestOr(input.search);
      query = query.or(`name.ilike.%${escaped}%,phone.ilike.%${escaped}%`);
    }
    const { data: memberRows, error } = await query;
    if (error)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: error.message,
      });
    const rows = (memberRows ?? []) as any[];
    const page = rows.slice(0, input.limit);
    const ids = page.map(member => member.id);
    if (!ids.length) return { items: [], nextCursor: undefined };
    const [{ data: txRows }, { data: orderRows }] = await Promise.all([
      supabase
        .from("loyalty_transactions")
        .select("customerId,pointsChange")
        .in("customerId", ids),
      supabase
        .from("orders")
        .select("customerId")
        .in("customerId", ids)
        .neq("status", "cancelled"),
    ]);
    const balanceById = new Map<number, number>();
    for (const r of (txRows ?? []) as any[]) {
      balanceById.set(
        r.customerId,
        (balanceById.get(r.customerId) ?? 0) + numberValue(r.pointsChange)
      );
    }
    const visitsById = new Map<number, number>();
    for (const r of (orderRows ?? []) as any[]) {
      visitsById.set(r.customerId, (visitsById.get(r.customerId) ?? 0) + 1);
    }
    return {
      items: page.map(member => ({
        ...member,
        pointsBalance: balanceById.get(member.id) ?? 0,
        visits: visitsById.get(member.id) ?? 0,
      })),
      nextCursor: rows.length > input.limit ? page.at(-1)?.id : undefined,
    };
  }),
  byId: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await requireAccess(ctx.user, "loyalty.read");
      const supabase = getSupabaseAdmin();
      const { data: member, error: mErr } = await supabase
        .from("customers")
        .select("*")
        .eq("id", input.id)
        .limit(1)
        .maybeSingle();
      if (mErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: mErr.message,
        });
      if (!member)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Member not found.",
        });
      const { data: transactions, error: tErr } = await supabase
        .from("loyalty_transactions")
        .select("*")
        .eq("customerId", input.id)
        .order("createdAt", { ascending: false })
        .limit(100);
      if (tErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: tErr.message,
        });
      const total = ((transactions ?? []) as any[]).reduce(
        (sum, row) => sum + numberValue(row.pointsChange),
        0
      );
      return {
        member,
        transactions: (transactions ?? []) as any[],
        pointsBalance: total,
      };
    }),
  createMember: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(2).max(160).nullable(),
        phone: z.string().trim().min(8).max(32),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireAccess(ctx.user, "loyalty.update");
      const supabase = getSupabaseAdmin();
      const { data: existing, error: eErr } = await supabase
        .from("customers")
        .select("id")
        .eq("phone", input.phone)
        .limit(1)
        .maybeSingle();
      if (eErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: eErr.message,
        });
      if (existing)
        throw new TRPCError({
          code: "CONFLICT",
          message: "A member with that phone number already exists.",
        });
      const { data, error } = await supabase
        .from("customers")
        .insert(input as any)
        .select("id")
        .single();
      if (error)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      const id = Number((data as any).id);
      await recordAudit({
        actorUserId: ctx.user.id,
        entityType: "customer",
        entityId: id,
        action: "created",
        after: input as any,
      });
      return { id };
    }),
  adjustPoints: protectedProcedure
    .input(
      z.object({
        customerId: z.number().int().positive(),
        pointsChange: z
          .number()
          .int()
          .min(-10000)
          .max(10000)
          .refine(value => value !== 0, "Points must change."),
        reason: z.string().trim().min(3).max(240),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireAccess(ctx.user, "loyalty.update");
      const supabase = getSupabaseAdmin();
      const { data: member, error: mErr } = await supabase
        .from("customers")
        .select("id")
        .eq("id", input.customerId)
        .limit(1)
        .maybeSingle();
      if (mErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: mErr.message,
        });
      if (!member)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Member not found.",
        });
      const { data, error } = await supabase
        .from("loyalty_transactions")
        .insert(input as any)
        .select("id")
        .single();
      if (error)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      const id = Number((data as any).id);
      await recordAudit({
        actorUserId: ctx.user.id,
        entityType: "loyalty_transaction",
        entityId: id,
        action: "points_adjusted",
        after: input as any,
      });
      return { id };
    }),
  rules: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      await requireAccess(ctx.user, "loyalty.read");
      const supabase = getSupabaseAdmin();
      const { data: result, error } = await supabase
        .from("loyalty_rules")
        .select("*")
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      return result
        ? {
            ...(result as any),
            pointsPerRupee: numberValue((result as any).pointsPerRupee),
          }
        : null;
    }),
    save: protectedProcedure
      .input(
        z.object({
          pointsPerRupee: z.number().min(0).max(100),
          rewardThreshold: z.number().int().min(1).max(1_000_000),
          rewardLabel: z.string().trim().min(2).max(160),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requireOwner(ctx.user);
        const supabase = getSupabaseAdmin();
        const { data: current, error: cErr } = await supabase
          .from("loyalty_rules")
          .select("*")
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (cErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: cErr.message,
          });
        if (current) {
          const { error } = await supabase
            .from("loyalty_rules")
            .update({
              ...input,
              pointsPerRupee: Number(input.pointsPerRupee.toFixed(3)),
            } as any)
            .eq("id", (current as any).id);
          if (error)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
            });
          await recordAudit({
            actorUserId: ctx.user.id,
            entityType: "loyalty_rule",
            entityId: (current as any).id,
            action: "updated",
            before: {
              ...(current as any),
              pointsPerRupee: numberValue((current as any).pointsPerRupee),
            } as any,
            after: input as any,
          });
          return { id: (current as any).id };
        }
        const { data, error } = await supabase
          .from("loyalty_rules")
          .insert({
            ...input,
            pointsPerRupee: Number(input.pointsPerRupee.toFixed(3)),
          } as any)
          .select("id")
          .single();
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        return { id: Number((data as any).id) };
      }),
  }),
});

export const settingsRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    await requireOwner(ctx.user);
    const supabase = getSupabaseAdmin();
    const { data: result, error } = await supabase
      .from("store_settings")
      .select("*")
      .limit(1)
      .maybeSingle();
    if (error)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: error.message,
      });
    return (result as any) ?? null;
  }),
  save: protectedProcedure
    .input(
      z.object({
        storeName: z.string().trim().min(2).max(160),
        timezone: z.string().trim().min(3).max(80),
        openForOrders: z.boolean(),
        autoAcceptOrders: z.boolean(),
        openingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        closingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        fssaiLicense: z.string().trim().max(100).nullable(),
        paymentProvider: z.string().trim().max(80).nullable(),
        packingCharge: z.number().min(0).max(10000),
        deliveryFee: z.number().min(0).max(10000),
        freeDeliveryAbove: z.number().min(0).max(1000000).nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireOwner(ctx.user);
      const supabase = getSupabaseAdmin();
      const { data: current, error: cErr } = await supabase
        .from("store_settings")
        .select("*")
        .limit(1)
        .maybeSingle();
      if (cErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: cErr.message,
        });
      if (current) {
        const { error } = await supabase
          .from("store_settings")
          .update(input as any)
          .eq("id", (current as any).id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "store_settings",
          entityId: (current as any).id,
          action: "updated",
          before: current as unknown as Record<string, unknown>,
          after: input as any,
        });
        return { id: (current as any).id };
      }
      const { data, error } = await supabase
        .from("store_settings")
        .insert(input as any)
        .select("id")
        .single();
      if (error)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      return { id: Number((data as any).id) };
    }),
});

export const shiftsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    await requireAccess(ctx.user, "orders.read");
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("shifts")
      .select("*")
      .order("startedAt", { ascending: false })
      .limit(30);
    if (error)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: error.message,
      });
    return (data ?? []) as any[];
  }),
  start: protectedProcedure
    .input(z.object({ name: z.string().trim().min(2).max(100) }))
    .mutation(async ({ ctx, input }) => {
      await requireManagement(ctx.user);
      const supabase = getSupabaseAdmin();
      const { data: active, error: aErr } = await supabase
        .from("shifts")
        .select("id")
        .eq("active", true)
        .limit(1)
        .maybeSingle();
      if (aErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: aErr.message,
        });
      if (active)
        throw new TRPCError({
          code: "CONFLICT",
          message: "End the active shift before starting another.",
        });
      const { data, error } = await supabase
        .from("shifts")
        .insert({
          name: input.name,
          createdBy: ctx.user.id,
          active: true,
        } as any)
        .select("id")
        .single();
      if (error)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      return { id: Number((data as any).id) };
    }),
  end: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await requireManagement(ctx.user);
      const supabase = getSupabaseAdmin();
      const { data: active, error: aErr } = await supabase
        .from("shifts")
        .select("*")
        .eq("id", input.id)
        .eq("active", true)
        .limit(1)
        .maybeSingle();
      if (aErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: aErr.message,
        });
      if (!active)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Active shift not found.",
        });
      const { error } = await supabase
        .from("shifts")
        .update({ active: false, endedAt: new Date().toISOString() } as any)
        .eq("id", input.id);
      if (error)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      await recordAudit({
        actorUserId: ctx.user.id,
        entityType: "shift",
        entityId: input.id,
        action: "ended",
        before: { active: true } as any,
        after: { active: false } as any,
      });
      return { success: true };
    }),
});

export const notificationsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const supabase = getSupabaseAdmin();
    // Supabase does not support OR with isNull directly in a single query easily; fetch both and merge
    const [{ data: personal, error: pErr }, { data: broadcast, error: bErr }] =
      await Promise.all([
        supabase
          .from("notifications")
          .select("*")
          .eq("recipientUserId", ctx.user.id)
          .order("createdAt", { ascending: false })
          .limit(50),
        supabase
          .from("notifications")
          .select("*")
          .is("recipientUserId", null)
          .order("createdAt", { ascending: false })
          .limit(50),
      ]);
    if (pErr)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: pErr.message,
      });
    if (bErr)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: bErr.message,
      });
    const rows = [
      ...((personal ?? []) as any[]),
      ...((broadcast ?? []) as any[]),
    ]
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
      .slice(0, 50);
    return { items: rows, unreadCount: rows.filter(row => !row.readAt).length };
  }),
  markRead: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const supabase = getSupabaseAdmin();
      const { data: items, error: fErr } = await supabase
        .from("notifications")
        .select("*")
        .eq("id", input.id)
        .limit(1)
        .maybeSingle();
      if (fErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: fErr.message,
        });
      if (
        !items ||
        ((items as any).recipientUserId !== null &&
          (items as any).recipientUserId !== ctx.user.id)
      )
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Notification not found.",
        });
      if (!(items as any).readAt) {
        const { error } = await supabase
          .from("notifications")
          .update({ readAt: new Date().toISOString() } as any)
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
      }
      return { success: true };
    }),
  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();
    // Update personal unread
    const { error: pErr } = await supabase
      .from("notifications")
      .update({ readAt: now } as any)
      .eq("recipientUserId", ctx.user.id)
      .is("readAt", null);
    if (pErr)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: pErr.message,
      });
    // Update broadcast unread
    const { error: bErr } = await supabase
      .from("notifications")
      .update({ readAt: now } as any)
      .is("recipientUserId", null)
      .is("readAt", null);
    if (bErr)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: bErr.message,
      });
    return { success: true };
  }),
});

export const searchRouter = router({
  query: protectedProcedure
    .input(z.object({ q: z.string().trim().min(1).max(100) }))
    .query(async ({ ctx, input }) => {
      const role = await resolveStaffRole(ctx.user);
      if (!role)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "A current staff profile is required.",
        });
      const supabase = getSupabaseAdmin();
      const search = escapePostgrestOr(input.q);
      const scope = await getOutletScope(ctx.user);
      const results: Array<{
        type: "order" | "menu" | "member" | "staff" | "inventory";
        id: number;
        title: string;
        subtitle: string;
        href: string;
      }> = [];
      if (roleCan(role, "orders")) {
        const numericSearch = Number(search);
        const isNumeric =
          !Number.isNaN(numericSearch) &&
          String(numericSearch) === search.trim();
        let rows: any[] = [];
        // orderNumber is integer — use eq when search is numeric, otherwise skip orderNumber filter
        if (isNumeric) {
          const { data, error } = await supabase
            .from("orders")
            .select("id,orderNumber,status,customerId,outletId")
            .eq("orderNumber", numericSearch)
            .order("id", { ascending: false })
            .limit(6);
          if (error)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
            });
          rows = (data ?? []) as any[];
        }
        // Also search by orderNumber substring via client-side filter as fallback (fetch recent and match)
        if (!isNumeric || rows.length < 6) {
          try {
            const { data: recent } = await supabase
              .from("orders")
              .select("id,orderNumber,status,customerId,outletId")
              .order("id", { ascending: false })
              .limit(30);
            const substringMatches = ((recent ?? []) as any[]).filter(
              (r: any) =>
                String(r.orderNumber).includes(search) &&
                !rows.some(x => x.id === r.id)
            );
            rows = [...rows, ...substringMatches].slice(0, 6);
          } catch {}
        }
        // Enrich customer names and also search by customer name
        const ids = (rows as any[])
          .map(r => r.customerId)
          .filter(Boolean) as number[];
        let customerMap = new Map<number, string>();
        if (ids.length) {
          const { data: custs } = await supabase
            .from("customers")
            .select("id,name")
            .in("id", ids);
          customerMap = new Map(
            ((custs ?? []) as any[]).map((c: any) => [c.id, c.name])
          );
        }
        // If search matches customer name, also fetch orders whose customer name matches
        let extraOrderRows: any[] = [];
        try {
          const { data: matchingCustomers } = await supabase
            .from("customers")
            .select("id,name")
            .ilike("name", `%${search}%`)
            .limit(6);
          const custIds = ((matchingCustomers ?? []) as any[]).map(
            (c: any) => c.id
          );
          if (custIds.length) {
            const { data: extra } = await supabase
              .from("orders")
              .select("id,orderNumber,status,customerId")
              .in("customerId", custIds)
              .order("id", { ascending: false })
              .limit(6);
            extraOrderRows = (extra ?? []) as any[];
          }
        } catch {}
        const merged = [...(rows as any[]), ...extraOrderRows].slice(0, 6);
        // dedupe by id
        const seen = new Set<number>();
        let unique = merged
          .filter(r => {
            if (seen.has(r.id)) return false;
            seen.add(r.id);
            return true;
          })
          .slice(0, 6);
        // Scoped callers only see orders in their outlets.
        if (scope !== null && scope.length)
          unique = unique.filter(
            (r: any) => r.outletId && scope.includes(r.outletId)
          );
        // Ensure customerMap covers extra
        if (extraOrderRows.length) {
          const extraIds = extraOrderRows
            .map(r => r.customerId)
            .filter(Boolean) as number[];
          if (extraIds.length) {
            const { data: extraCusts } = await supabase
              .from("customers")
              .select("id,name")
              .in("id", extraIds);
            for (const c of (extraCusts ?? []) as any[])
              if (!customerMap.has(c.id)) customerMap.set(c.id, c.name);
          }
        }
        results.push(
          ...unique.map((row: any) => ({
            type: "order" as const,
            id: row.id,
            title: `Order #${row.orderNumber}`,
            subtitle: `${customerMap.get(row.customerId) ?? "Walk-in guest"} · ${row.status}`,
            href: `/orders/${row.id}`,
          }))
        );
      }
      if (roleCan(role, "menu")) {
        const { data: rows, error } = await supabase
          .from("menu_items")
          .select("id,name,available")
          .ilike("name", `%${search}%`)
          .order("name", { ascending: true })
          .limit(6);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        results.push(
          ...((rows ?? []) as any[]).map((row: any) => ({
            type: "menu" as const,
            id: row.id,
            title: row.name,
            subtitle: row.available
              ? "Menu item · available"
              : "Menu item · paused",
            href: `/menu?item=${row.id}`,
          }))
        );
      }
      if (roleCan(role, "inventory")) {
        const { data: invData, error } = await supabase
          .from("inventory_items")
          .select("id,name,sku,quantity,unit,outletId")
          .or(`name.ilike.%${search}%,sku.ilike.%${search}%`)
          .order("name", { ascending: true })
          .limit(6);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        let invRows = (invData ?? []) as any[];
        if (scope !== null && scope.length)
          invRows = invRows.filter(
            (r: any) => r.outletId && scope.includes(r.outletId)
          );
        results.push(
          ...invRows.map((row: any) => ({
            type: "inventory" as const,
            id: row.id,
            title: row.name,
            subtitle: `Inventory · ${row.sku} · ${row.quantity} ${row.unit}`,
            href: `/inventory/items/${row.id}`,
          }))
        );
      }
      if (roleCan(role, "loyalty")) {
        const { data: rowsRaw, error } = await supabase
          .from("customers")
          .select("id,name,phone")
          .or(`name.ilike.%${search}%,phone.ilike.%${search}%`)
          .order("id", { ascending: false })
          .limit(6);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        let rows = (rowsRaw ?? []) as any[];
        // Outlet-scoped callers only see customers who have ordered in their outlets.
        if (scope !== null && scope.length) {
          try {
            const sql = await getSql();
            const allowed = (await sql.unsafe(
              `SELECT DISTINCT "customerId" FROM "orders" WHERE "outletId" = ANY($1) AND "customerId" IS NOT NULL`,
              [scope]
            )) as any[];
            const allowedSet = new Set(
              allowed.map((r: any) => Number(r.customerId))
            );
            rows = rows.filter((row: any) => allowedSet.has(row.id));
          } catch {
            rows = [];
          }
        }
        results.push(
          ...rows.map((row: any) => ({
            type: "member" as const,
            id: row.id,
            title: row.name ?? row.phone,
            subtitle: `Member · ${row.phone}`,
            href: `/loyalty/${row.id}`,
          }))
        );
      }
      if (roleCan(role, "staff")) {
        const { data: rowsRaw, error } = await supabase
          .from("staff")
          .select("id,name,email")
          .or(`name.ilike.%${search}%,email.ilike.%${search}%`)
          .order("name", { ascending: true })
          .limit(6);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        let rows = (rowsRaw ?? []) as any[];
        // Outlet-scoped callers only see staff assigned to their outlets.
        if (scope !== null && scope.length) {
          const { data: assigned } = await supabase
            .from("outlet_staff")
            .select("staffId")
            .in("outletId", scope);
          const assignedSet = new Set(
            (assigned ?? []).map((a: any) => a.staffId)
          );
          rows = rows.filter((row: any) => assignedSet.has(row.id));
        }
        results.push(
          ...rows.map((row: any) => ({
            type: "staff" as const,
            id: row.id,
            title: row.name,
            subtitle: `Staff · ${row.email}`,
            href: `/staff?member=${row.id}`,
          }))
        );
      }
      return results.slice(0, 12);
    }),
});

export const analyticsRouter = router({
  overview: protectedProcedure
    .input(
      z.object({
        from: z.date(),
        to: z.date(),
        shiftId: z.number().int().positive().optional(),
        outletId: z.number().int().positive().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await requireAccess(ctx.user, "analytics.read");
      if (
        input.to.getTime() < input.from.getTime() ||
        input.to.getTime() - input.from.getTime() > 92 * 86400000
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Select a date range of up to 92 days.",
        });
      const { getOutletScope } = await import("../db/index");
      const scope = await getOutletScope(ctx.user);
      if (input.outletId && scope !== null && !scope.includes(input.outletId))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this outlet.",
        });
      // Aggregate in SQL instead of loading every in-range order and its items.
      const conditions: string[] = [
        `o."status" <> 'cancelled'`,
        `o."createdAt" >= $1`,
        `o."createdAt" <= $2`,
      ];
      const params: any[] = [input.from.toISOString(), input.to.toISOString()];
      let idx = 3;
      if (input.shiftId) {
        conditions.push(`o."shiftId" = $${idx++}`);
        params.push(input.shiftId);
      }
      if (input.outletId) {
        conditions.push(`o."outletId" = $${idx++}`);
        params.push(input.outletId);
      } else if (scope !== null) {
        if (scope.length === 0)
          return {
            totalRevenue: 0,
            totalOrders: 0,
            averageOrderValue: 0,
            daily: [],
            topItems: [],
          };
        if (scope.length === 1) {
          conditions.push(`o."outletId" = $${idx++}`);
          params.push(scope[0]);
        } else {
          conditions.push(`o."outletId" = ANY($${idx++})`);
          params.push(scope);
        }
      }
      const where = conditions.join(" AND ");
      const sql = await getSql();

      const summary = (await sql.unsafe(
        `
      SELECT count(*)::int AS "totalOrders",
        COALESCE(sum(CASE WHEN o."paymentStatus" = 'paid' THEN o."total" ELSE 0 END), 0) AS "totalRevenue"
      FROM "orders" o WHERE ${where}
    `,
        params
      )) as any[];
      const totalOrders = Number(summary[0]?.totalOrders ?? 0);
      const totalRevenue = numberValue(summary[0]?.totalRevenue);

      const dailyRows = (await sql.unsafe(
        `
      SELECT to_char(o."createdAt"::date, 'YYYY-MM-DD') AS "date", sum(o."total") AS "revenue"
      FROM "orders" o WHERE ${where} AND o."paymentStatus" = 'paid'
      GROUP BY 1 ORDER BY 1
    `,
        params
      )) as any[];
      const daily = dailyRows.map((r: any) => ({
        date: r.date as string,
        revenue: numberValue(r.revenue),
      }));

      const topRows = (await sql.unsafe(
        `
      SELECT oi."itemName", oi."variantName",
        sum(oi."quantity")::int AS "units",
        sum(oi."lineTotal") AS "revenue"
      FROM "order_items" oi
      JOIN "orders" o ON o."id" = oi."orderId"
      WHERE ${where}
      GROUP BY oi."itemName", oi."variantName"
      ORDER BY "revenue" DESC
      LIMIT 10
    `,
        params
      )) as any[];
      const topItems = topRows.map((r: any) => ({
        name: r.variantName ? `${r.itemName} — ${r.variantName}` : r.itemName,
        units: numberValue(r.units),
        revenue: numberValue(r.revenue),
      }));

      return {
        totalRevenue,
        totalOrders,
        averageOrderValue: totalOrders ? totalRevenue / totalOrders : 0,
        daily,
        topItems,
      };
    }),
});
