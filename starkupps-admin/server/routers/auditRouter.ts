import { z } from "zod";
import {
  assertOutletAccess,
  getOutletScope,
  hasPermission,
  resolveStaffRole,
} from "../db/index";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../lib/trpc";
import { getSupabaseAdmin, getSql } from "../db/supabase";

async function need(user: any, perm: any) {
  const r = await resolveStaffRole(user);
  if (!r || !hasPermission(r, perm))
    throw new TRPCError({ code: "FORBIDDEN", message: "Access denied." });
  return r;
}

export const auditRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          outletId: z.number().int().positive().optional(),
          entityType: z.string().trim().max(80).optional(),
          action: z.string().trim().max(80).optional(),
          from: z.date().optional(),
          to: z.date().optional(),
          limit: z.number().int().min(1).max(100).default(50),
          cursor: z.number().int().positive().optional(),
        })
        .nullish()
    )
    .query(async ({ ctx, input }) => {
      await need(ctx.user, "audit.read");
      const scope = await getOutletScope(ctx.user);
      // Fail closed: an approved user with no outlet assignment must not see
      // audit rows for any outlet.
      if (scope !== null && scope.length === 0)
        return { items: [], nextCursor: undefined };
      if (input?.outletId) await assertOutletAccess(ctx.user, input.outletId);

      // Supabase/Postgres path via raw sql for complex filtering + joins
      const sql = await getSql();
      const limit = (input?.limit ?? 50) + 1;
      const conditions: string[] = [];
      const params: any[] = [];
      let idx = 1;

      if (input?.cursor) {
        conditions.push(`a."id" < $${idx++}`);
        params.push(input.cursor);
      }
      if (input?.entityType) {
        conditions.push(`a."entityType" = $${idx++}`);
        params.push(input.entityType);
      }
      if (input?.action) {
        conditions.push(`a."action" = $${idx++}`);
        params.push(input.action);
      }
      if (input?.from) {
        conditions.push(`a."createdAt" >= $${idx++}`);
        params.push(input.from.toISOString());
      }
      if (input?.to) {
        conditions.push(`a."createdAt" <= $${idx++}`);
        params.push(input.to.toISOString());
      }
      if (input?.outletId) {
        conditions.push(`a."outletId" = $${idx++}`);
        params.push(input.outletId);
      } else if (scope !== null && scope.length) {
        if (scope.length === 1) {
          conditions.push(`a."outletId" = $${idx++}`);
          params.push(scope[0]);
        } else {
          conditions.push(
            `a."outletId" IN (${scope.map(() => `$${idx++}`).join(",")})`
          );
          params.push(...scope);
        }
      }

      const where = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";
      // Use supabase sql directly for join; fallback to supabase client if sql fails
      try {
        const rows = await sql.unsafe(
          `
        SELECT a.*, u."name" as "actorName", o."name" as "outletName"
        FROM "audit_log" a
        LEFT JOIN "users" u ON a."actorUserId" = u."id"
        LEFT JOIN "outlets" o ON a."outletId" = o."id"
        ${where}
        ORDER BY a."id" DESC
        LIMIT $${idx++}
      `,
          [...params, limit]
        );

        const page = rows.slice(0, input?.limit ?? 50);
        return {
          items: page.map((r: any) => ({
            ...r,
            actorName: r.actorName ?? `User #${r.actorUserId}`,
            outletName: r.outletName,
          })),
          nextCursor:
            rows.length > (input?.limit ?? 50) ? page.at(-1)?.id : undefined,
        };
      } catch (e) {
        // Fallback via Supabase client
        const supabase = getSupabaseAdmin();
        let q = supabase
          .from("audit_log")
          .select("*")
          .order("id", { ascending: false })
          .limit(limit);
        if (input?.cursor) q = q.lt("id", input.cursor);
        if (input?.entityType) q = q.eq("entityType", input.entityType);
        if (input?.action) q = q.eq("action", input.action);
        if (input?.from) q = q.gte("createdAt", input.from.toISOString());
        if (input?.to) q = q.lte("createdAt", input.to.toISOString());
        if (input?.outletId) q = q.eq("outletId", input.outletId);
        else if (scope !== null && scope.length) {
          if (scope.length === 1) q = q.eq("outletId", scope[0]);
          else q = q.in("outletId", scope);
        }
        const { data, error } = await q;
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        // Enrich with user/outlet names via batch fetch
        const userIds = Array.from(
          new Set((data || []).map((r: any) => r.actorUserId).filter(Boolean))
        ) as number[];
        const outletIds = Array.from(
          new Set((data || []).map((r: any) => r.outletId).filter(Boolean))
        ) as number[];
        const userMap = new Map<number, string>();
        const outletMap = new Map<number, string>();
        if (userIds.length) {
          const { data: users } = await supabase
            .from("users")
            .select("id,name")
            .in("id", userIds);
          users?.forEach((u: any) => userMap.set(u.id, u.name));
        }
        if (outletIds.length) {
          const { data: outlets } = await supabase
            .from("outlets")
            .select("id,name")
            .in("id", outletIds);
          outlets?.forEach((o: any) => outletMap.set(o.id, o.name));
        }
        const enriched = (data || []).map((r: any) => ({
          ...r,
          actorName: userMap.get(r.actorUserId) ?? `User #${r.actorUserId}`,
          outletName: outletMap.get(r.outletId),
        }));
        const page = enriched.slice(0, input?.limit ?? 50);
        return {
          items: page,
          nextCursor:
            (data || []).length > (input?.limit ?? 50)
              ? page.at(-1)?.id
              : undefined,
        };
      }
    }),
});
