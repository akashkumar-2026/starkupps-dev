import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  assertOutletAccess,
  getOutletScope,
  hasPermission,
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

export const customersRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          search: z.string().trim().max(160).optional(),
          outletId: z.number().int().positive().optional(),
          limit: z.number().int().min(1).max(100).default(25),
          cursor: z.string().optional(),
          sortBy: z
            .enum(["createdAt", "totalSpend", "totalOrders", "lastOrder"])
            .default("createdAt"),
          direction: z.enum(["asc", "desc"]).default("desc"),
        })
        .nullish()
    )
    .query(async ({ ctx, input }) => {
      await need(ctx.user, "customers.read");
      const limit = input?.limit ?? 25;
      if (input?.outletId) await assertOutletAccess(ctx.user, input.outletId);
      const scope = await getOutletScope(ctx.user);
      if (scope !== null && scope.length === 0 && !input?.outletId)
        return { items: [], nextCursor: undefined };

      const outletScope: number[] | null = input?.outletId
        ? [input.outletId]
        : scope !== null && scope.length
          ? scope
          : null;
      const direction = input?.direction ?? "desc";
      const dirSql = direction === "asc" ? "ASC" : "DESC";
      const cmp = direction === "asc" ? ">" : "<";
      const sortBy = input?.sortBy ?? "createdAt";
      const sortExpr =
        sortBy === "totalSpend"
          ? `COALESCE(a."total", 0)`
          : sortBy === "totalOrders"
            ? `COALESCE(a."cnt", 0)`
            : sortBy === "lastOrder"
              ? `COALESCE(EXTRACT(EPOCH FROM a."last"), 0)`
              : null;

      // Opaque keyset cursor: { id } for createdAt, { id, k } for computed sorts.
      let cur: { id?: number; k?: number } | null = null;
      if (input?.cursor) {
        try {
          cur = JSON.parse(
            Buffer.from(input.cursor, "base64").toString("utf8")
          );
        } catch {
          cur = null;
        }
      }

      const sql = await getSql();
      const params: any[] = [];
      let idx = 1;

      // Outlet scope parameter is shared by the aggregate CTE and the customer filter.
      const outletParam = outletScope ? `$${idx++}` : "";
      if (outletScope) params.push(outletScope);

      const cConditions: string[] = [];
      if (cur && typeof cur.id === "number") {
        if (sortExpr && typeof cur.k === "number") {
          cConditions.push(
            `(${sortExpr} ${cmp} $${idx} OR (${sortExpr} = $${idx} AND c."id" ${cmp} $${idx + 1}))`
          );
          params.push(cur.k, cur.id);
          idx += 2;
        } else {
          cConditions.push(`c."id" ${cmp} $${idx++}`);
          params.push(cur.id);
        }
      }
      if (input?.search) {
        cConditions.push(
          `(c."name" ILIKE $${idx} OR c."phone" ILIKE $${idx} OR c."email" ILIKE $${idx})`
        );
        params.push(`%${input.search}%`);
        idx++;
      }
      if (outletScope) {
        cConditions.push(
          `EXISTS (SELECT 1 FROM "orders" o2 WHERE o2."customerId" = c."id" AND o2."outletId" = ${outletParam})`
        );
      }
      const cWhere = cConditions.length
        ? `WHERE ${cConditions.join(" AND ")}`
        : "";
      const orderBy = sortExpr
        ? `${sortExpr} ${dirSql}, c."id" ${dirSql}`
        : `c."id" ${dirSql}`;
      const limitParam = `$${idx++}`;
      params.push(limit + 1);

      const rows = (await sql.unsafe(
        `
        WITH agg AS (
          SELECT "customerId", count(*)::int AS "cnt", COALESCE(sum("total"), 0) AS "total", max("createdAt") AS "last"
          FROM "orders"
          WHERE "status" <> 'cancelled' AND "customerId" IS NOT NULL ${outletScope ? `AND "outletId" = ${outletParam}` : ""}
          GROUP BY "customerId"
        ),
        pts AS (
          SELECT "customerId", sum("pointsChange") AS "points"
          FROM "loyalty_transactions"
          GROUP BY "customerId"
        )
        SELECT c.*,
          COALESCE(a."cnt", 0) AS "totalOrders",
          COALESCE(a."total", 0) AS "totalSpend",
          a."last" AS "lastOrderAt",
          COALESCE(p."points", 0) AS "loyaltyPoints"
        FROM "customers" c
        LEFT JOIN agg a ON a."customerId" = c."id"
        LEFT JOIN pts p ON p."customerId" = c."id"
        ${cWhere}
        ORDER BY ${orderBy}
        LIMIT ${limitParam}
      `,
        params
      )) as any[];

      const page = rows.slice(0, limit);
      if (!page.length) return { items: [], nextCursor: undefined };

      const items = page.map((c: any) => ({
        ...c,
        totalOrders: Number(c.totalOrders ?? 0),
        totalSpend: Number(c.totalSpend ?? 0),
        lastOrderAt: c.lastOrderAt ?? null,
        loyaltyPoints: Number(c.loyaltyPoints ?? 0),
        averageOrderValue: Number(c.totalOrders ?? 0)
          ? Number(c.totalSpend ?? 0) / Number(c.totalOrders)
          : 0,
      }));

      let nextCursor: string | undefined;
      if (rows.length > limit) {
        const last = items[items.length - 1] as any;
        const payload: { id: number; k?: number } = { id: last.id };
        if (sortBy === "totalSpend") payload.k = Number(last.totalSpend);
        else if (sortBy === "totalOrders") payload.k = Number(last.totalOrders);
        else if (sortBy === "lastOrder")
          payload.k = last.lastOrderAt
            ? Math.floor(new Date(last.lastOrderAt).getTime() / 1000)
            : 0;
        nextCursor = Buffer.from(JSON.stringify(payload)).toString("base64");
      }
      return { items, nextCursor };
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await need(ctx.user, "customers.read");
      const supabase = getSupabaseAdmin();

      const { data: cust, error: cErr } = await supabase
        .from("customers")
        .select("*")
        .eq("id", input.id)
        .limit(1)
        .maybeSingle();
      if (cErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: cErr.message,
        });
      if (!cust)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Customer not found.",
        });

      const { data: orderRows, error: oErr } = await supabase
        .from("orders")
        .select("*")
        .eq("customerId", input.id)
        .order("createdAt", { ascending: false })
        .limit(50);
      if (oErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: oErr.message,
        });

      // Scoped callers may only view customers with at least one order in scope.
      {
        const scope = await getOutletScope(ctx.user);
        if (scope !== null) {
          const inScope = ((orderRows ?? []) as any[]).some(
            (o: any) => o.outletId && scope.includes(o.outletId)
          );
          if (!inScope)
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You do not have access to this customer.",
            });
        }
      }

      const outletIds = Array.from(
        new Set(
          ((orderRows ?? []) as any[])
            .map((r: any) => r.outletId)
            .filter(Boolean)
        )
      ) as number[];
      const outletMap = new Map<number, string>();
      if (outletIds.length) {
        const { data: outletRows } = await supabase
          .from("outlets")
          .select("id,name")
          .in("id", outletIds);
        for (const o of (outletRows ?? []) as any[])
          outletMap.set(o.id, o.name);
      }
      const custOrders = ((orderRows ?? []) as any[]).map((o: any) => ({
        order: o,
        outletName: o.outletId ? (outletMap.get(o.outletId) ?? null) : null,
      }));

      const { data: txs, error: tErr } = await supabase
        .from("loyalty_transactions")
        .select("*")
        .eq("customerId", input.id)
        .order("createdAt", { ascending: false })
        .limit(50);
      if (tErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: tErr.message,
        });

      let items: any[] = [];
      try {
        const sql = await getSql();
        const rows = await sql.unsafe(
          `SELECT "itemName","quantity","orderId" FROM "order_items" INNER JOIN "orders" ON "order_items"."orderId" = "orders"."id" WHERE "orders"."customerId" = $1 LIMIT 200`,
          [input.id]
        );
        items = rows as any[];
      } catch {
        try {
          const { data: custOrderIds } = await supabase
            .from("orders")
            .select("id")
            .eq("customerId", input.id)
            .limit(500);
          const ids = ((custOrderIds ?? []) as any[]).map((r: any) => r.id);
          if (ids.length) {
            const all: any[] = [];
            for (let i = 0; i < ids.length; i += 100) {
              const chunk = ids.slice(i, i + 100);
              const { data } = await supabase
                .from("order_items")
                .select("itemName,quantity,orderId")
                .in("orderId", chunk)
                .limit(200);
              all.push(...((data ?? []) as any[]));
              if (all.length >= 200) break;
            }
            items = all.slice(0, 200);
          }
        } catch {
          items = [];
        }
      }

      let feedbacks: any[] = [];
      try {
        const { data: fb, error: fbErr } = await supabase
          .from("customer_feedback")
          .select("*")
          .eq("customerId", input.id)
          .order("createdAt", { ascending: false })
          .limit(20);
        if (fbErr) throw fbErr;
        feedbacks = (fb ?? []) as any[];
      } catch {
        feedbacks = [];
      }

      const totalSpend = custOrders
        .filter(
          r =>
            r.order.status !== "cancelled" && r.order.paymentStatus === "paid"
        )
        .reduce((s, r) => s + Number(r.order.total), 0);
      const totalOrders = custOrders.filter(
        r => r.order.status !== "cancelled"
      ).length;
      const avg = totalOrders ? totalSpend / totalOrders : 0;
      const firstOrder = custOrders.at(-1)?.order.createdAt ?? null;
      const lastOrder = custOrders[0]?.order.createdAt ?? null;
      const points = (txs ?? []).reduce(
        (s: number, r: any) => s + Number(r.pointsChange ?? 0),
        0
      );

      const freq = new Map<string, number>();
      for (const it of items)
        freq.set(
          it.itemName,
          (freq.get(it.itemName) ?? 0) + Number(it.quantity ?? 0)
        );
      const favoriteProducts = Array.from(freq.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, qty]) => ({ name, qty }));

      const outletUsage = new Map<string, number>();
      for (const o of custOrders)
        outletUsage.set(
          o.outletName ?? "Direct",
          (outletUsage.get(o.outletName ?? "Direct") ?? 0) + 1
        );

      return {
        customer: cust,
        metrics: {
          totalOrders,
          totalSpend,
          averageOrderValue: avg,
          firstOrder,
          lastOrder,
          loyaltyPoints: points,
          favoriteProducts,
          outletUsage: Array.from(outletUsage.entries()).map(
            ([name, count]) => ({ name, count })
          ),
        },
        orders: custOrders.map(r => ({
          ...r.order,
          outletName: r.outletName,
          total: Number(r.order.total),
        })),
        transactions: txs ?? [],
        feedbacks,
      };
    }),

  segments: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      await need(ctx.user, "customers.read");
      const supabase = getSupabaseAdmin();
      const scope = await getOutletScope(ctx.user);

      const { data: segs, error: sErr } = await supabase
        .from("customer_segments")
        .select("*")
        .order("name", { ascending: true });
      if (sErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: sErr.message,
        });
      if (scope !== null && scope.length === 0)
        return ((segs ?? []) as any[]).map(seg => ({
          ...seg,
          customerCount: 0,
        }));

      // Per-customer aggregates in one query instead of loading every customer,
      // order and loyalty row and looping in JS (previous O(segments × customers × orders)).
      // Outlet-scoped callers only aggregate orders from their outlets.
      const sql = await getSql();
      const outletFilter = scope !== null ? `AND "outletId" = ANY($1)` : "";
      const params: any[] = scope !== null ? [scope] : [];
      const aggRows = (await sql.unsafe(
        `
        SELECT c."id" AS "id",
          COALESCE(o."orderCount", 0) AS "orderCount",
          COALESCE(o."spend", 0) AS "spend",
          o."lastOrderAt" AS "lastOrderAt",
          COALESCE(l."points", 0) AS "points"
        FROM "customers" c
        LEFT JOIN (
          SELECT "customerId",
            count(*)::int AS "orderCount",
            sum(CASE WHEN "paymentStatus" = 'paid' THEN "total" ELSE 0 END) AS "spend",
            max("createdAt") AS "lastOrderAt"
          FROM "orders"
          WHERE "status" <> 'cancelled' ${outletFilter}
          GROUP BY "customerId"
        ) o ON o."customerId" = c."id"
        LEFT JOIN (
          SELECT "customerId", sum("pointsChange") AS "points"
          FROM "loyalty_transactions"
          GROUP BY "customerId"
        ) l ON l."customerId" = c."id"
      `,
        params
      )) as any[];

      const aggregates = aggRows.map(r => ({
        orderCount: Number(r.orderCount ?? 0),
        spend: Number(r.spend ?? 0),
        daysSince: r.lastOrderAt
          ? (Date.now() - new Date(r.lastOrderAt).getTime()) / 86400000
          : 9999,
        points: Number(r.points ?? 0),
      }));

      const withCount = ((segs ?? []) as any[]).map((seg: any) => {
        const rules: any = seg.rules ?? {};
        let count = 0;
        for (const a of aggregates) {
          if (rules.minOrders && a.orderCount < rules.minOrders) continue;
          if (rules.maxOrders && a.orderCount > rules.maxOrders) continue;
          if (rules.minSpend && a.spend < rules.minSpend) continue;
          if (rules.inactiveDays && a.daysSince < rules.inactiveDays) continue;
          if (rules.minPoints && a.points < rules.minPoints) continue;
          count++;
        }
        return { ...seg, customerCount: count };
      });

      return withCount;
    }),
    create: protectedProcedure
      .input(
        z.object({
          name: z.string().trim().min(2).max(120),
          slug: z
            .string()
            .trim()
            .min(2)
            .max(80)
            .regex(/^[a-z0-9-]+$/),
          description: z.string().trim().max(500).nullable(),
          rules: z.record(z.string(), z.unknown()).nullable(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "customers.update");
        const supabase = getSupabaseAdmin();

        const [{ data: dupSlug }, { data: dupName }] = await Promise.all([
          supabase
            .from("customer_segments")
            .select("id")
            .eq("slug", input.slug)
            .limit(1)
            .maybeSingle(),
          supabase
            .from("customer_segments")
            .select("id")
            .eq("name", input.name)
            .limit(1)
            .maybeSingle(),
        ]);
        if (dupSlug || dupName)
          throw new TRPCError({
            code: "CONFLICT",
            message: "Segment name or slug already exists.",
          });

        const { data, error } = await supabase
          .from("customer_segments")
          .insert({
            name: input.name,
            slug: input.slug,
            description: input.description,
            rules: input.rules,
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
    update: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          name: z.string().trim().min(2).max(120),
          description: z.string().trim().max(500).nullable(),
          rules: z.record(z.string(), z.unknown()).nullable(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "customers.update");
        const supabase = getSupabaseAdmin();
        const { error } = await supabase
          .from("customer_segments")
          .update({
            name: input.name,
            description: input.description,
            rules: input.rules,
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
        await need(ctx.user, "customers.update");
        const supabase = getSupabaseAdmin();
        const { error } = await supabase
          .from("customer_segments")
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

  feedback: router({
    list: protectedProcedure
      .input(
        z
          .object({
            outletId: z.number().int().positive().optional(),
            limit: z.number().int().min(1).max(100).default(25),
          })
          .nullish()
      )
      .query(async ({ ctx, input }) => {
        await need(ctx.user, "customers.read");
        const supabase = getSupabaseAdmin();
        const scope = await getOutletScope(ctx.user);
        if (input?.outletId) await assertOutletAccess(ctx.user, input.outletId);
        try {
          const limit = input?.limit ?? 25;
          let fbQuery: any = supabase
            .from("customer_feedback")
            .select("*")
            .order("createdAt", { ascending: false })
            .limit(limit);
          if (input?.outletId) fbQuery = fbQuery.eq("outletId", input.outletId);
          else if (scope !== null && scope.length)
            fbQuery = fbQuery.in("outletId", scope);
          const { data: fbRows, error: fbErr } = await fbQuery;
          if (fbErr) throw fbErr;
          const rows = (fbRows ?? []) as any[];
          if (!rows.length) return [];

          const customerIds = Array.from(
            new Set(rows.map((r: any) => r.customerId).filter(Boolean))
          ) as number[];
          const outletIds = Array.from(
            new Set(rows.map((r: any) => r.outletId).filter(Boolean))
          ) as number[];

          const customerMap = new Map<number, string>();
          const outletMap = new Map<number, string>();

          if (customerIds.length) {
            const { data: custRows } = await supabase
              .from("customers")
              .select("id,name")
              .in("id", customerIds);
            for (const c of (custRows ?? []) as any[])
              customerMap.set(c.id, c.name);
          }
          if (outletIds.length) {
            const { data: outRows } = await supabase
              .from("outlets")
              .select("id,name")
              .in("id", outletIds);
            for (const o of (outRows ?? []) as any[])
              outletMap.set(o.id, o.name);
          }

          return rows.map((r: any) => ({
            ...r,
            customerName: customerMap.get(r.customerId) ?? null,
            outletName: r.outletId ? (outletMap.get(r.outletId) ?? null) : null,
          }));
        } catch {
          return [];
        }
      }),
  }),
});
