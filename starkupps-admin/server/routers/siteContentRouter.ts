/**
 * Storefront site content — Admin > Settings > Storefront.
 *
 * Everything the public site renders about the business that the owner may want
 * to change (contact details, hours, FSSAI licence, hero copy, the stats strip,
 * the trust claims, gallery images) lives in a single row of `public.site_settings`.
 *
 * Before this router every one of those was a string literal in the storefront
 * bundle, which meant the panel could not correct them and the site asserted
 * claims such as "1,240 reviews" and "9 min" on every page load regardless of
 * what the database actually held.
 *
 * Two shapes are exposed:
 *   - `siteContent.get` / `.save` — the full row, owner-only for writes.
 *   - consumed by the storefront over `/api/public/site` (public GET only).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { recordAudit, resolveStaffRole } from "../db/index";
import { getSupabaseAdmin } from "../db/supabase";
import { protectedProcedure, router } from "../lib/trpc";

/** Every editable text field. Shared by the read projection and the save input. */
const SITE_CONTENT_COLUMNS = [
  "brandName",
  "tagline",
  "phoneDigits",
  "whatsappNumber",
  "address",
  "addressDetail",
  "mapsQuery",
  "latitude",
  "longitude",
  "hoursSummary",
  "hoursShort",
  "hoursNote",
  "fssaiLicense",
  "heroHeading",
  "heroSubheading",
  "heroBadge",
  "heroCtaLabel",
  "openBadge",
  "statRatingLabel",
  "statOrdersLabel",
  "statPickupLabel",
  "trustHeading",
  "trustClaim1",
  "trustClaim2",
  "trustClaim3",
  "trustPickupStat",
  "trustPickupCaption",
  "trustPremadeStat",
  "trustPremadeCaption",
  "galleryHeading",
  "galleryBody",
  "menuHeading",
  "menuEmptyMessage",
  "metaTitle",
  "metaDescription",
  "metaOgDescription",
  "updatedAt",
] as const;

export type SiteContentRow = Record<
  (typeof SITE_CONTENT_COLUMNS)[number],
  unknown
>;

/** One gallery slot. `url` empty means "not uploaded yet" — never a stock photo. */
const galleryImageSchema = z.object({
  url: z.string().trim().max(2000),
  alt: z.string().trim().max(300),
  span: z.enum(["", "sm:col-span-2"]).default(""),
});

const saveInput = z.object({
  brandName: z.string().trim().min(1).max(120),
  tagline: z.string().trim().max(200),
  // 10-15 digits, digits only. Stored without a leading 0 so it can be appended
  // to wa.me and tel: without further massaging at every call site.
  phoneDigits: z
    .string()
    .trim()
    .regex(/^[0-9]{10,15}$/, "Enter 10-15 digits, no + or spaces"),
  whatsappNumber: z
    .string()
    .trim()
    .regex(/^[0-9]{10,15}$/, "Enter 10-15 digits, no + or spaces"),
  address: z.string().trim().min(2).max(500),
  addressDetail: z.string().trim().max(500),
  mapsQuery: z.string().trim().max(300),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  hoursSummary: z.string().trim().max(120),
  hoursShort: z.string().trim().max(120),
  hoursNote: z.string().trim().max(200),
  fssaiLicense: z.string().trim().max(100),
  heroHeading: z.string().trim().min(2).max(300),
  heroSubheading: z.string().trim().max(600),
  heroBadge: z.string().trim().max(120),
  heroCtaLabel: z.string().trim().max(80),
  openBadge: z.string().trim().max(120),
  statRatingLabel: z.string().trim().max(200),
  statOrdersLabel: z.string().trim().max(200),
  statPickupLabel: z.string().trim().max(200),
  trustHeading: z.string().trim().max(300),
  trustClaim1: z.string().trim().max(300),
  trustClaim2: z.string().trim().max(300),
  trustClaim3: z.string().trim().max(300),
  trustPickupStat: z.string().trim().max(40),
  trustPickupCaption: z.string().trim().max(200),
  trustPremadeStat: z.string().trim().max(40),
  trustPremadeCaption: z.string().trim().max(300),
  galleryHeading: z.string().trim().max(300),
  galleryBody: z.string().trim().max(600),
  menuHeading: z.string().trim().max(300),
  menuEmptyMessage: z.string().trim().max(300),
  metaTitle: z.string().trim().max(200),
  metaDescription: z.string().trim().max(400),
  metaOgDescription: z.string().trim().max(400),
  galleryImages: z.array(galleryImageSchema).max(12).default([]),
});

export const siteContentRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const role = await resolveStaffRole(ctx.user);
    if (!role)
      throw new TRPCError({ code: "FORBIDDEN", message: "Access denied." });
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("site_settings")
      .select(SITE_CONTENT_COLUMNS.join(","))
      .eq("id", 1)
      .maybeSingle();
    if (error)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: error.message,
      });
    return (data as SiteContentRow | null) ?? null;
  }),

  save: protectedProcedure.input(saveInput).mutation(async ({ ctx, input }) => {
    // Owner only: these strings are the shop's public claims.
    const role = await resolveStaffRole(ctx.user);
    if (role !== "owner")
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Owner access is required to edit storefront content.",
      });

    const supabase = getSupabaseAdmin();
    const { data: current, error: readErr } = await supabase
      .from("site_settings")
      .select(SITE_CONTENT_COLUMNS.join(","))
      .eq("id", 1)
      .maybeSingle();
    if (readErr)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: readErr.message,
      });

    const { error } = await supabase
      .from("site_settings")
      .update({ ...input, updatedAt: new Date().toISOString() } as any)
      .eq("id", 1);
    if (error)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: error.message,
      });

    await recordAudit({
      actorUserId: ctx.user.id,
      entityType: "site_settings",
      entityId: 1,
      action: "updated",
      before: (current ?? null) as unknown as Record<string, unknown>,
      after: input as unknown as Record<string, unknown>,
    });

    return { ok: true as const };
  }),
});
