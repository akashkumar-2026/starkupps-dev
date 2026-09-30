import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { hasPermission, recordAudit, resolveStaffRole } from "../db/index";
import { protectedProcedure, router } from "../lib/trpc";
import { getSupabaseAdmin } from "../db/supabase";

async function need(user: any, perm: any) {
  const r = await resolveStaffRole(user);
  if (!r || !hasPermission(r, perm))
    throw new TRPCError({ code: "FORBIDDEN", message: "Access denied." });
  return r;
}

export const contentRouter = router({
  blocks: router({
    list: protectedProcedure
      .input(
        z
          .object({
            page: z.string().trim().max(80).optional(),
            status: z
              .enum(["draft", "published", "scheduled", "archived"])
              .optional(),
          })
          .nullish()
      )
      .query(async ({ ctx, input }) => {
        await need(ctx.user, "content.read");
        const supabase = getSupabaseAdmin();
        let query: any = supabase
          .from("content_blocks")
          .select(
            "id,page,key,title,description,imageUrl,ctaLabel,ctaLink,position,status,publishAt,createdAt"
          );
        if (input?.page) query = query.eq("page", input.page);
        if (input?.status) query = query.eq("status", input.status);
        query = query
          .order("position", { ascending: true })
          .order("createdAt", { ascending: false })
          .limit(100);
        const { data, error } = await query;
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
          page: z.string().trim().min(2).max(80),
          key: z.string().trim().min(2).max(120),
          title: z.string().trim().max(200).nullable(),
          description: z.string().trim().max(5000).nullable(),
          imageUrl: z.string().trim().max(2000).nullable(),
          ctaLabel: z.string().trim().max(80).nullable(),
          ctaLink: z.string().trim().max(500).nullable(),
          position: z.number().int().min(0).max(1000).default(0),
          status: z
            .enum(["draft", "published", "scheduled", "archived"])
            .default("draft"),
          publishAt: z.date().nullable(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "content.manage");
        const supabase = getSupabaseAdmin();
        const payload: any = {
          page: input.page,
          key: input.key,
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
          .from("content_blocks")
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
          entityType: "content_block",
          entityId: id,
          action: "created",
          after: { page: input.page, key: input.key, status: input.status },
        });
        return { id };
      }),

    update: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          title: z.string().trim().max(200).nullable(),
          description: z.string().trim().max(5000).nullable(),
          imageUrl: z.string().trim().max(2000).nullable(),
          status: z.enum(["draft", "published", "scheduled", "archived"]),
          position: z.number().int().min(0).max(1000),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "content.manage");
        const supabase = getSupabaseAdmin();
        const patch: any = {
          title: input.title,
          description: input.description,
          imageUrl: input.imageUrl,
          status: input.status,
          position: input.position,
        };
        const { error } = await supabase
          .from("content_blocks")
          .update(patch)
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "content_block",
          entityId: input.id,
          action: "updated",
          after: { status: input.status, position: input.position },
        });
        return { success: true };
      }),

    remove: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "content.manage");
        const supabase = getSupabaseAdmin();
        const { error } = await supabase
          .from("content_blocks")
          .delete()
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "content_block",
          entityId: input.id,
          action: "deleted",
        });
        return { success: true };
      }),
  }),

  faqs: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      await need(ctx.user, "content.read");
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from("faqs")
        .select("id,question,answer,position,active")
        .order("position", { ascending: true });
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
          question: z.string().trim().min(5).max(500),
          answer: z.string().trim().min(5).max(5000),
          position: z.number().int().min(0).max(1000).default(0),
          active: z.boolean().default(true),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "content.manage");
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
          .from("faqs")
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
          entityType: "faq",
          entityId: id,
          action: "created",
        });
        return { id };
      }),
    update: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          question: z.string().trim().min(5).max(500),
          answer: z.string().trim().min(5).max(5000),
          active: z.boolean(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "content.manage");
        const supabase = getSupabaseAdmin();
        const { error } = await supabase
          .from("faqs")
          .update({
            question: input.question,
            answer: input.answer,
            active: input.active,
          } as any)
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "faq",
          entityId: input.id,
          action: "updated",
        });
        return { success: true };
      }),
    remove: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "content.manage");
        const supabase = getSupabaseAdmin();
        const { error } = await supabase
          .from("faqs")
          .delete()
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "faq",
          entityId: input.id,
          action: "deleted",
        });
        return { success: true };
      }),
  }),

  testimonials: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      await need(ctx.user, "content.read");
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from("testimonials")
        .select("id,authorName,authorRole,content,rating,active,createdAt")
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
          authorName: z.string().trim().min(2).max(120),
          authorRole: z.string().trim().max(120).nullable(),
          content: z.string().trim().min(5).max(5000),
          rating: z.number().int().min(1).max(5).default(5),
          active: z.boolean().default(true),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "content.manage");
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
          .from("testimonials")
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
          entityType: "testimonial",
          entityId: id,
          action: "created",
        });
        return { id };
      }),
    remove: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "content.manage");
        const supabase = getSupabaseAdmin();
        const { error } = await supabase
          .from("testimonials")
          .delete()
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "testimonial",
          entityId: input.id,
          action: "deleted",
        });
        return { success: true };
      }),
  }),

  banners: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      await need(ctx.user, "content.read");
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from("banners")
        .select(
          "id,title,description,imageUrl,ctaLabel,ctaLink,position,status,publishAt,createdAt"
        )
        .order("createdAt", { ascending: false })
        .limit(50);
      if (error)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      return (data ?? []) as any[];
    }),
  }),
});
