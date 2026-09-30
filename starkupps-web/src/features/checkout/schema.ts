import { z } from "zod";
import type { OrderType } from "@/types/orders";

/**
 * Production-grade checkout validation.
 *
 * Goals:
 * - Single source of truth for client + future server reuse
 * - Normalization before validation (trim, collapse whitespace, phone digits)
 * - Discrimination by orderType so address is required only for delivery
 * - Narrow, actionable error messages for FormMessage
 * - Scalable: add fields by extending the base or a variant without touching consumers
 */

// ── Normalizers ────────────────────────────────────────────────────────────

export function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function normalizePhone(raw: string): string {
  // Indian standard: exactly 10 digits. Strip all non-digits, do not silently slice longer inputs.
  return raw.replace(/\D/g, "");
}

export function normalizeAddress(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

// ── Primitive schemas (reuse across app) ─────────────────────────────────

const NAME_REGEX = /^[A-Za-zÀ-ÖØ-öø-ÿ\u0100-\u024F\u1E00-\u1EFF'.\- ]+$/;

export const nameSchema = z
  .string({ required_error: "Enter your full name." })
  .trim()
  .min(2, { message: "Enter at least 2 characters." })
  .max(60, { message: "Name must be at most 60 characters." })
  .refine((v) => NAME_REGEX.test(v), {
    message: "Name may only contain letters, spaces, apostrophes, dots and hyphens.",
  })
  .transform(normalizeName);

export const phoneSchema = z
  .string({ required_error: "Enter your phone number." })
  .trim()
  .superRefine((raw, ctx) => {
    const digits = raw.replace(/\D/g, "");
    if (digits.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter your phone number." });
      return;
    }
    if (digits.length !== 10) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter exactly 10 digits (Indian mobile, e.g. 9876543210).",
      });
      return;
    }
    if (!/^[6-9]\d{9}$/.test(digits)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a valid Indian mobile number starting with 6-9.",
      });
    }
  })
  .transform((raw) => normalizePhone(raw));

/**
 * Address: required only for delivery. For other modes we still accept but do not require.
 * Keep min 10, max 300, at least two words — prevents "home" or "Munger".
 */
const addressRequiredSchema = z
  .string({ required_error: "Enter your delivery address." })
  .trim()
  .min(10, { message: "Enter your full address — at least 10 characters." })
  .max(300, { message: "Address must be at most 300 characters." })
  .refine((v) => v.split(/\s+/).filter(Boolean).length >= 2, {
    message: "Enter street/area and locality (at least two words).",
  })
  .transform(normalizeAddress);

const addressOptionalSchema = z
  .string()
  .trim()
  .max(300, { message: "Address must be at most 300 characters." })
  .optional()
  .default("")
  .transform((v) => (v ? normalizeAddress(v) : ""));

export const notesSchema = z
  .string()
  .trim()
  .max(300, { message: "Notes must be at most 300 characters." })
  .optional()
  .default("")
  .transform((v) => (v ? v.replace(/\s+/g, " ").trim() : ""));

// ── Discriminated union by orderType ─────────────────────────────────────

const baseFields = {
  name: nameSchema,
  phone: phoneSchema,
  notes: notesSchema,
} as const;

const dineInSchema = z.object({
  orderType: z.literal("dine-in"),
  ...baseFields,
  address: addressOptionalSchema,
});

const takeawaySchema = z.object({
  orderType: z.literal("takeaway"),
  ...baseFields,
  address: addressOptionalSchema,
});

const deliverySchema = z.object({
  orderType: z.literal("delivery"),
  ...baseFields,
  address: addressRequiredSchema,
});

export const checkoutSchema = z.discriminatedUnion("orderType", [
  dineInSchema,
  takeawaySchema,
  deliverySchema,
]);

export type CheckoutFormValues = z.input<typeof checkoutSchema>;
export type CheckoutPayload = z.output<typeof checkoutSchema> & {
  phoneNormalized: string;
};

// ── Helpers for form defaults & payload ──────────────────────────────────

export const checkoutDefaults: Record<OrderType, CheckoutFormValues> = {
  "dine-in": { orderType: "dine-in", name: "", phone: "", address: "", notes: "" },
  takeaway: { orderType: "takeaway", name: "", phone: "", address: "", notes: "" },
  delivery: { orderType: "delivery", name: "", phone: "", address: "", notes: "" },
};

export function getCheckoutSchema(orderType: OrderType) {
  switch (orderType) {
    case "dine-in":
      return dineInSchema;
    case "takeaway":
      return takeawaySchema;
    case "delivery":
      return deliverySchema;
  }
}

/**
 * For programmatic validation outside react-hook-form (e.g. unit tests, server).
 * Returns parsed payload with normalized name/phone/address or throws.
 */
export function parseCheckout(input: CheckoutFormValues): CheckoutPayload {
  const parsed = checkoutSchema.parse(input) as z.output<typeof checkoutSchema>;
  return {
    ...parsed,
    phoneNormalized: (parsed as { phone: string }).phone,
  };
}
