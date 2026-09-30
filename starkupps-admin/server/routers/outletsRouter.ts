import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  assertOutletAccess,
  escapePostgrestOr,
  getOutletScope,
  hasPermission,
  recordAudit,
  resolveStaffRole,
} from "../db/index";
import { protectedProcedure, router } from "../lib/trpc";
import { getSupabaseAdmin, getSql } from "../db/supabase";

async function requirePerm(user: any, perm: any) {
  const role = await resolveStaffRole(user);
  if (!role || !hasPermission(role, perm))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Your staff role does not have access to this operation.",
    });
  return role;
}

export const outletsRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          search: z.string().trim().max(160).optional(),
          status: z
            .enum(["active", "temporarily_closed", "maintenance", "inactive"])
            .optional(),
          limit: z.number().int().min(1).max(100).default(50),
          cursor: z.number().int().positive().optional(),
        })
        .nullish()
    )
    .query(async ({ ctx, input }) => {
      await requirePerm(ctx.user, "outlets.read");
      const supabase = getSupabaseAdmin();
      const scope = await getOutletScope(ctx.user);
      if (scope !== null && scope.length === 0)
        return { items: [], nextCursor: undefined };

      const limit = input?.limit ?? 50;
      const limitPlusOne = limit + 1;

      let query = supabase.from("outlets").select("*");

      if (input?.cursor) query = query.lt("id", input.cursor);
      if (input?.status) query = query.eq("status", input.status);
      if (input?.search) {
        const escaped = escapePostgrestOr(input.search);
        query = query.or(
          `name.ilike.%${escaped}%,code.ilike.%${escaped}%,city.ilike.%${escaped}%`
        );
      }
      if (scope !== null) {
        if (scope.length === 1) query = query.eq("id", scope[0]);
        else query = query.in("id", scope);
      }

      query = query.order("id", { ascending: false }).limit(limitPlusOne);

      const { data, error } = await query;
      if (error)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });

      const rows = (data ?? []) as any[];
      const page = rows.slice(0, limit);

      // Single grouped aggregate query instead of 4 queries per outlet (N+1).
      const pageIds = page.map(o => o.id);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let stats = new Map<
        number,
        {
          orderCount: number;
          staffCount: number;
          riderCount: number;
          todayRevenue: number;
        }
      >();
      if (pageIds.length) {
        try {
          const sql = await getSql();
          const statsRows = (await sql.unsafe(
            `
            SELECT o."id" AS "outletId",
              (SELECT count(*) FROM "orders" x WHERE x."outletId" = o."id") AS "orderCount",
              (SELECT count(*) FROM "outlet_staff" s WHERE s."outletId" = o."id") AS "staffCount",
              (SELECT count(*) FROM "riders" r WHERE r."outletId" = o."id") AS "riderCount",
              COALESCE((
                SELECT sum(x."total") FROM "orders" x
                WHERE x."outletId" = o."id" AND x."paymentStatus" = 'paid' AND x."status" <> 'cancelled' AND x."createdAt" >= $1
              ), 0) AS "todayRevenue"
            FROM "outlets" o
            WHERE o."id" = ANY($2)
          `,
            [today.toISOString(), pageIds]
          )) as any[];
          stats = new Map(
            statsRows.map((r: any) => [
              Number(r.outletId),
              {
                orderCount: Number(r.orderCount),
                staffCount: Number(r.staffCount),
                riderCount: Number(r.riderCount),
                todayRevenue: Number(r.todayRevenue),
              },
            ])
          );
        } catch {
          stats = new Map();
        }
      }
      const enriched = page.map(o => {
        const s = stats.get(o.id) ?? {
          orderCount: 0,
          staffCount: 0,
          riderCount: 0,
          todayRevenue: 0,
        };
        return {
          ...o,
          deliveryRadiusKm: Number(o.deliveryRadiusKm ?? 0),
          minimumOrder: Number(o.minimumOrder ?? 0),
          ...s,
        };
      });

      return {
        items: enriched,
        nextCursor: rows.length > limit ? page.at(-1)?.id : undefined,
      };
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await requirePerm(ctx.user, "outlets.read");
      await assertOutletAccess(ctx.user, input.id);
      const supabase = getSupabaseAdmin();

      const { data: outlet, error } = await supabase
        .from("outlets")
        .select("*")
        .eq("id", input.id)
        .limit(1)
        .maybeSingle();
      if (error)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      if (!outlet)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Outlet not found.",
        });

      const [{ data: hours }, { data: zones }, { data: closures }] =
        await Promise.all([
          supabase
            .from("outlet_hours")
            .select("*")
            .eq("outletId", input.id)
            .order("dayOfWeek", { ascending: true }),
          supabase.from("delivery_zones").select("*").eq("outletId", input.id),
          supabase
            .from("outlet_closures")
            .select("*")
            .eq("outletId", input.id)
            .order("startAt", { ascending: false })
            .limit(10),
        ]);

      const stats = {
        todayRevenue: 0,
        todayOrders: 0,
        activeOrders: 0,
        completedOrders: 0,
        activeRiders: 0,
        lowStock: 0,
        currentStaff: 0,
      };
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const { data: todaysOrders } = await supabase
          .from("orders")
          .select("paymentStatus,status,total")
          .eq("outletId", input.id)
          .gte("createdAt", today.toISOString());
        const list = (todaysOrders ?? []) as any[];
        stats.todayOrders = list.length;
        stats.todayRevenue = list
          .filter(x => x.paymentStatus === "paid" && x.status !== "cancelled")
          .reduce((s: number, x: any) => s + Number(x.total ?? 0), 0);
        stats.activeOrders = list.filter(x =>
          ["new", "preparing", "ready"].includes(x.status)
        ).length;
        stats.completedOrders = list.filter(
          x => x.status === "completed"
        ).length;
      } catch {}
      try {
        const { count } = await supabase
          .from("riders")
          .select("id", { count: "exact", head: true })
          .eq("outletId", input.id)
          .eq("status", "available");
        stats.activeRiders = Number(count ?? 0);
      } catch {}
      try {
        const { count } = await supabase
          .from("outlet_staff")
          .select("id", { count: "exact", head: true })
          .eq("outletId", input.id);
        stats.currentStaff = Number(count ?? 0);
      } catch {}
      try {
        // low stock via Supabase: fetch quantities and compare in JS or via getSql for precise decimal comparison
        // Try via getSql for complex filter, fallback to JS
        try {
          const sql = await getSql();
          const low = await sql.unsafe(
            `SELECT count(*)::int as c FROM "inventory_items" WHERE "outletId" = $1 AND CAST("quantity" AS DECIMAL) <= CAST("reorderLevel" AS DECIMAL)`,
            [input.id]
          );
          stats.lowStock = Number(low[0]?.c ?? 0);
        } catch {
          const { data: items } = await supabase
            .from("inventory_items")
            .select("quantity,reorderLevel")
            .eq("outletId", input.id);
          stats.lowStock = (items ?? []).filter(
            (r: any) => Number(r.quantity) <= Number(r.reorderLevel)
          ).length;
        }
      } catch {}

      // Extended for detail tabs & setup checklist (branch config)
      let owner: any = null;
      let assignedStaff: any[] = [];
      let menuAvailCount = 0;
      let inventoryCount = 0;
      try {
        if ((outlet as any).ownerId) {
          const { data: o } = await supabase
            .from("staff")
            .select("id,name,email,role")
            .eq("id", (outlet as any).ownerId)
            .maybeSingle();
          owner = o ?? null;
        }
      } catch {}
      try {
        const { data: os } = await supabase
          .from("outlet_staff")
          .select("staffId")
          .eq("outletId", input.id);
        const sids = (os ?? []).map((r: any) => r.staffId);
        if (sids.length) {
          const { data: staffRows } = await supabase
            .from("staff")
            .select("id,name,email,role")
            .in("id", sids);
          assignedStaff = (staffRows ?? []) as any[];
        }
      } catch {}
      try {
        const { count } = await supabase
          .from("outlet_menu_availability")
          .select("id", { count: "exact", head: true })
          .eq("outletId", input.id);
        menuAvailCount = Number(count ?? 0);
      } catch {}
      try {
        const { count } = await supabase
          .from("inventory_items")
          .select("id", { count: "exact", head: true })
          .eq("outletId", input.id);
        inventoryCount = Number(count ?? 0);
      } catch {}

      return {
        outlet: {
          ...(outlet as any),
          deliveryRadiusKm: Number((outlet as any).deliveryRadiusKm ?? 0),
          minimumOrder: Number((outlet as any).minimumOrder ?? 0),
        },
        hours: (hours ?? []) as any[],
        zones: (zones ?? []) as any[],
        closures: (closures ?? []) as any[],
        stats,
        owner,
        assignedStaff,
        menuAvailCount,
        inventoryCount,
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        code: z
          .string()
          .trim()
          .max(20)
          .optional()
          .transform(v => (v && v.trim().length >= 2 ? v.trim() : undefined)),
        name: z.string().trim().min(2).max(160),
        // Simplified per outlet architecture — owner/manager via staff relation
        ownerId: z.number().int().positive().nullable().optional(),
        status: z.enum(["active", "inactive"]).default("active"),
        // Location — state/city validated via shared indiaLocations, map picker for lat/lng
        address: z.string().trim().min(5).max(1000),
        state: z.string().trim().min(2).max(80),
        city: z.string().trim().min(2).max(80),
        pincode: z.string().trim().max(12).nullable().optional(),
        latitude: z.number().min(-90).max(90).nullable().optional(),
        longitude: z.number().min(-180).max(180).nullable().optional(),
        // Contact
        phone: z.string().trim().max(32).nullable().optional(),
        email: z.string().trim().email().max(320).nullable().optional(),
        // Initial setup — delivery toggle + appointed staff (proper outlet_staff relations)
        deliveryEnabled: z.boolean().default(true),
        staffIds: z.array(z.number().int().positive()).max(50).default([]),
        // Legacy fields kept optional for backward compat (ignored, operational config moved to dedicated tabs)
        timezone: z.string().trim().min(3).max(80).optional(),
        openingTime: z
          .string()
          .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
          .optional(),
        closingTime: z
          .string()
          .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
          .optional(),
        deliveryRadiusKm: z.number().min(0).max(100).optional(),
        minimumOrder: z.number().min(0).max(100000).optional(),
        preparationTimeMinutes: z.number().int().min(1).max(240).optional(),
        services: z
          .object({
            dineIn: z.boolean(),
            takeaway: z.boolean(),
            delivery: z.boolean(),
            pos: z.boolean(),
            onlineOrdering: z.boolean(),
          })
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requirePerm(ctx.user, "outlets.create");
      // Validate state/city via shared source (state first, then city)
      {
        const { isValidIndianState, isValidIndianStateCity } =
          await import("../../shared/indiaLocations");
        if (!isValidIndianState(input.state)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Invalid state: ${input.state}`,
          });
        }
        if (!isValidIndianStateCity(input.state, input.city)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `City "${input.city}" does not belong to state "${input.state}"`,
          });
        }
      }
      if (input.pincode && !/^\d{4,12}$/.test(input.pincode)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Pincode must be 4–12 digits",
        });
      }
      if (
        input.latitude != null &&
        (isNaN(input.latitude) || input.latitude < -90 || input.latitude > 90)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid latitude",
        });
      }
      if (
        input.longitude != null &&
        (isNaN(input.longitude) ||
          input.longitude < -180 ||
          input.longitude > 180)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid longitude",
        });
      }
      // Validate owner and staffIds are existing active staff
      const supabase = getSupabaseAdmin();
      if (input.ownerId) {
        const { data: owner, error: oErr } = await supabase
          .from("staff")
          .select("id,active,status")
          .eq("id", input.ownerId)
          .maybeSingle();
        if (oErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: oErr.message,
          });
        if (!owner)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Selected owner not found",
          });
        if (
          !(owner as any).active ||
          !["active", "on_leave"].includes((owner as any).status)
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Owner must be an active staff member",
          });
        }
      }
      if (input.staffIds.length) {
        const { data: staffRows, error: sErr } = await supabase
          .from("staff")
          .select("id,active,status")
          .in("id", input.staffIds);
        if (sErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: sErr.message,
          });
        const found = new Set((staffRows ?? []).map((r: any) => r.id));
        for (const sid of input.staffIds) {
          if (!found.has(sid))
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Staff ${sid} not found`,
            });
        }
        for (const r of (staffRows ?? []) as any[]) {
          if (!r.active || !["active", "on_leave"].includes(r.status)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Staff ${r.id} is not active`,
            });
          }
        }
      }
      let codeUpper = (input.code || "").trim().toUpperCase();
      if (codeUpper && !/^[A-Z0-9-]+$/.test(codeUpper)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Code must be alphanumeric with hyphens",
        });
      }
      if (codeUpper && codeUpper.length > 20) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Code must be ≤20 chars",
        });
      }
      // Auto-generate if empty or fallback on collision (client now auto-generates SK-XXXX)
      const genCode = () =>
        `SK-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      if (!codeUpper) codeUpper = genCode();
      // Ensure uniqueness — retry up to 5 times if collision (covers race)
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data: exists, error: existsErr } = await supabase
          .from("outlets")
          .select("id")
          .eq("code", codeUpper)
          .limit(1)
          .maybeSingle();
        if (existsErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: existsErr.message,
          });
        if (!exists) break;
        if (attempt === 4)
          throw new TRPCError({
            code: "CONFLICT",
            message: "Outlet code already exists. Please regenerate.",
          });
        codeUpper = genCode();
      }
      // Build outlet payload — only essential fields, operational defaults handled server-side
      const services = {
        dineIn: true,
        takeaway: true,
        delivery: !!input.deliveryEnabled,
        pos: true,
        onlineOrdering: true,
      };
      const payload: any = {
        code: codeUpper,
        name: input.name.trim(),
        phone: input.phone?.trim() || null,
        email: input.email?.trim() || null,
        address: input.address.trim(),
        city: input.city.trim(),
        state: input.state.trim(),
        pincode: input.pincode?.trim() || null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        timezone: "Asia/Kolkata",
        openingTime: "09:00",
        closingTime: "22:00",
        deliveryRadiusKm: 5,
        minimumOrder: 0,
        preparationTimeMinutes: 20,
        status: input.status,
        services,
        ownerId: input.ownerId ?? null,
      };
      // Atomic creation: outlet + hours + staff assignments
      let outletId: number;
      try {
        const sql = await getSql();
        outletId = await sql.begin(async (tx: any) => {
          const [inserted]: any[] = await tx.unsafe(
            `INSERT INTO outlets (code, name, phone, email, address, city, state, pincode, latitude, longitude, timezone, "openingTime", "closingTime", "deliveryRadiusKm", "minimumOrder", "preparationTimeMinutes", status, services, "ownerId")
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
            [
              payload.code,
              payload.name,
              payload.phone,
              payload.email,
              payload.address,
              payload.city,
              payload.state,
              payload.pincode,
              payload.latitude,
              payload.longitude,
              payload.timezone,
              payload.openingTime,
              payload.closingTime,
              payload.deliveryRadiusKm,
              payload.minimumOrder,
              payload.preparationTimeMinutes,
              payload.status,
              JSON.stringify(payload.services),
              payload.ownerId,
            ]
          );
          const id = Number(inserted.id);
          // Default operating hours — all open 09:00-22:00 (admin configures via Operating Hours tab after)
          const hoursValues = Array.from(
            { length: 7 },
            (_, d) => `(${id}, ${d}, true, '09:00', '22:00')`
          ).join(", ");
          await tx.unsafe(
            `INSERT INTO outlet_hours ("outletId", "dayOfWeek", "isOpen", "openTime", "closeTime") VALUES ${hoursValues}`
          );
          // Staff assignments — owner + appointed staff (deduplicated, proper outlet_staff relations)
          const allStaffIds = Array.from(
            new Set(
              [input.ownerId, ...input.staffIds].filter(Boolean) as number[]
            )
          );
          if (allStaffIds.length) {
            const staffValues = allStaffIds
              .map(sid => `(${id}, ${sid})`)
              .join(", ");
            await tx.unsafe(
              `INSERT INTO outlet_staff ("outletId", "staffId") VALUES ${staffValues} ON CONFLICT DO NOTHING`
            );
          }
          return id;
        });
      } catch (e: any) {
        // Fallback to Supabase client if direct SQL fails (e.g. ownerId column not yet migrated in some env)
        if (/ownerId/i.test(String(e.message))) {
          const { data: inserted, error: insErr } = await supabase
            .from("outlets")
            .insert({ ...payload, ownerId: undefined } as any)
            .select("id")
            .single();
          if (insErr)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: insErr.message,
            });
          outletId = Number((inserted as any).id);
          try {
            const defaultHours = Array.from({ length: 7 }, (_, d) => ({
              outletId,
              dayOfWeek: d,
              isOpen: true,
              openTime: "09:00",
              closeTime: "22:00",
            }));
            await supabase.from("outlet_hours").insert(defaultHours as any);
          } catch {}
          const allStaffIds = Array.from(
            new Set(
              [input.ownerId, ...input.staffIds].filter(Boolean) as number[]
            )
          );
          if (allStaffIds.length) {
            await supabase
              .from("outlet_staff")
              .insert(
                allStaffIds.map(sid => ({ outletId, staffId: sid }) as any)
              );
          }
        } else {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: e.message ?? "Failed to create outlet",
          });
        }
      }
      const id = outletId!;
      try {
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "outlet",
          entityId: id,
          action: "created",
          after: {
            code: codeUpper,
            name: input.name,
            ownerId: input.ownerId,
            staffIds: input.staffIds,
            deliveryEnabled: input.deliveryEnabled,
          },
        });
        if (input.ownerId)
          await recordAudit({
            actorUserId: ctx.user.id,
            entityType: "outlet",
            entityId: id,
            outletId: id,
            action: "owner_assigned",
            after: { ownerId: input.ownerId },
          });
        if (input.staffIds.length)
          await recordAudit({
            actorUserId: ctx.user.id,
            entityType: "outlet",
            entityId: id,
            outletId: id,
            action: "staff_assigned",
            after: { staffIds: input.staffIds },
          });
      } catch {}
      return { id };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().trim().min(2).max(160),
        phone: z.string().trim().max(32).nullable(),
        email: z.string().trim().email().max(320).nullable(),
        address: z.string().trim().max(1000).nullable(),
        city: z.string().trim().max(80).nullable(),
        state: z.string().trim().max(80).nullable(),
        pincode: z.string().trim().max(12).nullable(),
        latitude: z.number().min(-90).max(90).nullable(),
        longitude: z.number().min(-180).max(180).nullable(),
        timezone: z.string().trim().min(3).max(80),
        openingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        closingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        deliveryRadiusKm: z.number().min(0).max(100),
        minimumOrder: z.number().min(0).max(100000),
        preparationTimeMinutes: z.number().int().min(1).max(240),
        status: z.enum([
          "active",
          "temporarily_closed",
          "maintenance",
          "inactive",
        ]),
        services: z.object({
          dineIn: z.boolean(),
          takeaway: z.boolean(),
          delivery: z.boolean(),
          pos: z.boolean(),
          onlineOrdering: z.boolean(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requirePerm(ctx.user, "outlets.update");
      await assertOutletAccess(ctx.user, input.id);
      if ((input as any).state || (input as any).city) {
        const { isValidIndianState, isValidIndianStateCity } =
          await import("../../shared/indiaLocations");
        if ((input as any).state && !isValidIndianState((input as any).state)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Invalid state: ${(input as any).state}`,
          });
        }
        if (
          (input as any).state &&
          (input as any).city &&
          !isValidIndianStateCity((input as any).state, (input as any).city)
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `City "${(input as any).city}" does not belong to state "${(input as any).state}"`,
          });
        }
        if (!(input as any).state && (input as any).city) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Select state before city",
          });
        }
      }
      const supabase = getSupabaseAdmin();
      const { data: cur, error: curErr } = await supabase
        .from("outlets")
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
          message: "Outlet not found.",
        });
      const { id, ...data } = input;
      const payload: any = {
        ...data,
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
        deliveryRadiusKm: data.deliveryRadiusKm,
        minimumOrder: data.minimumOrder,
      };
      const { error: updErr } = await supabase
        .from("outlets")
        .update(payload)
        .eq("id", id);
      if (updErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: updErr.message,
        });
      await recordAudit({
        actorUserId: ctx.user.id,
        entityType: "outlet",
        entityId: id,
        outletId: id,
        action: "updated",
        before: cur as any,
        after: payload,
      });
      return { success: true };
    }),

  setStatus: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        status: z.enum([
          "active",
          "temporarily_closed",
          "maintenance",
          "inactive",
        ]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requirePerm(ctx.user, "outlets.update");
      await assertOutletAccess(ctx.user, input.id);
      const supabase = getSupabaseAdmin();
      const { data: cur, error: curErr } = await supabase
        .from("outlets")
        .select("id,status")
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
          message: "Outlet not found.",
        });
      const { error: updErr } = await supabase
        .from("outlets")
        .update({ status: input.status } as any)
        .eq("id", input.id);
      if (updErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: updErr.message,
        });
      await recordAudit({
        actorUserId: ctx.user.id,
        entityType: "outlet",
        entityId: input.id,
        outletId: input.id,
        action: "status_changed",
        before: { status: (cur as any).status },
        after: { status: input.status },
      });
      return { success: true };
    }),

  hours: router({
    list: protectedProcedure
      .input(z.object({ outletId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        await requirePerm(ctx.user, "outlets.read");
        await assertOutletAccess(ctx.user, input.outletId);
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
          .from("outlet_hours")
          .select("*")
          .eq("outletId", input.outletId)
          .order("dayOfWeek", { ascending: true });
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        return (data ?? []) as any[];
      }),
    save: protectedProcedure
      .input(
        z.object({
          outletId: z.number().int().positive(),
          hours: z
            .array(
              z.object({
                dayOfWeek: z.number().int().min(0).max(6),
                isOpen: z.boolean(),
                openTime: z
                  .string()
                  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
                  .nullable(),
                closeTime: z
                  .string()
                  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
                  .nullable(),
              })
            )
            .length(7),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requirePerm(ctx.user, "outlets.update");
        await assertOutletAccess(ctx.user, input.outletId);
        const supabase = getSupabaseAdmin();
        for (const h of input.hours) {
          const { data: existing } = await supabase
            .from("outlet_hours")
            .select("id")
            .eq("outletId", input.outletId)
            .eq("dayOfWeek", h.dayOfWeek)
            .limit(1)
            .maybeSingle();
          if ((existing as any)?.id) {
            const { error } = await supabase
              .from("outlet_hours")
              .update({
                isOpen: h.isOpen,
                openTime: h.openTime,
                closeTime: h.closeTime,
              } as any)
              .eq("id", (existing as any).id);
            if (error)
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: error.message,
              });
          } else {
            const { error } = await supabase.from("outlet_hours").insert({
              outletId: input.outletId,
              dayOfWeek: h.dayOfWeek,
              isOpen: h.isOpen,
              openTime: h.openTime,
              closeTime: h.closeTime,
            } as any);
            if (error)
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: error.message,
              });
          }
        }
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "outlet_hours",
          entityId: input.outletId,
          outletId: input.outletId,
          action: "hours_updated",
          after: { hours: input.hours } as any,
        });
        return { success: true };
      }),
    closures: router({
      list: protectedProcedure
        .input(z.object({ outletId: z.number().int().positive() }))
        .query(async ({ ctx, input }) => {
          await requirePerm(ctx.user, "outlets.read");
          await assertOutletAccess(ctx.user, input.outletId);
          const supabase = getSupabaseAdmin();
          const { data, error } = await supabase
            .from("outlet_closures")
            .select("*")
            .eq("outletId", input.outletId)
            .order("startAt", { ascending: false });
          if (error)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
            });
          return (data ?? []) as any[];
        }),
      create: protectedProcedure
        .input(
          z.object({
            outletId: z.number().int().positive(),
            reason: z.string().trim().min(3).max(240),
            startAt: z.date(),
            endAt: z.date(),
          })
        )
        .mutation(async ({ ctx, input }) => {
          await requirePerm(ctx.user, "outlets.update");
          await assertOutletAccess(ctx.user, input.outletId);
          if (input.endAt <= input.startAt)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "End time must be after start time.",
            });
          const supabase = getSupabaseAdmin();
          const { data, error } = await supabase
            .from("outlet_closures")
            .insert({
              outletId: input.outletId,
              reason: input.reason,
              startAt: input.startAt.toISOString(),
              endAt: input.endAt.toISOString(),
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
      remove: protectedProcedure
        .input(z.object({ id: z.number().int().positive() }))
        .mutation(async ({ ctx, input }) => {
          await requirePerm(ctx.user, "outlets.update");
          const supabase = getSupabaseAdmin();
          const { data: cur, error: curErr } = await supabase
            .from("outlet_closures")
            .select("id,outletId")
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
              message: "Closure not found.",
            });
          await assertOutletAccess(ctx.user, (cur as any).outletId);
          const { error } = await supabase
            .from("outlet_closures")
            .delete()
            .eq("id", input.id);
          if (error)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
            });
          return { success: true };
        }),
    }),
  }),

  zones: router({
    list: protectedProcedure
      .input(z.object({ outletId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        await requirePerm(ctx.user, "outlets.read");
        await assertOutletAccess(ctx.user, input.outletId);
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
          .from("delivery_zones")
          .select("*")
          .eq("outletId", input.outletId)
          .order("name", { ascending: true });
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        return (data ?? []) as any[];
      }),
    create: protectedProcedure
      .input(
        z.object({
          outletId: z.number().int().positive(),
          name: z.string().trim().min(2).max(120),
          type: z
            .enum(["radius", "pincode", "polygon", "area"])
            .default("radius"),
          radiusKm: z.number().min(0).max(100).nullable(),
          pincodes: z
            .array(z.string().trim().min(3).max(10))
            .max(500)
            .nullable(),
          geoJson: z.record(z.string(), z.unknown()).nullable(),
          active: z.boolean().default(true),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requirePerm(ctx.user, "outlets.update");
        await assertOutletAccess(ctx.user, input.outletId);
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
          .from("delivery_zones")
          .insert({
            outletId: input.outletId,
            name: input.name,
            type: input.type,
            radiusKm: input.radiusKm ?? null,
            pincodes: input.pincodes as any,
            geoJson: input.geoJson as any,
            active: input.active,
          } as any)
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
          entityType: "delivery_zone",
          entityId: id,
          outletId: input.outletId,
          action: "created",
          after: input as any,
        });
        return { id };
      }),
    update: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          name: z.string().trim().min(2).max(120),
          radiusKm: z.number().min(0).max(100).nullable(),
          pincodes: z.array(z.string()).nullable(),
          active: z.boolean(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requirePerm(ctx.user, "outlets.update");
        const supabase = getSupabaseAdmin();
        const { data: cur, error: curErr } = await supabase
          .from("delivery_zones")
          .select("id,outletId")
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
            message: "Delivery zone not found.",
          });
        await assertOutletAccess(ctx.user, (cur as any).outletId);
        const { error } = await supabase
          .from("delivery_zones")
          .update({
            name: input.name,
            radiusKm: input.radiusKm ?? null,
            pincodes: input.pincodes as any,
            active: input.active,
          } as any)
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        return { success: true };
      }),
    remove: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await requirePerm(ctx.user, "outlets.update");
        const supabase = getSupabaseAdmin();
        const { data: cur, error: curErr } = await supabase
          .from("delivery_zones")
          .select("id,outletId")
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
            message: "Zone not found.",
          });
        await assertOutletAccess(ctx.user, (cur as any).outletId);
        const { error } = await supabase
          .from("delivery_zones")
          .delete()
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        return { success: true };
      }),
  }),

  menuAvailability: router({
    list: protectedProcedure
      .input(z.object({ outletId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        await requirePerm(ctx.user, "outlets.read");
        await assertOutletAccess(ctx.user, input.outletId);
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
          .from("outlet_menu_availability")
          .select("*")
          .eq("outletId", input.outletId);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        return (data ?? []) as any[];
      }),
    set: protectedProcedure
      .input(
        z.object({
          outletId: z.number().int().positive(),
          menuItemId: z.number().int().positive(),
          available: z.boolean(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requirePerm(ctx.user, "outlets.update");
        await assertOutletAccess(ctx.user, input.outletId);
        const supabase = getSupabaseAdmin();
        const { data: existing } = await supabase
          .from("outlet_menu_availability")
          .select("id")
          .eq("outletId", input.outletId)
          .eq("menuItemId", input.menuItemId)
          .limit(1)
          .maybeSingle();
        if ((existing as any)?.id) {
          const { error } = await supabase
            .from("outlet_menu_availability")
            .update({ available: input.available } as any)
            .eq("id", (existing as any).id);
          if (error)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
            });
        } else {
          const { error } = await supabase
            .from("outlet_menu_availability")
            .insert({
              outletId: input.outletId,
              menuItemId: input.menuItemId,
              available: input.available,
            } as any);
          if (error)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
            });
        }
        return { success: true };
      }),
  }),
});
