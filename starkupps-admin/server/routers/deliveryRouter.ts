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
import { getSql, getSupabaseAdmin } from "../db/supabase";

async function need(user: any, perm: any) {
  const r = await resolveStaffRole(user);
  if (!r || !hasPermission(r, perm))
    throw new TRPCError({ code: "FORBIDDEN", message: "Access denied." });
  return r;
}

export const deliveryRouter = router({
  riders: router({
    list: protectedProcedure
      .input(
        z
          .object({
            outletId: z.number().int().positive().optional(),
            status: z
              .enum(["online", "offline", "available", "busy", "suspended"])
              .optional(),
          })
          .nullish()
      )
      .query(async ({ ctx, input }) => {
        await need(ctx.user, "delivery.read");
        const supabase = getSupabaseAdmin();
        const scope = await getOutletScope(ctx.user);
        if (input?.outletId) await assertOutletAccess(ctx.user, input.outletId);
        if (scope !== null && scope.length === 0) return [];

        let query: any = supabase
          .from("riders")
          .select("*")
          .order("createdAt", { ascending: false })
          .limit(100);
        if (input?.outletId) query = query.eq("outletId", input.outletId);
        else if (scope !== null && scope.length) {
          if (scope.length === 1) query = query.eq("outletId", scope[0]);
          else query = query.in("outletId", scope);
        }
        if (input?.status) query = query.eq("status", input.status);

        const { data, error } = await query;
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        const rows = (data ?? []) as any[];
        if (!rows.length) return [];

        // enrich outletName
        const outletIds = Array.from(
          new Set(rows.map(r => r.outletId).filter(Boolean))
        ) as number[];
        let outletMap = new Map<number, string>();
        if (outletIds.length) {
          const { data: outlets } = await supabase
            .from("outlets")
            .select("id,name")
            .in("id", outletIds);
          outletMap = new Map((outlets ?? []).map((o: any) => [o.id, o.name]));
        }

        // batch fetch active deliveries for all riders
        const riderIds = rows.map(r => r.id);
        const activeByRider = new Map<number, any>();
        try {
          const { data: activeRows } = await supabase
            .from("deliveries")
            .select("*")
            .in("riderId", riderIds)
            .in("status", [
              "rider_assigned",
              "picked_up",
              "out_for_delivery",
            ] as any);
          for (const d of (activeRows ?? []) as any[]) {
            if (!activeByRider.has(d.riderId)) activeByRider.set(d.riderId, d);
          }
        } catch {}

        return rows.map(r => ({
          ...r,
          outletName: r.outletId ? (outletMap.get(r.outletId) ?? null) : null,
          rating: Number(r.rating),
          avgDeliveryMinutes: r.avgDeliveryMinutes,
          activeDelivery: activeByRider.get(r.id) ?? null,
        }));
      }),

    create: protectedProcedure
      .input(
        z.object({
          outletId: z.number().int().positive(),
          name: z.string().trim().min(2).max(160),
          phone: z.string().trim().min(8).max(32),
          vehicle: z
            .enum(["bike", "scooter", "bicycle", "car", "walk"])
            .default("bike"),
          status: z
            .enum(["online", "offline", "available", "busy", "suspended"])
            .default("offline"),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "riders.manage");
        await assertOutletAccess(ctx.user, input.outletId);
        const supabase = getSupabaseAdmin();
        const { data: dup, error: dupErr } = await supabase
          .from("riders")
          .select("id")
          .eq("phone", input.phone)
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
            message: "Rider phone already exists.",
          });

        const { data, error } = await supabase
          .from("riders")
          .insert(input as any)
          .select("id")
          .single();
        if (error) {
          if (/duplicate|unique/i.test(error.message))
            throw new TRPCError({
              code: "CONFLICT",
              message: "Rider phone already exists.",
            });
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        }
        const id = Number((data as any).id);
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "rider",
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
          name: z.string().trim().min(2).max(160),
          phone: z.string().trim().min(8).max(32),
          vehicle: z.enum(["bike", "scooter", "bicycle", "car", "walk"]),
          status: z.enum([
            "online",
            "offline",
            "available",
            "busy",
            "suspended",
          ]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "riders.manage");
        const supabase = getSupabaseAdmin();
        const { data: cur, error: curErr } = await supabase
          .from("riders")
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
            message: "Rider not found.",
          });
        if ((cur as any).outletId)
          await assertOutletAccess(ctx.user, (cur as any).outletId);

        const { error } = await supabase
          .from("riders")
          .update({
            name: input.name,
            phone: input.phone,
            vehicle: input.vehicle,
            status: input.status,
          } as any)
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "rider",
          entityId: input.id,
          outletId: (cur as any).outletId ?? null,
          action: "updated",
          after: { status: input.status, vehicle: input.vehicle },
        });
        return { success: true };
      }),

    setStatus: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          status: z.enum([
            "online",
            "offline",
            "available",
            "busy",
            "suspended",
          ]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "riders.manage");
        const supabase = getSupabaseAdmin();
        const { data: cur, error: curErr } = await supabase
          .from("riders")
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
            message: "Rider not found.",
          });
        await assertOutletAccess(ctx.user, (cur as any).outletId ?? null);
        const { error } = await supabase
          .from("riders")
          .update({ status: input.status } as any)
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "rider",
          entityId: input.id,
          outletId: (cur as any).outletId ?? null,
          action: "status_updated",
          after: { status: input.status },
        });
        return { success: true };
      }),
  }),

  live: protectedProcedure
    .input(
      z
        .object({
          outletId: z.number().int().positive().optional(),
          status: z
            .enum([
              "preparing",
              "ready",
              "rider_assigned",
              "picked_up",
              "out_for_delivery",
              "delivered",
              "failed",
              "cancelled",
            ])
            .optional(),
          limit: z.number().int().min(1).max(100).default(50),
        })
        .nullish()
    )
    .query(async ({ ctx, input }) => {
      await need(ctx.user, "delivery.read");
      const supabase = getSupabaseAdmin();
      const scope = await getOutletScope(ctx.user);
      if (input?.outletId) await assertOutletAccess(ctx.user, input.outletId);
      if (scope !== null && scope.length === 0) return [];

      let query: any = supabase
        .from("deliveries")
        .select("*")
        .order("createdAt", { ascending: false })
        .limit(input?.limit ?? 50);
      if (input?.outletId) query = query.eq("outletId", input.outletId);
      else if (scope !== null && scope.length) {
        if (scope.length === 1) query = query.eq("outletId", scope[0]);
        else query = query.in("outletId", scope);
      }
      if (input?.status) query = query.eq("status", input.status);

      const { data, error } = await query;
      if (error)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      const rows = (data ?? []) as any[];
      if (!rows.length) return [];

      const outletIds = Array.from(
        new Set(rows.map(r => r.outletId).filter(Boolean))
      ) as number[];
      const riderIds = Array.from(
        new Set(rows.map(r => r.riderId).filter(Boolean))
      ) as number[];
      const orderIds = Array.from(
        new Set(rows.map(r => r.orderId).filter(Boolean))
      ) as number[];

      let outletMap = new Map<number, string>();
      let riderMap = new Map<number, string>();
      let orderMap = new Map<
        number,
        { orderNumber: number; customerId: number | null }
      >();
      let customerMap = new Map<number, string>();

      if (outletIds.length) {
        const { data: outlets } = await supabase
          .from("outlets")
          .select("id,name")
          .in("id", outletIds);
        outletMap = new Map((outlets ?? []).map((o: any) => [o.id, o.name]));
      }
      if (riderIds.length) {
        const { data: riders } = await supabase
          .from("riders")
          .select("id,name")
          .in("id", riderIds);
        riderMap = new Map((riders ?? []).map((r: any) => [r.id, r.name]));
      }
      if (orderIds.length) {
        const { data: orders } = await supabase
          .from("orders")
          .select("id,orderNumber,customerId")
          .in("id", orderIds);
        orderMap = new Map(
          (orders ?? []).map((o: any) => [
            o.id,
            { orderNumber: o.orderNumber, customerId: o.customerId },
          ])
        );
        const customerIds = Array.from(
          new Set((orders ?? []).map((o: any) => o.customerId).filter(Boolean))
        ) as number[];
        if (customerIds.length) {
          const { data: customers } = await supabase
            .from("customers")
            .select("id,name")
            .in("id", customerIds);
          customerMap = new Map(
            (customers ?? []).map((c: any) => [c.id, c.name])
          );
        }
      }

      return rows.map(r => {
        const orderInfo = orderMap.get(r.orderId);
        return {
          ...r,
          outletName: outletMap.get(r.outletId) ?? null,
          riderName: r.riderId ? (riderMap.get(r.riderId) ?? null) : null,
          orderNumber: orderInfo?.orderNumber ?? null,
          customerName: orderInfo?.customerId
            ? (customerMap.get(orderInfo.customerId) ?? null)
            : null,
          elapsedMinutes: Math.round(
            (Date.now() - new Date(r.createdAt).getTime()) / 60000
          ),
        };
      });
    }),

  assignments: router({
    assign: protectedProcedure
      .input(
        z.object({
          deliveryId: z.number().int().positive(),
          riderId: z.number().int().positive(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "delivery.assign");
        const supabase = getSupabaseAdmin();
        const { data: del, error: delErr } = await supabase
          .from("deliveries")
          .select("*")
          .eq("id", input.deliveryId)
          .limit(1)
          .maybeSingle();
        if (delErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: delErr.message,
          });
        if (!del)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Delivery not found.",
          });
        await assertOutletAccess(ctx.user, (del as any).outletId);

        const { data: rider, error: riderErr } = await supabase
          .from("riders")
          .select("*")
          .eq("id", input.riderId)
          .limit(1)
          .maybeSingle();
        if (riderErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: riderErr.message,
          });
        if (!rider)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Rider not found.",
          });
        if (
          (rider as any).status === "suspended" ||
          (rider as any).status === "offline"
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Rider is not available.",
          });

        try {
          const sql = await getSql();
          await sql.begin(async (tx: any) => {
            await tx.unsafe(
              `UPDATE "deliveries" SET "riderId" = $1, "status" = 'rider_assigned', "assignedAt" = $2 WHERE "id" = $3`,
              [input.riderId, new Date().toISOString(), input.deliveryId]
            );
            await tx.unsafe(
              `UPDATE "riders" SET "status" = 'busy' WHERE "id" = $1`,
              [input.riderId]
            );
          });
        } catch {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "The rider could not be assigned. Please try again.",
          });
        }

        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "delivery",
          entityId: input.deliveryId,
          outletId: (del as any).outletId,
          action: "rider_assigned",
          after: { riderId: input.riderId } as any,
        });
        return { success: true };
      }),

    reassign: protectedProcedure
      .input(
        z.object({
          deliveryId: z.number().int().positive(),
          riderId: z.number().int().positive(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "delivery.assign");
        const supabase = getSupabaseAdmin();
        const { data: del, error: delErr } = await supabase
          .from("deliveries")
          .select("*")
          .eq("id", input.deliveryId)
          .limit(1)
          .maybeSingle();
        if (delErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: delErr.message,
          });
        if (!del)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Delivery not found.",
          });
        await assertOutletAccess(ctx.user, (del as any).outletId);

        // Validate the replacement rider before mutating anything.
        const { data: rider, error: riderErr } = await supabase
          .from("riders")
          .select("id,status")
          .eq("id", input.riderId)
          .limit(1)
          .maybeSingle();
        if (riderErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: riderErr.message,
          });
        if (!rider)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Rider not found.",
          });
        if (
          (rider as any).status === "suspended" ||
          (rider as any).status === "offline"
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Rider is not available.",
          });

        try {
          const sql = await getSql();
          await sql.begin(async (tx: any) => {
            if ((del as any).riderId) {
              await tx.unsafe(
                `UPDATE "riders" SET "status" = 'available' WHERE "id" = $1`,
                [(del as any).riderId]
              );
            }
            await tx.unsafe(
              `UPDATE "deliveries" SET "riderId" = $1, "status" = 'rider_assigned', "assignedAt" = $2 WHERE "id" = $3`,
              [input.riderId, new Date().toISOString(), input.deliveryId]
            );
            await tx.unsafe(
              `UPDATE "riders" SET "status" = 'busy' WHERE "id" = $1`,
              [input.riderId]
            );
          });
        } catch {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "The rider could not be reassigned. Please try again.",
          });
        }

        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "delivery",
          entityId: input.deliveryId,
          outletId: (del as any).outletId,
          action: "rider_reassigned",
          before: { riderId: (del as any).riderId ?? null },
          after: { riderId: input.riderId } as any,
        });

        return { success: true };
      }),

    updateStatus: protectedProcedure
      .input(
        z.object({
          deliveryId: z.number().int().positive(),
          status: z.enum([
            "preparing",
            "ready",
            "rider_assigned",
            "picked_up",
            "out_for_delivery",
            "delivered",
            "failed",
            "cancelled",
          ]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "delivery.assign");
        const supabase = getSupabaseAdmin();
        const { data: del, error: delErr } = await supabase
          .from("deliveries")
          .select("*")
          .eq("id", input.deliveryId)
          .limit(1)
          .maybeSingle();
        if (delErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: delErr.message,
          });
        if (!del)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Delivery not found.",
          });
        await assertOutletAccess(ctx.user, (del as any).outletId ?? null);

        const patch: any = { status: input.status };
        if (input.status === "picked_up")
          patch.pickedAt = new Date().toISOString();
        if (input.status === "delivered") {
          patch.deliveredAt = new Date().toISOString();
          if ((del as any).riderId) {
            // atomic increment via getSql, fallback to supabase read-modify-write
            try {
              const sql = await getSql();
              await sql.unsafe(
                `UPDATE "riders" SET "status" = 'available', "totalDeliveries" = "totalDeliveries" + 1 WHERE "id" = $1`,
                [(del as any).riderId]
              );
            } catch {
              try {
                const { data: rider } = await supabase
                  .from("riders")
                  .select("totalDeliveries")
                  .eq("id", (del as any).riderId)
                  .limit(1)
                  .maybeSingle();
                const next = Number((rider as any)?.totalDeliveries ?? 0) + 1;
                await supabase
                  .from("riders")
                  .update({ status: "available", totalDeliveries: next } as any)
                  .eq("id", (del as any).riderId);
              } catch {}
            }
          }
        }

        const { error } = await supabase
          .from("deliveries")
          .update(patch)
          .eq("id", input.deliveryId);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });

        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "delivery",
          entityId: input.deliveryId,
          outletId: (del as any).outletId,
          action: "status_changed",
          after: { status: input.status } as any,
        });
        return { success: true };
      }),

    cancel: protectedProcedure
      .input(
        z.object({
          deliveryId: z.number().int().positive(),
          reason: z.string().trim().min(3).max(240),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "delivery.assign");
        const supabase = getSupabaseAdmin();
        const { data: del, error: delErr } = await supabase
          .from("deliveries")
          .select("*")
          .eq("id", input.deliveryId)
          .limit(1)
          .maybeSingle();
        if (delErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: delErr.message,
          });
        if (!del)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Delivery not found.",
          });
        await assertOutletAccess(ctx.user, (del as any).outletId ?? null);
        if (["delivered", "cancelled", "failed"].includes((del as any).status))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Delivery already closed.",
          });

        try {
          const sql = await getSql();
          await sql.begin(async (tx: any) => {
            await tx.unsafe(
              `UPDATE "deliveries" SET "status" = 'cancelled' WHERE "id" = $1`,
              [input.deliveryId]
            );
            if ((del as any).riderId) {
              await tx.unsafe(
                `UPDATE "riders" SET "status" = 'available' WHERE "id" = $1`,
                [(del as any).riderId]
              );
            }
          });
        } catch {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "The delivery could not be cancelled. Please try again.",
          });
        }
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "delivery",
          entityId: input.deliveryId,
          outletId: (del as any).outletId ?? null,
          action: "cancelled",
          after: { status: "cancelled", reason: input.reason },
        });
        return { success: true };
      }),
  }),

  performance: protectedProcedure
    .input(
      z
        .object({
          outletId: z.number().int().positive().optional(),
          from: z.date().optional(),
          to: z.date().optional(),
        })
        .nullish()
    )
    .query(async ({ ctx, input }) => {
      await need(ctx.user, "delivery.read");
      const supabase = getSupabaseAdmin();
      const scope = await getOutletScope(ctx.user);
      if (input?.outletId) await assertOutletAccess(ctx.user, input.outletId);
      if (scope !== null && scope.length === 0)
        return {
          total: 0,
          delivered: 0,
          failed: 0,
          deliveryRate: 0,
          avgMinutes: 0,
        };

      let query: any = supabase.from("deliveries").select("*").limit(500);
      if (input?.outletId) query = query.eq("outletId", input.outletId);
      else if (scope !== null && scope.length) {
        if (scope.length === 1) query = query.eq("outletId", scope[0]);
        else query = query.in("outletId", scope);
      }
      // from/to are accepted for API compatibility; filter by createdAt when provided
      if (input?.from) query = query.gte("createdAt", input.from.toISOString());
      if (input?.to) query = query.lte("createdAt", input.to.toISOString());

      const { data, error } = await query;
      if (error)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      const rows = (data ?? []) as any[];
      const total = rows.length;
      const delivered = rows.filter(r => r.status === "delivered").length;
      const failed = rows.filter(r => r.status === "failed").length;
      const avgMinutes = (() => {
        const ds = rows
          .filter(r => r.deliveredAt && r.assignedAt)
          .map(
            r =>
              (new Date(r.deliveredAt!).getTime() -
                new Date(r.assignedAt!).getTime()) /
              60000
          );
        return ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : 0;
      })();
      return {
        total,
        delivered,
        failed,
        deliveryRate: total ? (delivered / total) * 100 : 0,
        avgMinutes,
      };
    }),
});
