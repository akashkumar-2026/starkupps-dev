import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  escapePostgrestOr,
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

export const marketingRouter = router({
  coupons: router({
    list: protectedProcedure
      .input(
        z
          .object({
            search: z.string().trim().max(80).optional(),
            active: z.boolean().optional(),
          })
          .nullish()
      )
      .query(async ({ ctx, input }) => {
        await need(ctx.user, "marketing.read");
        const supabase = getSupabaseAdmin();
        let query: any = supabase
          .from("coupons")
          .select("*")
          .order("createdAt", { ascending: false })
          .limit(100);
        if (input?.search) {
          const escaped = escapePostgrestOr(input.search);
          query = query.ilike("code", `%${escaped}%`);
        }
        if (input?.active !== undefined)
          query = query.eq("active", input.active);
        const { data, error } = await query;
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        const rows = (data ?? []) as any[];
        return rows.map((r: any) => ({
          ...r,
          discountValue: Number(r.discountValue ?? 0),
          minimumOrder: Number(r.minimumOrder ?? 0),
          maximumDiscount:
            r.maximumDiscount != null ? Number(r.maximumDiscount) : null,
        }));
      }),

    create: protectedProcedure
      .input(
        z.object({
          code: z
            .string()
            .trim()
            .min(3)
            .max(40)
            .regex(/^[A-Z0-9\-_]+$/i),
          discountType: z.enum(["percentage", "fixed"]),
          discountValue: z.number().min(0).max(1000000),
          minimumOrder: z.number().min(0).max(1000000).default(0),
          maximumDiscount: z.number().min(0).max(1000000).nullable(),
          usageLimit: z.number().int().min(1).max(1000000).nullable(),
          perCustomerLimit: z.number().int().min(1).max(1000000).nullable(),
          startAt: z.date().nullable(),
          endAt: z.date().nullable(),
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
          active: z.boolean().default(true),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "marketing.manage");
        if (input.startAt && input.endAt && input.endAt <= input.startAt)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "End date must be after start date.",
          });
        if (input.discountType === "percentage" && input.discountValue > 100)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Percentage cannot exceed 100.",
          });
        const supabase = getSupabaseAdmin();
        const codeUpper = input.code.toUpperCase();
        const { data: dup, error: dupErr } = await supabase
          .from("coupons")
          .select("id")
          .eq("code", codeUpper)
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
          code: codeUpper,
          discountType: input.discountType,
          discountValue: Number(input.discountValue.toFixed(2)),
          minimumOrder: Number(input.minimumOrder.toFixed(2)),
          maximumDiscount:
            input.maximumDiscount != null
              ? Number(input.maximumDiscount.toFixed(2))
              : null,
          usageLimit: input.usageLimit,
          perCustomerLimit: input.perCustomerLimit,
          startAt: input.startAt ? input.startAt.toISOString() : null,
          endAt: input.endAt ? input.endAt.toISOString() : null,
          applicableOutlets: input.applicableOutlets as any,
          applicableProducts: input.applicableProducts as any,
          applicableCategories: input.applicableCategories as any,
          active: input.active,
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
          after: payload,
        });
        return { id };
      }),

    update: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          discountValue: z.number().min(0).max(1000000),
          minimumOrder: z.number().min(0).max(1000000),
          maximumDiscount: z.number().min(0).max(1000000).nullable(),
          usageLimit: z.number().int().min(1).max(1000000).nullable(),
          perCustomerLimit: z.number().int().min(1).max(1000000).nullable(),
          active: z.boolean(),
          endAt: z.date().nullable(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "marketing.manage");
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
        const patch: any = {
          discountValue: Number(input.discountValue.toFixed(2)),
          minimumOrder: Number(input.minimumOrder.toFixed(2)),
          maximumDiscount:
            input.maximumDiscount != null
              ? Number(input.maximumDiscount.toFixed(2))
              : null,
          usageLimit: input.usageLimit,
          perCustomerLimit: input.perCustomerLimit,
          active: input.active,
          endAt: input.endAt ? input.endAt.toISOString() : null,
        };
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
          after: input as any,
        });
        return { success: true };
      }),

    remove: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "marketing.manage");
        const supabase = getSupabaseAdmin();
        const { error } = await supabase
          .from("coupons")
          .delete()
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "coupon",
          entityId: input.id,
          action: "deleted",
        });
        return { success: true };
      }),

    validate: protectedProcedure
      .input(
        z.object({
          code: z.string().trim().min(2),
          orderAmount: z.number().min(0),
          outletId: z.number().int().positive().nullable(),
          customerId: z.number().int().positive().nullable(),
        })
      )
      .query(async ({ ctx, input }) => {
        await need(ctx.user, "marketing.read");
        const supabase = getSupabaseAdmin();
        const codeUpper = input.code.toUpperCase();
        const { data: row, error } = await supabase
          .from("coupons")
          .select("*")
          .eq("code", codeUpper)
          .limit(1)
          .maybeSingle();
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        if (!row) return { valid: false, reason: "Coupon not found." };
        const c = row as any;
        if (!c.active) return { valid: false, reason: "Coupon inactive." };
        if (c.startAt && new Date(c.startAt) > new Date())
          return { valid: false, reason: "Coupon not yet active." };
        if (c.endAt && new Date(c.endAt) < new Date())
          return { valid: false, reason: "Coupon expired." };
        if (Number(c.minimumOrder) > input.orderAmount)
          return {
            valid: false,
            reason: `Minimum order ₹${c.minimumOrder} required.`,
          };
        if (c.usageLimit && Number(c.usedCount) >= Number(c.usageLimit))
          return { valid: false, reason: "Coupon usage limit reached." };
        if (
          c.applicableOutlets &&
          input.outletId &&
          !(c.applicableOutlets as number[]).includes(input.outletId)
        )
          return {
            valid: false,
            reason: "Coupon not applicable for this outlet.",
          };
        let discount =
          c.discountType === "percentage"
            ? input.orderAmount * (Number(c.discountValue) / 100)
            : Number(c.discountValue);
        if (c.maximumDiscount)
          discount = Math.min(discount, Number(c.maximumDiscount));
        discount = Math.min(discount, input.orderAmount);
        return {
          valid: true,
          discount,
          coupon: { ...c, discountValue: Number(c.discountValue) },
        };
      }),
  }),

  offers: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      await need(ctx.user, "marketing.read");
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from("offers")
        .select("*")
        .order("createdAt", { ascending: false })
        .limit(100);
      if (error)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      return ((data ?? []) as any[]).map((r: any) => ({
        ...r,
        discountValue: r.discountValue != null ? Number(r.discountValue) : null,
      }));
    }),
    create: protectedProcedure
      .input(
        z.object({
          name: z.string().trim().min(2).max(160),
          type: z.enum([
            "percentage",
            "fixed",
            "buy_x_get_y",
            "combo",
            "product",
            "category",
            "outlet",
          ]),
          discountValue: z.number().min(0).max(1000000).nullable(),
          config: z.record(z.string(), z.unknown()).nullable(),
          applicableOutlets: z
            .array(z.number().int().positive())
            .max(100)
            .nullable(),
          active: z.boolean().default(true),
          startAt: z.date().nullable(),
          endAt: z.date().nullable(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "marketing.manage");
        const supabase = getSupabaseAdmin();
        const payload: any = {
          name: input.name,
          type: input.type,
          discountValue:
            input.discountValue != null
              ? Number(input.discountValue.toFixed(2))
              : null,
          config: input.config as any,
          applicableOutlets: input.applicableOutlets as any,
          active: input.active,
          startAt: input.startAt ? input.startAt.toISOString() : null,
          endAt: input.endAt ? input.endAt.toISOString() : null,
        };
        const { data, error } = await supabase
          .from("offers")
          .insert(payload)
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
          entityType: "offer",
          entityId: id,
          action: "created",
          after: { name: input.name, type: input.type },
        });
        return { id };
      }),
    update: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          name: z.string().trim().min(2).max(160),
          active: z.boolean(),
          discountValue: z.number().min(0).max(1000000).nullable(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "marketing.manage");
        const supabase = getSupabaseAdmin();
        const patch: any = {
          name: input.name,
          active: input.active,
          discountValue:
            input.discountValue != null
              ? Number(input.discountValue.toFixed(2))
              : null,
        };
        const { error } = await supabase
          .from("offers")
          .update(patch)
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "offer",
          entityId: input.id,
          action: "updated",
          after: { name: input.name, active: input.active },
        });
        return { success: true };
      }),
    remove: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "marketing.manage");
        const supabase = getSupabaseAdmin();
        const { error } = await supabase
          .from("offers")
          .delete()
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "offer",
          entityId: input.id,
          action: "deleted",
        });
        return { success: true };
      }),
  }),

  campaigns: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      await need(ctx.user, "marketing.read");
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from("campaigns")
        .select("*")
        .order("createdAt", { ascending: false })
        .limit(100);
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
          name: z.string().trim().min(2).max(160),
          audience: z.record(z.string(), z.unknown()).nullable(),
          offerId: z.number().int().positive().nullable(),
          couponId: z.number().int().positive().nullable(),
          channels: z
            .array(z.enum(["push", "email", "sms", "in_app", "website"]))
            .max(10)
            .nullable(),
          status: z
            .enum(["draft", "active", "paused", "completed", "archived"])
            .default("draft"),
          startAt: z.date().nullable(),
          endAt: z.date().nullable(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "marketing.manage");
        const supabase = getSupabaseAdmin();
        const payload: any = {
          name: input.name,
          audience: input.audience as any,
          offerId: input.offerId,
          couponId: input.couponId,
          channels: input.channels as any,
          status: input.status,
          startAt: input.startAt ? input.startAt.toISOString() : null,
          endAt: input.endAt ? input.endAt.toISOString() : null,
        };
        const { data, error } = await supabase
          .from("campaigns")
          .insert(payload)
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
          entityType: "campaign",
          entityId: id,
          action: "created",
          after: input as any,
        });
        return { id };
      }),
    updateStatus: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          status: z.enum([
            "draft",
            "active",
            "paused",
            "completed",
            "archived",
          ]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "marketing.manage");
        const supabase = getSupabaseAdmin();
        const { error } = await supabase
          .from("campaigns")
          .update({ status: input.status } as any)
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "campaign",
          entityId: input.id,
          action: "status_updated",
          after: { status: input.status },
        });
        return { success: true };
      }),
  }),

  banners: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      await need(ctx.user, "marketing.read");
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from("banners")
        .select("*")
        .order("createdAt", { ascending: false })
        .limit(100);
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
          title: z.string().trim().min(2).max(160),
          description: z.string().trim().max(1000).nullable(),
          imageUrl: z.string().trim().max(2000).nullable(),
          ctaLabel: z.string().trim().max(80).nullable(),
          ctaLink: z.string().trim().max(500).nullable(),
          position: z.string().trim().max(80).default("homepage_hero"),
          status: z
            .enum(["draft", "published", "scheduled", "archived"])
            .default("draft"),
          publishAt: z.date().nullable(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "marketing.manage");
        const supabase = getSupabaseAdmin();
        const payload: any = {
          title: input.title,
          description: input.description,
          imageUrl: input.imageUrl,
          ctaLabel: input.ctaLabel,
          ctaLink: input.ctaLink,
          position: input.position,
          status: input.status,
          publishAt: input.publishAt ? input.publishAt.toISOString() : null,
        };
        const { data, error } = await supabase
          .from("banners")
          .insert(payload)
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
          entityType: "banner",
          entityId: id,
          action: "created",
          after: { title: input.title, status: input.status },
        });
        return { id };
      }),
    update: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          title: z.string().trim().min(2).max(160),
          status: z.enum(["draft", "published", "scheduled", "archived"]),
          imageUrl: z.string().trim().max(2000).nullable(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "marketing.manage");
        const supabase = getSupabaseAdmin();
        const { error } = await supabase
          .from("banners")
          .update({
            title: input.title,
            status: input.status,
            imageUrl: input.imageUrl,
          } as any)
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "banner",
          entityId: input.id,
          action: "updated",
          after: { title: input.title, status: input.status },
        });
        return { success: true };
      }),
    remove: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "marketing.manage");
        const supabase = getSupabaseAdmin();
        const { error } = await supabase
          .from("banners")
          .delete()
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "banner",
          entityId: input.id,
          action: "deleted",
        });
        return { success: true };
      }),
  }),
});
