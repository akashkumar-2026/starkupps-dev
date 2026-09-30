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

async function need(user: any, perm: any) {
  const r = await resolveStaffRole(user);
  if (!r || !hasPermission(r, perm))
    throw new TRPCError({ code: "FORBIDDEN", message: "Access denied." });
  return r;
}

export const financeRouter = router({
  revenue: protectedProcedure
    .input(
      z
        .object({
          outletId: z.number().int().positive().optional(),
          from: z.date().optional(),
          to: z.date().optional(),
          paymentMethod: z.string().optional(),
        })
        .nullish()
    )
    .query(async ({ ctx, input }) => {
      await need(ctx.user, "finance.read");
      const supabase = getSupabaseAdmin();
      const scope = await getOutletScope(ctx.user);
      if (scope !== null && scope.length === 0) {
        return {
          gross: 0,
          discounts: 0,
          taxes: 0,
          refunds: 0,
          net: 0,
          totalOrders: 0,
          paidOrders: 0,
          daily: [],
        };
      }
      if (input?.outletId) await assertOutletAccess(ctx.user, input.outletId);

      // Aggregate in SQL instead of loading up to 5,000 orders into memory.
      const conditions: string[] = [`"status" <> 'cancelled'`];
      const params: any[] = [];
      let idx = 1;
      if (input?.from) {
        conditions.push(`"createdAt" >= $${idx++}`);
        params.push(input.from.toISOString());
      }
      if (input?.to) {
        conditions.push(`"createdAt" <= $${idx++}`);
        params.push(input.to.toISOString());
      }
      if (input?.outletId) {
        conditions.push(`"outletId" = $${idx++}`);
        params.push(input.outletId);
      } else if (scope !== null && scope.length) {
        if (scope.length === 1) {
          conditions.push(`"outletId" = $${idx++}`);
          params.push(scope[0]);
        } else {
          conditions.push(`"outletId" = ANY($${idx++})`);
          params.push(scope);
        }
      }
      const where = `WHERE ${conditions.join(" AND ")}`;
      const sql = await getSql();
      const summary = (await sql.unsafe(
        `
        SELECT
          COALESCE(sum(CASE WHEN "paymentStatus" = 'paid' THEN "total" ELSE 0 END), 0) AS "gross",
          count(*)::int AS "totalOrders",
          count(*) FILTER (WHERE "paymentStatus" = 'paid')::int AS "paidOrders"
        FROM "orders" ${where}
      `,
        params
      )) as any[];
      const gross = Number(summary[0]?.gross ?? 0);
      const totalOrders = Number(summary[0]?.totalOrders ?? 0);
      const paidOrders = Number(summary[0]?.paidOrders ?? 0);
      const discounts = 0;

      const dailyRows = (await sql.unsafe(
        `
        SELECT to_char("createdAt"::date, 'YYYY-MM-DD') AS "date", sum("total") AS "revenue"
        FROM "orders" ${where} AND "paymentStatus" = 'paid'
        GROUP BY 1 ORDER BY 1
      `,
        params
      )) as any[];
      const daily = dailyRows.map(r => ({
        date: r.date as string,
        revenue: Number(r.revenue ?? 0),
      }));

      let taxRate = 0;
      try {
        const { data: taxRows, error: taxErr } = await supabase
          .from("taxes")
          .select("rate")
          .eq("enabled", true)
          .limit(50);
        if (taxErr) throw taxErr;
        taxRate = (taxRows ?? []).reduce(
          (s: number, r: any) => s + Number(r.rate),
          0
        );
      } catch {
        taxRate = 0;
      }
      const taxTotal = gross * (taxRate / 100);

      let refundTotal = 0;
      try {
        const { data: refundRows, error: refErr } = await supabase
          .from("refunds")
          .select("amount")
          .eq("status", "refunded")
          .limit(500);
        if (refErr) throw refErr;
        refundTotal = (refundRows ?? []).reduce(
          (s: number, r: any) => s + Number(r.amount),
          0
        );
      } catch {
        refundTotal = 0;
      }

      const net = gross - refundTotal;

      return {
        gross,
        discounts,
        taxes: taxTotal,
        refunds: refundTotal,
        net,
        totalOrders,
        paidOrders,
        daily,
      };
    }),

  transactions: protectedProcedure
    .input(
      z
        .object({
          outletId: z.number().int().positive().optional(),
          status: z
            .enum([
              "pending",
              "paid",
              "failed",
              "refunded",
              "partially_refunded",
            ])
            .optional(),
          method: z
            .enum(["cash", "card", "upi", "netbanking", "wallet", "other"])
            .optional(),
          limit: z.number().int().min(1).max(100).default(50),
          cursor: z.number().int().positive().optional(),
        })
        .nullish()
    )
    .query(async ({ ctx, input }) => {
      await need(ctx.user, "finance.read");
      const supabase = getSupabaseAdmin();
      const scope = await getOutletScope(ctx.user);
      if (input?.outletId) await assertOutletAccess(ctx.user, input.outletId);

      const limit = input?.limit ?? 50;

      // prefer payments table if exists, fallback to orders as transaction proxy
      try {
        let q: any = supabase
          .from("payments")
          .select("*")
          .order("id", { ascending: false })
          .limit(limit + 1);
        if (input?.cursor) q = q.lt("id", input.cursor);
        if (input?.status) q = q.eq("status", input.status);
        if (input?.method) q = q.eq("method", input.method);
        if (input?.outletId) q = q.eq("outletId", input.outletId);
        else if (scope !== null && scope.length) {
          if (scope.length === 1) q = q.eq("outletId", scope[0]);
          else q = q.in("outletId", scope);
        }
        const { data, error } = await q;
        if (error) throw error;
        const rows = (data ?? []) as any[];
        if (rows.length) {
          const page = rows.slice(0, limit);
          // enrich with outletName and orderNumber via batch fetch
          const outletIds = Array.from(
            new Set(page.map((r: any) => r.outletId).filter(Boolean))
          );
          const orderIds = Array.from(
            new Set(page.map((r: any) => r.orderId).filter(Boolean))
          );
          let outletMap = new Map<number, string>();
          let orderMap = new Map<number, string>();
          if (outletIds.length) {
            const { data: outs } = await supabase
              .from("outlets")
              .select("id,name")
              .in("id", outletIds as number[]);
            outletMap = new Map((outs ?? []).map((o: any) => [o.id, o.name]));
          }
          if (orderIds.length) {
            const { data: ords } = await supabase
              .from("orders")
              .select("id,orderNumber")
              .in("id", orderIds as number[]);
            orderMap = new Map(
              (ords ?? []).map((o: any) => [o.id, o.orderNumber])
            );
          }
          return {
            items: page.map((r: any) => ({
              ...r,
              outletName: outletMap.get(r.outletId) ?? null,
              orderNumber: orderMap.get(r.orderId) ?? null,
              amount: Number(r.amount),
            })),
            nextCursor: rows.length > limit ? page.at(-1)?.id : undefined,
          };
        }
      } catch {}

      // fallback: orders as transactions
      let q: any = supabase
        .from("orders")
        .select("id,outletId,orderNumber,total,paymentStatus,createdAt")
        .order("id", { ascending: false })
        .limit(limit + 1);
      if (input?.outletId) q = q.eq("outletId", input.outletId);
      else if (scope !== null && scope.length) {
        if (scope.length === 1) q = q.eq("outletId", scope[0]);
        else q = q.in("outletId", scope);
      }
      const { data: fallbackRows, error: fbErr } = await q;
      if (fbErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: fbErr.message,
        });
      const rows = (fallbackRows ?? []) as any[];
      const page = rows.slice(0, limit);
      return {
        items: page.map((o: any) => ({
          id: o.id,
          orderId: o.id,
          outletId: o.outletId,
          outletName: null,
          orderNumber: o.orderNumber,
          amount: Number(o.total),
          method: "cash" as const,
          status:
            o.paymentStatus === "paid"
              ? ("paid" as const)
              : o.paymentStatus === "refunded"
                ? ("refunded" as const)
                : ("pending" as const),
          createdAt: o.createdAt,
        })),
        nextCursor: rows.length > limit ? page.at(-1)?.id : undefined,
      };
    }),

  refunds: router({
    list: protectedProcedure
      .input(
        z
          .object({
            status: z
              .enum([
                "requested",
                "validated",
                "refunded",
                "failed",
                "cancelled",
              ])
              .optional(),
          })
          .nullish()
      )
      .query(async ({ ctx, input }) => {
        await need(ctx.user, "finance.read");
        const supabase = getSupabaseAdmin();
        const scope = await getOutletScope(ctx.user);
        let q: any = supabase
          .from("refunds")
          .select("*")
          .order("createdAt", { ascending: false })
          .limit(100);
        if (input?.status) q = q.eq("status", input.status);
        const { data, error } = await q;
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        const rows = (data ?? []) as any[];
        if (!rows.length) return [];
        const orderIds = Array.from(
          new Set(rows.map((r: any) => r.orderId).filter(Boolean))
        );
        let orderMap = new Map<
          number,
          { orderNumber: string; outletId: number | null }
        >();
        let outletMap = new Map<number, string>();
        if (orderIds.length) {
          const { data: ords } = await supabase
            .from("orders")
            .select("id,orderNumber,outletId")
            .in("id", orderIds as number[]);
          orderMap = new Map(
            (ords ?? []).map((o: any) => [
              o.id,
              { orderNumber: o.orderNumber, outletId: o.outletId },
            ])
          );
          const outletIds = Array.from(
            new Set((ords ?? []).map((o: any) => o.outletId).filter(Boolean))
          );
          if (outletIds.length) {
            const { data: outs } = await supabase
              .from("outlets")
              .select("id,name")
              .in("id", outletIds as number[]);
            outletMap = new Map((outs ?? []).map((o: any) => [o.id, o.name]));
          }
        }
        return rows
          .map((r: any) => {
            const ord = orderMap.get(r.orderId);
            return {
              ...r,
              outletId: ord?.outletId ?? null,
              outletName: ord?.outletId
                ? (outletMap.get(ord.outletId) ?? null)
                : null,
              orderNumber: ord?.orderNumber ?? null,
              amount: Number(r.amount),
            };
          })
          .filter((r: any) => {
            // Scoped callers only see refunds for orders in their outlets.
            if (scope === null || scope === undefined) return true;
            return (
              r.outletId !== null && (scope as number[]).includes(r.outletId)
            );
          });
      }),
    create: protectedProcedure
      .input(
        z.object({
          orderId: z.number().int().positive(),
          amount: z.number().positive().max(1000000),
          reason: z.string().trim().min(3).max(500),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "finance.refund");
        const supabase = getSupabaseAdmin();

        const { data: order, error: ordErr } = await supabase
          .from("orders")
          .select("id,total,paymentStatus,outletId")
          .eq("id", input.orderId)
          .limit(1)
          .maybeSingle();
        if (ordErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: ordErr.message,
          });
        if (!order)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Order not found.",
          });
        await assertOutletAccess(ctx.user, (order as any).outletId ?? null);
        if ((order as any).paymentStatus !== "paid")
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Only paid orders can be refunded.",
          });
        if (Number((order as any).total) < input.amount)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Refund exceeds order total.",
          });

        // idempotency: check existing requested for same order
        try {
          const { data: existing, error: exErr } = await supabase
            .from("refunds")
            .select("id")
            .eq("orderId", input.orderId)
            .eq("status", "requested")
            .limit(1);
          if (exErr) throw exErr;
          if (existing && existing.length)
            throw new TRPCError({
              code: "CONFLICT",
              message: "A refund is already requested for this order.",
            });
        } catch (e) {
          if (e instanceof TRPCError) throw e;
        }

        // create payment stub if not exists
        let paymentId: number | null = null;
        try {
          const { data: pay, error: payErr } = await supabase
            .from("payments")
            .select("id")
            .eq("orderId", input.orderId)
            .limit(1)
            .maybeSingle();
          if (payErr) throw payErr;
          if (pay && (pay as any).id) paymentId = Number((pay as any).id);
          else {
            const { data: inserted, error: insPayErr } = await supabase
              .from("payments")
              .insert({
                orderId: input.orderId,
                outletId: (order as any).outletId,
                amount: (order as any).total as any,
                method: "cash",
                status: "paid",
              } as any)
              .select("id")
              .single();
            if (insPayErr) throw insPayErr;
            paymentId = Number((inserted as any).id);
          }
        } catch {}

        const { data: res, error: insErr } = await supabase
          .from("refunds")
          .insert({
            orderId: input.orderId,
            paymentId,
            amount: input.amount.toFixed(2) as any,
            reason: input.reason,
            status: "requested",
            createdBy: ctx.user.id,
          } as any)
          .select("id")
          .single();
        if (insErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: insErr.message,
          });
        const id = Number((res as any).id);
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "refund",
          entityId: id,
          outletId: (order as any).outletId ?? null,
          action: "requested",
          after: input as any,
        });
        return { id, status: "requested" };
      }),
    updateStatus: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          status: z.enum(["validated", "refunded", "failed", "cancelled"]),
          providerRefundId: z.string().trim().max(160).nullable(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "finance.refund");
        const supabase = getSupabaseAdmin();
        const { data: cur, error: curErr } = await supabase
          .from("refunds")
          .select("id,status,orderId,paymentId")
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
            message: "Refund not found.",
          });
        {
          const { data: ord } = await supabase
            .from("orders")
            .select("outletId")
            .eq("id", (cur as any).orderId)
            .limit(1)
            .maybeSingle();
          await assertOutletAccess(ctx.user, (ord as any)?.outletId ?? null);
        }
        if (
          (cur as any).status === "refunded" ||
          (cur as any).status === "cancelled"
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Refund already closed.",
          });

        const sql = await getSql();
        try {
          await sql.begin(async (tx: any) => {
            await tx.unsafe(
              `UPDATE "refunds" SET "status" = $1, "providerRefundId" = $2 WHERE "id" = $3`,
              [input.status, input.providerRefundId, input.id]
            );
            if (input.status === "refunded") {
              if ((cur as any).paymentId) {
                await tx.unsafe(
                  `UPDATE "payments" SET "status" = 'refunded' WHERE "id" = $1`,
                  [(cur as any).paymentId]
                );
              }
              await tx.unsafe(
                `UPDATE "orders" SET "paymentStatus" = 'refunded' WHERE "id" = $1`,
                [(cur as any).orderId]
              );
            }
          });
        } catch {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "The refund could not be updated. Please try again.",
          });
        }

        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "refund",
          entityId: input.id,
          action: input.status,
          before: { status: (cur as any).status },
          after: { status: input.status },
        });
        return { success: true };
      }),
  }),

  expenses: router({
    list: protectedProcedure
      .input(
        z
          .object({
            outletId: z.number().int().positive().optional(),
            category: z
              .enum([
                "ingredients",
                "rent",
                "electricity",
                "internet",
                "maintenance",
                "marketing",
                "salaries",
                "packaging",
                "delivery",
                "other",
              ])
              .optional(),
            from: z.date().optional(),
            to: z.date().optional(),
          })
          .nullish()
      )
      .query(async ({ ctx, input }) => {
        await need(ctx.user, "finance.read");
        const supabase = getSupabaseAdmin();
        const scope = await getOutletScope(ctx.user);
        if (input?.outletId) await assertOutletAccess(ctx.user, input.outletId);

        let q: any = supabase
          .from("expenses")
          .select("*")
          .order("date", { ascending: false })
          .limit(100);
        if (input?.outletId) q = q.eq("outletId", input.outletId);
        else if (scope !== null && scope.length) {
          if (scope.length === 1) q = q.eq("outletId", scope[0]);
          else q = q.in("outletId", scope);
        }
        if (input?.category) q = q.eq("category", input.category);
        if (input?.from)
          q = q.gte("date", input.from.toISOString().slice(0, 10));
        if (input?.to) q = q.lte("date", input.to.toISOString().slice(0, 10));
        const { data, error } = await q;
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        const rows = (data ?? []) as any[];
        if (!rows.length) return [];
        const outletIds = Array.from(
          new Set(rows.map(r => r.outletId).filter(Boolean))
        );
        let outletMap = new Map<number, string>();
        if (outletIds.length) {
          const { data: outs } = await supabase
            .from("outlets")
            .select("id,name")
            .in("id", outletIds as number[]);
          outletMap = new Map((outs ?? []).map((o: any) => [o.id, o.name]));
        }
        return rows.map((r: any) => ({
          ...r,
          outletName: r.outletId ? (outletMap.get(r.outletId) ?? null) : null,
          amount: Number(r.amount),
        }));
      }),
    create: protectedProcedure
      .input(
        z.object({
          outletId: z.number().int().positive().nullable(),
          category: z.enum([
            "ingredients",
            "rent",
            "electricity",
            "internet",
            "maintenance",
            "marketing",
            "salaries",
            "packaging",
            "delivery",
            "other",
          ]),
          amount: z.number().positive().max(10000000),
          vendor: z.string().trim().max(160).nullable(),
          date: z.string().date(),
          description: z.string().trim().max(2000).nullable(),
          attachmentUrl: z.string().trim().max(2000).nullable(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "finance.expenses");
        if (input.outletId) await assertOutletAccess(ctx.user, input.outletId);
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
          .from("expenses")
          .insert({
            ...input,
            amount: input.amount.toFixed(2) as any,
            date: input.date as any,
            createdBy: ctx.user.id,
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
          entityType: "expense",
          entityId: id,
          outletId: input.outletId ?? null,
          action: "created",
          after: input as any,
        });
        return { id };
      }),
    remove: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "finance.expenses");
        const supabase = getSupabaseAdmin();
        const { data: cur, error: curErr } = await supabase
          .from("expenses")
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
            message: "Expense not found.",
          });
        await assertOutletAccess(ctx.user, (cur as any).outletId ?? null);
        const { error } = await supabase
          .from("expenses")
          .delete()
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "expense",
          entityId: input.id,
          outletId: (cur as any).outletId ?? null,
          action: "deleted",
        });
        return { success: true };
      }),
  }),

  taxes: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      await need(ctx.user, "finance.read");
      const supabase = getSupabaseAdmin();
      const scope = await getOutletScope(ctx.user);
      const { data, error } = await supabase
        .from("taxes")
        .select("*")
        .order("name", { ascending: true });
      if (error)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      let rows = (data ?? []) as any[];
      if (scope !== null && scope.length)
        rows = rows.filter(
          (r: any) => r.outletId && scope.includes(r.outletId)
        );
      if (!rows.length) return [];
      const outletIds = Array.from(
        new Set(rows.map(r => r.outletId).filter(Boolean))
      );
      let outletMap = new Map<number, string>();
      if (outletIds.length) {
        const { data: outs } = await supabase
          .from("outlets")
          .select("id,name")
          .in("id", outletIds as number[]);
        outletMap = new Map((outs ?? []).map((o: any) => [o.id, o.name]));
      }
      return rows.map((r: any) => ({
        ...r,
        outletName: r.outletId ? (outletMap.get(r.outletId) ?? null) : null,
        rate: Number(r.rate),
      }));
    }),
    create: protectedProcedure
      .input(
        z.object({
          name: z.string().trim().min(2).max(100),
          type: z.enum([
            "gst",
            "service_charge",
            "packaging_charge",
            "delivery_charge",
            "other",
          ]),
          rate: z.number().min(0).max(100),
          enabled: z.boolean().default(true),
          outletId: z.number().int().positive().nullable(),
          applicability: z.record(z.string(), z.unknown()).nullable(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "finance.taxes");
        if (input.outletId) await assertOutletAccess(ctx.user, input.outletId);
        else {
          const scope = await getOutletScope(ctx.user);
          if (scope !== null)
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Global taxes require access to all outlets.",
            });
        }
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
          .from("taxes")
          .insert({
            name: input.name,
            type: input.type,
            rate: input.rate.toFixed(3) as any,
            enabled: input.enabled,
            outletId: input.outletId,
            applicability: input.applicability as any,
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
          entityType: "tax",
          entityId: id,
          outletId: input.outletId ?? null,
          action: "created",
          after: {
            name: input.name,
            type: input.type,
            rate: input.rate,
            enabled: input.enabled,
          },
        });
        return { id };
      }),
    update: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          rate: z.number().min(0).max(100),
          enabled: z.boolean(),
          name: z.string().trim().min(2).max(100),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "finance.taxes");
        const supabase = getSupabaseAdmin();
        const { data: cur, error: curErr } = await supabase
          .from("taxes")
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
          throw new TRPCError({ code: "NOT_FOUND", message: "Tax not found." });
        if ((cur as any).outletId)
          await assertOutletAccess(ctx.user, (cur as any).outletId);
        else {
          const scope = await getOutletScope(ctx.user);
          if (scope !== null)
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Global taxes require access to all outlets.",
            });
        }
        const { error } = await supabase
          .from("taxes")
          .update({
            rate: input.rate.toFixed(3) as any,
            enabled: input.enabled,
            name: input.name,
          } as any)
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "tax",
          entityId: input.id,
          outletId: (cur as any).outletId ?? null,
          action: "updated",
          after: { name: input.name, rate: input.rate, enabled: input.enabled },
        });
        return { success: true };
      }),
    remove: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "finance.taxes");
        const supabase = getSupabaseAdmin();
        const { data: cur, error: curErr } = await supabase
          .from("taxes")
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
          throw new TRPCError({ code: "NOT_FOUND", message: "Tax not found." });
        if ((cur as any).outletId)
          await assertOutletAccess(ctx.user, (cur as any).outletId);
        else {
          const scope = await getOutletScope(ctx.user);
          if (scope !== null)
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Global taxes require access to all outlets.",
            });
        }
        const { error } = await supabase
          .from("taxes")
          .delete()
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "tax",
          entityId: input.id,
          outletId: (cur as any).outletId ?? null,
          action: "deleted",
        });
        return { success: true };
      }),
  }),

  payouts: router({
    list: protectedProcedure
      .input(
        z.object({ outletId: z.number().int().positive().optional() }).nullish()
      )
      .query(async ({ ctx, input }) => {
        await need(ctx.user, "finance.read");
        const supabase = getSupabaseAdmin();
        const scope = await getOutletScope(ctx.user);
        if (input?.outletId) await assertOutletAccess(ctx.user, input.outletId);
        try {
          let q: any = supabase
            .from("payouts")
            .select("*")
            .order("createdAt", { ascending: false })
            .limit(50);
          if (input?.outletId) q = q.eq("outletId", input.outletId);
          else if (scope !== null && scope.length) q = q.in("outletId", scope);
          const { data, error } = await q;
          if (error) throw error;
          return (data ?? []) as any[];
        } catch {
          return [];
        }
      }),
  }),
});
