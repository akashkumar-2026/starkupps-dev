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
import { getSupabaseAdmin } from "../db/supabase";

async function need(user: any, perm: any) {
  const r = await resolveStaffRole(user);
  if (!r || !hasPermission(r, perm))
    throw new TRPCError({ code: "FORBIDDEN", message: "Access denied." });
  return r;
}

export const supportRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          search: z.string().trim().max(160).optional(),
          status: z
            .enum(["open", "in_progress", "waiting", "resolved", "closed"])
            .optional(),
          priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
          outletId: z.number().int().positive().optional(),
          limit: z.number().int().min(1).max(100).default(25),
          cursor: z.number().int().positive().optional(),
        })
        .nullish()
    )
    .query(async ({ ctx, input }) => {
      await need(ctx.user, "support.read");
      const supabase = getSupabaseAdmin();
      const scope = await getOutletScope(ctx.user);
      if (scope !== null && scope.length === 0)
        return { items: [], nextCursor: undefined };

      const limit = input?.limit ?? 25;
      const limitPlusOne = limit + 1;

      let query: any = supabase
        .from("support_tickets")
        .select("*")
        .order("id", { ascending: false })
        .limit(limitPlusOne);

      if (input?.cursor) query = query.lt("id", input.cursor);
      if (input?.status) query = query.eq("status", input.status);
      if (input?.priority) query = query.eq("priority", input.priority);
      if (input?.outletId) {
        await assertOutletAccess(ctx.user, input.outletId);
        query = query.eq("outletId", input.outletId);
      } else if (scope !== null && scope.length) {
        if (scope.length === 1) query = query.eq("outletId", scope[0]);
        else query = query.in("outletId", scope);
      }
      if (input?.search) {
        const escaped = escapePostgrestOr(input.search);
        query = query.or(
          `subject.ilike.%${escaped}%,ticketNumber.ilike.%${escaped}%`
        );
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

      // Batch enrichment for customers, outlets, staff
      const customerIds = Array.from(
        new Set(page.map((r: any) => r.customerId).filter(Boolean))
      ) as number[];
      const outletIds = Array.from(
        new Set(page.map((r: any) => r.outletId).filter(Boolean))
      ) as number[];
      const staffIds = Array.from(
        new Set(page.map((r: any) => r.assignedStaffId).filter(Boolean))
      ) as number[];

      let customerMap = new Map<number, any>();
      let outletMap = new Map<number, any>();
      let staffMap = new Map<number, any>();

      try {
        if (customerIds.length) {
          const { data: cs } = await supabase
            .from("customers")
            .select("id,name")
            .in("id", customerIds);
          customerMap = new Map((cs ?? []).map((c: any) => [c.id, c]));
        }
      } catch {}
      try {
        if (outletIds.length) {
          const { data: os } = await supabase
            .from("outlets")
            .select("id,name")
            .in("id", outletIds);
          outletMap = new Map((os ?? []).map((o: any) => [o.id, o]));
        }
      } catch {}
      try {
        if (staffIds.length) {
          const { data: ss } = await supabase
            .from("staff")
            .select("id,name")
            .in("id", staffIds);
          staffMap = new Map((ss ?? []).map((s: any) => [s.id, s]));
        }
      } catch {}

      return {
        items: page.map((t: any) => ({
          ...t,
          customerName: t.customerId
            ? (customerMap.get(t.customerId)?.name ?? null)
            : null,
          outletName: t.outletId
            ? (outletMap.get(t.outletId)?.name ?? null)
            : null,
          assignedName: t.assignedStaffId
            ? (staffMap.get(t.assignedStaffId)?.name ?? null)
            : null,
        })),
        nextCursor: rows.length > limit ? page.at(-1)?.id : undefined,
      };
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await need(ctx.user, "support.read");
      const supabase = getSupabaseAdmin();

      const { data: ticket, error: tErr } = await supabase
        .from("support_tickets")
        .select("*")
        .eq("id", input.id)
        .limit(1)
        .maybeSingle();
      if (tErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: tErr.message,
        });
      if (!ticket)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Ticket not found.",
        });
      const t = ticket as any;
      if (t.outletId) await assertOutletAccess(ctx.user, t.outletId);

      // Enrich ticket with customer, outlet, order details via batch fetches
      let customerName: string | null = null;
      let customerPhone: string | null = null;
      let outletName: string | null = null;
      let orderNumber: number | null = null;

      try {
        if (t.customerId) {
          const { data: c } = await supabase
            .from("customers")
            .select("name,phone")
            .eq("id", t.customerId)
            .limit(1)
            .maybeSingle();
          customerName = (c as any)?.name ?? null;
          customerPhone = (c as any)?.phone ?? null;
        }
      } catch {}
      try {
        if (t.outletId) {
          const { data: o } = await supabase
            .from("outlets")
            .select("name")
            .eq("id", t.outletId)
            .limit(1)
            .maybeSingle();
          outletName = (o as any)?.name ?? null;
        }
      } catch {}
      try {
        if (t.orderId) {
          const { data: o } = await supabase
            .from("orders")
            .select("orderNumber")
            .eq("id", t.orderId)
            .limit(1)
            .maybeSingle();
          orderNumber = (o as any)?.orderNumber ?? null;
        }
      } catch {}

      const { data: messagesRaw, error: mErr } = await supabase
        .from("support_messages")
        .select("*")
        .eq("ticketId", input.id)
        .order("createdAt", { ascending: true });
      if (mErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: mErr.message,
        });
      const messages = (messagesRaw ?? []) as any[];

      const timeline = [
        {
          at: t.createdAt,
          action: "created",
          detail: `Ticket ${t.ticketNumber} opened`,
        },
        ...messages.map((m: any) => ({
          at: m.createdAt,
          action: m.internal ? "internal_note" : "message",
          detail: m.message.slice(0, 80),
        })),
      ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

      return {
        ticket: { ...t, customerName, customerPhone, outletName, orderNumber },
        messages,
        timeline,
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        customerId: z.number().int().positive().nullable(),
        orderId: z.number().int().positive().nullable(),
        outletId: z.number().int().positive().nullable(),
        category: z
          .enum([
            "general",
            "order_issue",
            "refund_request",
            "complaint",
            "delivery",
            "payment",
          ])
          .default("general"),
        priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
        subject: z.string().trim().min(5).max(200),
        message: z.string().trim().min(5).max(5000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await need(ctx.user, "support.manage");
      if (input.outletId) await assertOutletAccess(ctx.user, input.outletId);
      const supabase = getSupabaseAdmin();
      const ticketNumber = `TK-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}`;

      const ticketPayload: any = {
        ticketNumber,
        customerId: input.customerId,
        orderId: input.orderId,
        outletId: input.outletId,
        category: input.category,
        priority: input.priority,
        status: "open",
        subject: input.subject,
      };

      const { data: inserted, error: insErr } = await supabase
        .from("support_tickets")
        .insert(ticketPayload)
        .select("id")
        .single();
      if (insErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: insErr.message,
        });
      const id = Number((inserted as any).id);

      const { error: msgErr } = await supabase.from("support_messages").insert({
        ticketId: id,
        authorId: ctx.user.id,
        authorType: "staff",
        message: input.message,
        internal: false,
      } as any);
      if (msgErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: msgErr.message,
        });

      await recordAudit({
        actorUserId: ctx.user.id,
        entityType: "support_ticket",
        entityId: id,
        outletId: input.outletId ?? null,
        action: "created",
        after: input as any,
      });

      return { id, ticketNumber };
    }),

  updateStatus: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        status: z.enum([
          "open",
          "in_progress",
          "waiting",
          "resolved",
          "closed",
        ]),
        priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
        assignedStaffId: z.number().int().positive().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await need(ctx.user, "support.manage");
      const supabase = getSupabaseAdmin();
      const { data: cur, error: curErr } = await supabase
        .from("support_tickets")
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
          message: "Ticket not found.",
        });
      if ((cur as any).outletId)
        await assertOutletAccess(ctx.user, (cur as any).outletId);

      const patch: any = { status: input.status };
      if (input.priority) patch.priority = input.priority;
      if (input.assignedStaffId !== undefined)
        patch.assignedStaffId = input.assignedStaffId;

      const { error: updErr } = await supabase
        .from("support_tickets")
        .update(patch)
        .eq("id", input.id);
      if (updErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: updErr.message,
        });

      const { error: msgErr } = await supabase.from("support_messages").insert({
        ticketId: input.id,
        authorId: ctx.user.id,
        authorType: "system",
        message: `Status changed to ${input.status}`,
        internal: false,
      } as any);
      if (msgErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: msgErr.message,
        });

      await recordAudit({
        actorUserId: ctx.user.id,
        entityType: "support_ticket",
        entityId: input.id,
        outletId: (cur as any).outletId ?? null,
        action: "status_updated",
        before: { status: (cur as any).status } as any,
        after: { status: input.status },
      });
      return { success: true };
    }),

  addMessage: protectedProcedure
    .input(
      z.object({
        ticketId: z.number().int().positive(),
        message: z.string().trim().min(1).max(5000),
        internal: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await need(ctx.user, "support.manage");
      const supabase = getSupabaseAdmin();
      const { data: t, error: tErr } = await supabase
        .from("support_tickets")
        .select("id,outletId")
        .eq("id", input.ticketId)
        .limit(1)
        .maybeSingle();
      if (tErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: tErr.message,
        });
      if (!t)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Ticket not found.",
        });
      await assertOutletAccess(ctx.user, (t as any).outletId ?? null);

      const { data, error } = await supabase
        .from("support_messages")
        .insert({
          ticketId: input.ticketId,
          authorId: ctx.user.id,
          authorType: "staff",
          message: input.message,
          internal: input.internal,
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
});
