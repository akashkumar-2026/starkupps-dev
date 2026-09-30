/**
 * Admin CRUD for the storefront Instagram section.
 *
 * Content lives in two tables created by
 * `supabase/migrations/20260926080000_instagram_feed.sql`:
 *   - instagram_posts    (the permalinks shown in the marquee)
 *   - instagram_settings (singleton row: copy + behaviour)
 *
 * Every write goes through the shared parser in `@shared/instagram`, so a URL
 * that the Admin UI rejects is also rejected here — the browser check is a
 * convenience, this is the enforcement.
 *
 * Permission model: reads need `content.read`, writes need `content.manage`.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { hasPermission, recordAudit, resolveStaffRole } from "../db/index";
import { protectedProcedure, router } from "../lib/trpc";
import { getSql, getSupabaseAdmin } from "../db/supabase";
import {
  INSTAGRAM_LIMITS,
  parseInstagramUrl,
  resolveProfileUrl,
  sanitizeProfileHandle,
  sanitizeRequiredText,
  sanitizeText,
  type InstagramPost,
} from "@shared/instagram";

async function need(user: any, perm: any) {
  const r = await resolveStaffRole(user);
  if (!r || !hasPermission(r, perm))
    throw new TRPCError({ code: "FORBIDDEN", message: "Access denied." });
  return r;
}

// Postgres unique-violation. The unique index on instagram_posts.shortcode is
// the real guard against duplicates; this maps it to a friendly CONFLICT.
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: { code?: string } | null): boolean {
  return Boolean(error && error.code === UNIQUE_VIOLATION);
}

const DUPLICATE_MESSAGE =
  "That post is already in the feed. Delete the existing one first, or toggle it visible.";

/** Shape a PostgREST row into the shared `InstagramPost` contract. */
function toPost(row: any): InstagramPost {
  return {
    id: Number(row.id),
    url: String(row.url),
    shortcode: String(row.shortcode),
    type: row.type === "reel" ? "reel" : "post",
    caption: row.caption ?? null,
    thumbnailUrl: row.thumbnailUrl ?? null,
    sortOrder: Number(row.sortOrder ?? 0),
    isActive: Boolean(row.isActive),
    createdAt: String(row.createdAt ?? new Date().toISOString()),
    updatedAt: String(row.updatedAt ?? new Date().toISOString()),
  };
}

const POST_COLUMNS =
  "id,url,shortcode,type,caption,thumbnailUrl,sortOrder,isActive,createdAt,updatedAt";

// ── Thumbnail resolution ─────────────────────────────────────────────────
//
// Instagram has no token-free API, but it does expose a permalink media
// endpoint that redirects to a CDN file:
//     /p/{shortcode}/media/?size=l  ->  302 -> https://...fbcdn.net/....jpg
// It works for reels as well as posts — the reel resolves to its cover frame —
// so one code path covers both types. Using /p/ (not /reel/) is deliberate:
// the reel variant returns 404.
//
// Only the redirect is read (no image bytes cross the gateway), the result is
// cached in-process, and the resolved host is allow-listed before it is handed
// to the browser. No token, no scraping of the rendered page.

const THUMB_TTL_MS = 30 * 60 * 1000;
const THUMB_TIMEOUT_MS = 6000;
const thumbCache = new Map<string, { url: string | null; exp: number }>();

// Only Instagram/Meta CDNs are ever returned.
const THUMB_HOST_RE = /(^|\.)(cdninstagram\.com|fba\.net|fbcdn\.net)$/i;

async function resolveThumbnail(shortcode: string): Promise<string | null> {
  const cached = thumbCache.get(shortcode);
  if (cached && cached.exp > Date.now()) return cached.url;

  let url: string | null = null;
  try {
    const res = await fetch(
      `https://www.instagram.com/p/${encodeURIComponent(shortcode)}/media/?size=l`,
      {
        redirect: "manual",
        signal: AbortSignal.timeout(THUMB_TIMEOUT_MS),
        headers: {
          // Instagram serves the redirect to any real browser UA.
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
        },
      }
    );
    const location = res.headers.get("location");
    if (res.status === 302 && location) {
      try {
        const parsed = new URL(location);
        if (
          parsed.protocol === "https:" &&
          THUMB_HOST_RE.test(parsed.hostname)
        ) {
          url = parsed.toString();
        }
      } catch {
        url = null;
      }
    }
  } catch {
    url = null;
  }

  thumbCache.set(shortcode, { url, exp: Date.now() + THUMB_TTL_MS });
  return url;
}

export const instagramRouter = router({
  posts: router({
    /** All posts, including hidden ones — the Admin panel needs the full set. */
    list: protectedProcedure.query(async ({ ctx }) => {
      await need(ctx.user, "content.read");
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from("instagram_posts")
        .select(POST_COLUMNS)
        .order("sortOrder", { ascending: true })
        .order("id", { ascending: true })
        .limit(200);
      if (error)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      return ((data ?? []) as any[]).map(toPost);
    }),

    /**
     * Create from a pasted permalink. Type is detected server-side from the
     * URL path — the Admin badge is a preview of this, not the source of truth.
     */
    create: protectedProcedure
      .input(
        z.object({
          url: z.string().trim().min(1, "Paste an Instagram link.").max(2000),
          caption: z.string().max(INSTAGRAM_LIMITS.caption).nullish(),
          isActive: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "content.manage");
        const parsed = parseInstagramUrl(input.url);
        if (!parsed.ok) {
          throw new TRPCError({ code: "BAD_REQUEST", message: parsed.error });
        }

        const supabase = getSupabaseAdmin();

        // Friendly pre-check; the unique index below is still authoritative.
        const { data: existing } = await supabase
          .from("instagram_posts")
          .select("id")
          .eq("shortcode", parsed.shortcode)
          .limit(1)
          .maybeSingle();
        if (existing) {
          throw new TRPCError({ code: "CONFLICT", message: DUPLICATE_MESSAGE });
        }

        // Append to the end of the track (10-step gaps, matching the seed).
        const { data: last } = await supabase
          .from("instagram_posts")
          .select("sortOrder")
          .order("sortOrder", { ascending: false })
          .limit(1)
          .maybeSingle();
        const sortOrder = Number((last as any)?.sortOrder ?? 0) + 10;

        const payload = {
          url: parsed.url,
          shortcode: parsed.shortcode,
          type: parsed.type,
          caption: sanitizeText(input.caption, INSTAGRAM_LIMITS.caption),
          sortOrder,
          isActive: input.isActive ?? true,
        };

        const { data, error } = await supabase
          .from("instagram_posts")
          .insert(payload as any)
          .select(POST_COLUMNS)
          .single();
        if (error) {
          if (isUniqueViolation(error as any)) {
            throw new TRPCError({
              code: "CONFLICT",
              message: DUPLICATE_MESSAGE,
            });
          }
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        }

        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "instagram_post",
          entityId: Number((data as any).id),
          action: "created",
          after: { shortcode: parsed.shortcode, type: parsed.type },
        });
        return { id: Number((data as any).id), post: toPost(data) };
      }),

    /** Patch a post. The URL is re-validated whenever it is supplied. */
    update: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          url: z.string().trim().min(1).max(2000).optional(),
          caption: z.string().max(INSTAGRAM_LIMITS.caption).nullish(),
          isActive: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "content.manage");
        const supabase = getSupabaseAdmin();

        const patch: Record<string, unknown> = {};
        if (input.url !== undefined) {
          const parsed = parseInstagramUrl(input.url);
          if (!parsed.ok) {
            throw new TRPCError({ code: "BAD_REQUEST", message: parsed.error });
          }
          if (parsed.shortcode !== undefined) {
            const { data: clash } = await supabase
              .from("instagram_posts")
              .select("id")
              .eq("shortcode", parsed.shortcode)
              .neq("id", input.id)
              .limit(1)
              .maybeSingle();
            if (clash) {
              throw new TRPCError({
                code: "CONFLICT",
                message: DUPLICATE_MESSAGE,
              });
            }
          }
          patch.url = parsed.url;
          patch.shortcode = parsed.shortcode;
          patch.type = parsed.type;
        }
        if (input.caption !== undefined) {
          patch.caption = sanitizeText(input.caption, INSTAGRAM_LIMITS.caption);
        }
        if (input.isActive !== undefined) patch.isActive = input.isActive;

        if (Object.keys(patch).length === 0) return { success: true };

        const { data, error } = await supabase
          .from("instagram_posts")
          .update(patch as any)
          .eq("id", input.id)
          .select(POST_COLUMNS)
          .maybeSingle();
        if (error) {
          if (isUniqueViolation(error as any)) {
            throw new TRPCError({
              code: "CONFLICT",
              message: DUPLICATE_MESSAGE,
            });
          }
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        }
        if (!data) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Post not found.",
          });
        }

        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "instagram_post",
          entityId: input.id,
          action: "updated",
          after: patch as Record<string, unknown>,
        });
        return { success: true, post: toPost(data) };
      }),

    /** Show/hide without touching the rest of the record. */
    setActive: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          isActive: z.boolean(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "content.manage");
        const supabase = getSupabaseAdmin();
        const { error } = await supabase
          .from("instagram_posts")
          .update({ isActive: input.isActive } as any)
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "instagram_post",
          entityId: input.id,
          action: input.isActive ? "shown" : "hidden",
        });
        return { success: true };
      }),

    /**
     * Bulk reorder. Runs as one transaction so the storefront can never observe
     * a half-applied order (which would show duplicated or missing cards).
     * `ids` is the complete, ordered list of post ids from the Admin list.
     */
    reorder: protectedProcedure
      .input(
        z.object({
          ids: z
            .array(z.number().int().positive())
            .min(1, "Nothing to reorder.")
            .max(500),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "content.manage");

        const distinct = new Set(input.ids);
        if (distinct.size !== input.ids.length) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Duplicate ids in the new order.",
          });
        }

        const sql = await getSql();
        try {
          await sql.begin(async (tx: any) => {
            for (let i = 0; i < input.ids.length; i++) {
              await tx`UPDATE instagram_posts SET "sortOrder" = ${i * 10} WHERE id = ${input.ids[i]}`;
            }
          });
        } catch (e: any) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: e?.message ?? "Could not save the new order.",
          });
        }

        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "instagram_post",
          action: "reordered",
          after: { count: input.ids.length },
        });
        return { success: true };
      }),

    remove: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "content.manage");
        const supabase = getSupabaseAdmin();
        const { data: row } = await supabase
          .from("instagram_posts")
          .select("id,shortcode,type")
          .eq("id", input.id)
          .maybeSingle();
        if (!row) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Post not found.",
          });
        }
        const { error } = await supabase
          .from("instagram_posts")
          .delete()
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "instagram_post",
          entityId: input.id,
          action: "deleted",
          before: row as Record<string, unknown>,
        });
        return { success: true };
      }),
  }),

  /**
   * Resolve poster frames for a batch of shortcodes.
   *
   * Returns a plain map of shortcode -> image URL (or null when Instagram has no
   * media for it). The browser then loads the image straight from the CDN, so
   * no image bytes pass through this gateway.
   */
  thumbnails: protectedProcedure
    .input(
      z.object({
        shortcodes: z
          .array(
            z
              .string()
              .trim()
              .regex(/^[A-Za-z0-9_-]{1,64}$/, "Not an Instagram shortcode.")
          )
          .min(1)
          .max(60),
      })
    )
    .query(async ({ ctx, input }) => {
      await need(ctx.user, "content.read");
      const unique = Array.from(new Set(input.shortcodes));
      // Small bounded fan-out; Instagram is only asked once per shortcode per TTL.
      const out: Record<string, string | null> = {};
      for (const shortcode of unique) {
        out[shortcode] = await resolveThumbnail(shortcode);
      }
      return out;
    }),

  settings: router({
    /** Singleton settings row, or null before the migration seed runs. */
    get: protectedProcedure.query(async ({ ctx }) => {
      await need(ctx.user, "content.read");
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from("instagram_settings")
        .select(
          "enabled,eyebrow,heading,subheading,profileHandle,profileUrl,followButtonLabel,scrollSpeed,maxItems,pauseOnHover"
        )
        .eq("id", 1)
        .maybeSingle();
      if (error)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      if (!data) return null;
      const row = data as any;
      return {
        enabled: Boolean(row.enabled),
        eyebrow: String(row.eyebrow ?? "Follow along"),
        heading: String(row.heading ?? "Follow the froth"),
        subheading: row.subheading ?? null,
        profileHandle: sanitizeProfileHandle(row.profileHandle) || "starkupps",
        profileUrl: resolveProfileUrl(row.profileUrl, row.profileHandle),
        followButtonLabel: String(row.followButtonLabel ?? "Follow"),
        scrollSpeed: (["slow", "normal", "fast"] as const).includes(
          row.scrollSpeed
        )
          ? row.scrollSpeed
          : "normal",
        maxItems: Number(row.maxItems ?? 10),
        pauseOnHover: row.pauseOnHover !== false,
      };
    }),

    /**
     * Upsert the singleton row. Free text is sanitised and length-capped here;
     * `maxItems` is clamped so a bad value can never blank or flood the
     * storefront marquee.
     */
    update: protectedProcedure
      .input(
        z.object({
          enabled: z.boolean().optional(),
          eyebrow: z.string().max(INSTAGRAM_LIMITS.eyebrow).optional(),
          heading: z.string().max(INSTAGRAM_LIMITS.heading).optional(),
          subheading: z.string().max(INSTAGRAM_LIMITS.subheading).nullish(),
          profileHandle: z.string().max(60).optional(),
          profileUrl: z.string().max(500).nullish(),
          followButtonLabel: z
            .string()
            .max(INSTAGRAM_LIMITS.followButtonLabel)
            .optional(),
          scrollSpeed: z.enum(["slow", "normal", "fast"]).optional(),
          maxItems: z.number().int().optional(),
          pauseOnHover: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "content.manage");

        const patch: Record<string, unknown> = {};
        if (input.enabled !== undefined) patch.enabled = input.enabled;
        if (input.eyebrow !== undefined) {
          patch.eyebrow = sanitizeRequiredText(
            input.eyebrow,
            INSTAGRAM_LIMITS.eyebrow,
            "Follow along"
          );
        }
        if (input.heading !== undefined) {
          patch.heading = sanitizeRequiredText(
            input.heading,
            INSTAGRAM_LIMITS.heading,
            "Follow the froth"
          );
        }
        if (input.subheading !== undefined) {
          patch.subheading = sanitizeText(
            input.subheading,
            INSTAGRAM_LIMITS.subheading
          );
        }
        if (input.followButtonLabel !== undefined) {
          patch.followButtonLabel = sanitizeRequiredText(
            input.followButtonLabel,
            INSTAGRAM_LIMITS.followButtonLabel,
            "Follow"
          );
        }
        if (input.scrollSpeed !== undefined) {
          patch.scrollSpeed = input.scrollSpeed;
        }
        if (input.maxItems !== undefined) {
          patch.maxItems = Math.min(
            INSTAGRAM_LIMITS.maxItems,
            Math.max(INSTAGRAM_LIMITS.minItems, Math.trunc(input.maxItems))
          );
        }
        if (input.pauseOnHover !== undefined) {
          patch.pauseOnHover = input.pauseOnHover;
        }

        // Handle and URL are interdependent. Two rules:
        //  - a bad URL can never produce an off-site "Follow" link, because
        //    resolveProfileUrl falls back to the handle;
        //  - changing the username alone must re-point the URL, otherwise the
        //    button would read "Follow @newname" while still linking to the old
        //    profile. An explicitly supplied URL always wins.
        if (
          input.profileHandle !== undefined ||
          input.profileUrl !== undefined
        ) {
          const supabase = getSupabaseAdmin();
          const { data: current } = await supabase
            .from("instagram_settings")
            .select("profileHandle,profileUrl")
            .eq("id", 1)
            .maybeSingle();
          const handle = sanitizeProfileHandle(
            input.profileHandle !== undefined
              ? input.profileHandle
              : (current as any)?.profileHandle
          );
          if (!handle) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Enter an Instagram username (letters, numbers, dots).",
            });
          }
          patch.profileHandle = handle;
          patch.profileUrl = resolveProfileUrl(
            input.profileUrl !== undefined
              ? input.profileUrl
              : // No URL supplied: re-derive from the handle so the two can
                // never drift apart.
                null,
            handle
          );
        }

        if (Object.keys(patch).length === 0) return { success: true };

        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
          .from("instagram_settings")
          .upsert({ id: 1, ...patch } as any, { onConflict: "id" })
          .select(
            "enabled,eyebrow,heading,subheading,profileHandle,profileUrl,followButtonLabel,scrollSpeed,maxItems,pauseOnHover"
          )
          .single();
        if (error) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        }

        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "instagram_settings",
          entityId: 1,
          action: "updated",
          after: patch,
        });
        return { success: true, settings: data };
      }),
  }),
});
