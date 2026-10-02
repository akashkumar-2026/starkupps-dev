import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  assertOutletAccess,
  getOutletScope,
  recordAudit,
  resolveStaffRole,
} from "../db/index";
import { protectedProcedure, router } from "../lib/trpc";
import { getSupabaseAdmin, getSql } from "../db/supabase";

const units = [
  "kg",
  "g",
  "L",
  "ml",
  "units",
  "packs",
  "boxes",
  "bottles",
] as const;
const itemInput = z.object({
  name: z.string().trim().min(2).max(160),
  sku: z.string().trim().min(2).max(80),
  categoryId: z.number().int().positive().nullable(),
  supplierId: z.number().int().positive().nullable(),
  description: z.string().trim().max(2_000).nullable(),
  quantity: z.number().min(0).max(1_000_000),
  unit: z.enum(units),
  reorderLevel: z.number().min(0).max(1_000_000),
  maxStockLevel: z.number().positive().max(1_000_000).nullable(),
  unitCost: z.number().min(0).max(1_000_000),
  storageLocation: z.string().trim().max(160).nullable(),
  expiryDate: z.string().date().nullable(),
  lotNumber: z.string().trim().max(100).nullable(),
  notes: z.string().trim().max(4_000).nullable(),
});
const statusValues = [
  "in_stock",
  "low_stock",
  "out_of_stock",
  "expiring_soon",
  "expired",
] as const;
type InventoryStatus = (typeof statusValues)[number];

function decimal(value: unknown) {
  return Number(value ?? 0);
}
function dateFrom(value: string | Date | null) {
  return value
    ? value instanceof Date
      ? value
      : new Date(`${value}T00:00:00`)
    : null;
}
export function expirationStatus(
  expiryDate: Date | null,
  quantity: number
): InventoryStatus | null {
  if (!expiryDate || quantity <= 0) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = dateFrom(expiryDate);
  if (!expiry) return null;
  expiry.setHours(0, 0, 0, 0);
  const days = Math.ceil((expiry.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return "expired";
  if (days <= 7) return "expiring_soon";
  return null;
}
export function statusFor(item: {
  quantity: unknown;
  reorderLevel: unknown;
  expiryDate: Date | null;
}): InventoryStatus {
  const quantity = decimal(item.quantity);
  if (quantity <= 0) return "out_of_stock";
  const expiry = expirationStatus(item.expiryDate, quantity);
  if (expiry) return expiry;
  return quantity <= decimal(item.reorderLevel) ? "low_stock" : "in_stock";
}
async function roleFor(user: {
  id: number;
  role: "user" | "admin";
  email?: string | null;
}) {
  const role = await resolveStaffRole(user);
  if (!role)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Your staff profile is not approved for inventory access.",
    });
  return role;
}
async function requireInventory(
  user: { id: number; role: "user" | "admin"; email?: string | null },
  level: "view" | "manage" | "cost"
) {
  const role = await roleFor(user);
  if (level === "view") return role;
  if (level === "manage" && (role === "owner" || role === "manager"))
    return role;
  if (level === "cost" && role === "owner") return role;
  throw new TRPCError({
    code: "FORBIDDEN",
    message:
      level === "cost"
        ? "Only the owner can change inventory costs."
        : "Your role cannot manage this inventory workflow.",
  });
}
async function requireAdjustment(
  user: { id: number; role: "user" | "admin"; email?: string | null },
  type: string
) {
  const role = await roleFor(user);
  if (role === "staff" && type !== "waste")
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Staff can record waste but cannot make other stock adjustments.",
    });
  return role;
}

/**
 * Cap on rows pulled by the aggregate helpers.
 *
 * These endpoints answer "how healthy is our stock", not "list the catalogue", so
 * they only need a bounded window. The list views (`inventory.list`,
 * `inventory.byId`) pass their own limits or filter by id.
 */
const INVENTORY_SCAN_CAP = 2000;

async function inventoryRows(opts?: {
  outletId?: number | null;
  scope?: number[] | null;
  categoryId?: number | null;
  supplierId?: number | null;
  itemId?: number;
  limit?: number;
}) {
  const supabase = getSupabaseAdmin();

  if (opts?.scope && opts.scope.length === 0) return [];

  // Push outlet scope and simple id filters into SQL and bound the result set,
  // instead of loading every inventory item (and every batch) into memory.
  let itemsQuery: any = supabase.from("inventory_items").select("*");
  if (opts?.itemId) itemsQuery = itemsQuery.eq("id", opts.itemId);
  if (opts?.outletId) itemsQuery = itemsQuery.eq("outletId", opts.outletId);
  else if (opts?.scope && opts.scope.length) {
    itemsQuery =
      opts.scope.length === 1
        ? itemsQuery.or(`outletId.is.null,outletId.eq.${opts.scope[0]}`)
        : itemsQuery.or(
            `outletId.is.null,outletId.in.(${opts.scope.join(",")})`
          );
  }
  if (opts?.categoryId)
    itemsQuery = itemsQuery.eq("categoryId", opts.categoryId);
  if (opts?.supplierId)
    itemsQuery = itemsQuery.eq("supplierId", opts.supplierId);
  // `itemId` already bounds the result to a single row.
  itemsQuery = itemsQuery.limit(opts?.limit ?? INVENTORY_SCAN_CAP);

  const { data: items, error: itemsErr } = await itemsQuery;
  if (itemsErr)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: itemsErr.message,
    });

  const itemIds = ((items ?? []) as any[]).map(r => r.id);

  // fetch lookups for join enrichment + only the batches belonging to these items
  const [
    { data: categories },
    { data: suppliers },
    { data: outletRows },
    batchesRes,
  ] = await Promise.all([
    supabase.from("inventory_categories").select("id,name"),
    supabase.from("suppliers").select("id,name"),
    supabase.from("outlets").select("id,name"),
    itemIds.length
      ? supabase
          .from("inventory_batches")
          .select("inventoryItemId,expiryDate,quantity")
          .in("inventoryItemId", itemIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const batches: any[] = ((batchesRes as any).data ?? []).filter(
    (b: any) => decimal(b.quantity) >= 0.001
  );

  const catMap = new Map((categories ?? []).map((c: any) => [c.id, c.name]));
  const supMap = new Map((suppliers ?? []).map((s: any) => [s.id, s.name]));
  const outletMap = new Map((outletRows ?? []).map((o: any) => [o.id, o.name]));

  const filtered = (items ?? []) as any[];

  // Group batches by item once. The previous code called `batches.filter(...)`
  // inside `items.map(...)`, which is O(items × batches) — 2 000 items against
  // 10 000 batches is 20M comparisons on every aggregate endpoint.
  const batchesByItem = new Map<number, any[]>();
  for (const batch of batches) {
    if (decimal(batch.quantity) <= 0) continue;
    const list = batchesByItem.get(batch.inventoryItemId);
    if (list) list.push(batch);
    else batchesByItem.set(batch.inventoryItemId, [batch]);
  }

  return filtered.map((row: any) => {
    const itemBatches = batchesByItem.get(row.id) ?? [];
    const earliestExpiry =
      itemBatches
        .map((batch: any) => dateFrom(batch.expiryDate))
        .filter((date): date is Date => Boolean(date))
        .sort((a, b) => a.getTime() - b.getTime())[0] ??
      dateFrom(row.defaultExpiryDate);
    const quantity = decimal(row.quantity);
    const unitCost = decimal(row.unitCost);
    return {
      ...row,
      quantity,
      reorderLevel: decimal(row.reorderLevel),
      maxStockLevel:
        row.maxStockLevel === null ? null : decimal(row.maxStockLevel),
      unitCost,
      inventoryValue: quantity * unitCost,
      categoryName: row.categoryId
        ? (catMap.get(row.categoryId) ?? null)
        : null,
      supplierName: row.supplierId
        ? (supMap.get(row.supplierId) ?? null)
        : null,
      outletName: row.outletId ? (outletMap.get(row.outletId) ?? null) : null,
      expiryDate: earliestExpiry,
      status: statusFor({
        quantity,
        reorderLevel: row.reorderLevel,
        expiryDate: earliestExpiry,
      }),
    };
  });
}

async function buildStockHealth(
  rows: Awaited<ReturnType<typeof inventoryRows>>
) {
  const total = rows.filter(r => (r as any).active).length || 1;
  const healthy = rows.filter(r => r.status === "in_stock").length;
  const low = rows.filter(r => r.status === "low_stock").length;
  const critical = rows.filter(
    r => r.quantity > 0 && r.quantity <= decimal((r as any).reorderLevel) * 0.5
  ).length;
  const out = rows.filter(r => r.status === "out_of_stock").length;
  const expired = rows.filter(
    r => r.status === "expired" || r.status === "expiring_soon"
  ).length;
  return {
    total,
    healthy,
    low,
    critical,
    out,
    expired,
    pct: {
      healthy: Math.round((healthy / total) * 100),
      low: Math.round((low / total) * 100),
      critical: Math.round((critical / total) * 100),
      out: Math.round((out / total) * 100),
      expired: Math.round((expired / total) * 100),
    },
  };
}

async function itemDetail(id: number) {
  // Was `(await inventoryRows()).filter(item => item.id === id)` — an unfiltered
  // scan of up to 5 000 items plus every batch, to return exactly one row. Filter
  // by id in the query instead.
  const items = await inventoryRows({ itemId: id });
  const item = items[0];
  if (!item)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Inventory item not found.",
    });
  const supabase = getSupabaseAdmin();
  const [{ data: batches }, { data: txs }] = await Promise.all([
    supabase
      .from("inventory_batches")
      .select("*")
      .eq("inventoryItemId", id)
      .order("expiryDate", { ascending: false }),
    supabase
      .from("inventory_transactions")
      .select("*")
      .eq("inventoryItemId", id)
      .order("createdAt", { ascending: false })
      .limit(100),
  ]);
  return {
    ...item,
    batches: (batches ?? []).map((batch: any) => ({
      ...batch,
      quantity: decimal(batch.quantity),
    })),
    transactions: (txs ?? []).map((transaction: any) => ({
      ...transaction,
      quantityChange: decimal(transaction.quantityChange),
      previousQuantity: decimal(transaction.previousQuantity),
      newQuantity: decimal(transaction.newQuantity),
      unitCost:
        transaction.unitCost === null ? null : decimal(transaction.unitCost),
    })),
  };
}

export const inventoryRouter = router({
  dashboard: protectedProcedure.query(async ({ ctx }) => {
    await requireInventory(ctx.user, "view");
    const rows = await inventoryRows();
    const now = new Date();
    const inThirtyDays = new Date(now);
    inThirtyDays.setDate(now.getDate() + 30);
    const supabase = getSupabaseAdmin();
    const { data: pending, error: pendErr } = await supabase
      .from("purchase_orders")
      .select("id")
      .in("status", ["draft", "ordered", "partially_received"] as any);
    if (pendErr)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: pendErr.message,
      });
    const expiring = rows.filter(
      row =>
        row.expiryDate &&
        dateFrom(row.expiryDate)! <= inThirtyDays &&
        dateFrom(row.expiryDate)! >= new Date(now.setHours(0, 0, 0, 0))
    ).length;
    return {
      totalItems: rows.filter(row => (row as any).active).length,
      lowStock: rows.filter(row => row.status === "low_stock").length,
      outOfStock: rows.filter(row => row.status === "out_of_stock").length,
      inventoryValue: rows.reduce((sum, row) => sum + row.inventoryValue, 0),
      expiringSoon: expiring,
      pendingOrders: (pending ?? []).length,
    };
  }),
  list: protectedProcedure
    .input(
      z
        .object({
          outletId: z.number().int().positive().optional(),
          search: z.string().trim().max(160).optional(),
          categoryId: z.number().int().positive().optional(),
          supplierId: z.number().int().positive().optional(),
          status: z.enum(statusValues).optional(),
          expiry: z.enum(["any", "expiring", "expired"]).default("any"),
          includeInactive: z.boolean().default(false),
          sortBy: z
            .enum([
              "name",
              "quantity",
              "reorderLevel",
              "unitCost",
              "inventoryValue",
              "expiryDate",
              "updatedAt",
            ])
            .default("name"),
          direction: z.enum(["asc", "desc"]).default("asc"),
          limit: z.number().int().min(1).max(200).default(100),
        })
        .nullish()
    )
    .query(async ({ ctx, input }) => {
      await requireInventory(ctx.user, "view");
      const scope = await getOutletScope(ctx.user);
      if (input?.outletId) await assertOutletAccess(ctx.user, input.outletId);
      const rows = await inventoryRows({
        outletId: input?.outletId ?? null,
        scope,
        categoryId: input?.categoryId ?? null,
        supplierId: input?.supplierId ?? null,
        limit: 1000,
      });
      const normalized = input?.search?.toLowerCase();
      const filtered = rows.filter((row: any) => {
        const matchingText =
          !normalized ||
          [row.name, row.sku, row.categoryName, row.supplierName]
            .filter(Boolean)
            .some(field => String(field).toLowerCase().includes(normalized));
        return (
          matchingText &&
          (input?.includeInactive || row.active) &&
          (!input?.status || row.status === input.status) &&
          (input?.expiry !== "expiring" || row.status === "expiring_soon") &&
          (input?.expiry !== "expired" || row.status === "expired")
        );
      });
      const sortBy = input?.sortBy ?? "name";
      const multiplier = input?.direction === "desc" ? -1 : 1;
      filtered.sort((a: any, b: any) => {
        const left = a[sortBy] ?? "";
        const right = b[sortBy] ?? "";
        return (
          (typeof left === "string"
            ? String(left).localeCompare(String(right))
            : Number(left) - Number(right)) * multiplier
        );
      });
      return {
        items: filtered.slice(0, input?.limit ?? 100),
        total: filtered.length,
      };
    }),
  byId: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await requireInventory(ctx.user, "view");
      const supabase = getSupabaseAdmin();
      const { data: it } = await supabase
        .from("inventory_items")
        .select("id,outletId")
        .eq("id", input.id)
        .limit(1)
        .maybeSingle();
      if (!it)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Inventory item not found.",
        });
      await assertOutletAccess(ctx.user, (it as any).outletId ?? null);
      return itemDetail(input.id);
    }),
  categories: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      await requireInventory(ctx.user, "view");
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from("inventory_categories")
        .select("*")
        .order("name", { ascending: true });
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
          name: z.string().trim().min(2).max(120),
          description: z.string().trim().max(1_000).nullable(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requireInventory(ctx.user, "manage");
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
          .from("inventory_categories")
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
          entityType: "inventory_category",
          entityId: id,
          action: "created",
          after: input as any,
        });
        return { id };
      }),
    update: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          name: z.string().trim().min(2).max(120),
          description: z.string().trim().max(1_000).nullable(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requireInventory(ctx.user, "manage");
        const supabase = getSupabaseAdmin();
        const { data: current, error: curErr } = await supabase
          .from("inventory_categories")
          .select("*")
          .eq("id", input.id)
          .limit(1)
          .maybeSingle();
        if (curErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: curErr.message,
          });
        if (!current)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Inventory category not found.",
          });
        const { error } = await supabase
          .from("inventory_categories")
          .update({ name: input.name, description: input.description } as any)
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "inventory_category",
          entityId: input.id,
          action: "updated",
          before: current as any,
          after: input as any,
        });
        return { success: true };
      }),
    remove: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await requireInventory(ctx.user, "manage");
        const supabase = getSupabaseAdmin();
        const { data: used, error: usedErr } = await supabase
          .from("inventory_items")
          .select("id")
          .eq("categoryId", input.id)
          .limit(1);
        if (usedErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: usedErr.message,
          });
        if (used && (used as any[]).length > 0)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Reassign or deactivate the inventory items in this category before deletion.",
          });
        const { error } = await supabase
          .from("inventory_categories")
          .delete()
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "inventory_category",
          entityId: input.id,
          action: "deleted",
        });
        return { success: true };
      }),
  }),
  suppliers: router({
    list: protectedProcedure
      .input(
        z
          .object({
            search: z.string().trim().max(160).optional(),
            includeInactive: z.boolean().default(false),
          })
          .nullish()
      )
      .query(async ({ ctx, input }) => {
        await requireInventory(ctx.user, "view");
        const supabase = getSupabaseAdmin();
        const { data: rows, error } = await supabase
          .from("suppliers")
          .select("*")
          .order("name", { ascending: true });
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        const query = input?.search?.toLowerCase();
        return (rows ?? []).filter(
          (supplier: any) =>
            (input?.includeInactive || supplier.active) &&
            (!query ||
              [
                supplier.name,
                supplier.contactName,
                supplier.email,
                supplier.phone,
              ]
                .filter(Boolean)
                .some(value => String(value).toLowerCase().includes(query)))
        );
      }),
    create: protectedProcedure
      .input(
        z.object({
          name: z.string().trim().min(2).max(160),
          contactName: z.string().trim().max(160).nullable(),
          phone: z.string().trim().max(32).nullable(),
          email: z.string().trim().email().max(320).nullable(),
          address: z.string().trim().max(2_000).nullable(),
          suppliedCategories: z.array(z.number().int().positive()).max(50),
          notes: z.string().trim().max(4_000).nullable(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requireInventory(ctx.user, "manage");
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
          .from("suppliers")
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
          entityType: "supplier",
          entityId: id,
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
          contactName: z.string().trim().max(160).nullable(),
          phone: z.string().trim().max(32).nullable(),
          email: z.string().trim().email().max(320).nullable(),
          address: z.string().trim().max(2_000).nullable(),
          suppliedCategories: z.array(z.number().int().positive()).max(50),
          notes: z.string().trim().max(4_000).nullable(),
          active: z.boolean(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requireInventory(ctx.user, "manage");
        const supabase = getSupabaseAdmin();
        const { data: current, error: curErr } = await supabase
          .from("suppliers")
          .select("*")
          .eq("id", input.id)
          .limit(1)
          .maybeSingle();
        if (curErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: curErr.message,
          });
        if (!current)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Supplier not found.",
          });
        const { error } = await supabase
          .from("suppliers")
          .update(input as any)
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "supplier",
          entityId: input.id,
          action: input.active ? "updated" : "deactivated",
          before: current as any,
          after: input as any,
        });
        return { success: true };
      }),
  }),
  items: router({
    create: protectedProcedure
      .input(itemInput)
      .mutation(async ({ ctx, input }) => {
        await requireInventory(ctx.user, "manage");
        if (
          input.maxStockLevel !== null &&
          input.maxStockLevel < input.reorderLevel
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Maximum stock must be greater than the reorder level.",
          });
        const sql = await getSql();
        const id = await sql.begin(async (tx: any) => {
          const inserted = await tx.unsafe(
            `INSERT INTO "inventory_items" ("name","sku","categoryId","supplierId","description","quantity","unit","reorderLevel","maxStockLevel","unitCost","storageLocation","defaultExpiryDate","defaultLotNumber","notes") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING "id"`,
            [
              input.name,
              input.sku,
              input.categoryId,
              input.supplierId,
              input.description,
              input.quantity.toFixed(3),
              input.unit,
              input.reorderLevel.toFixed(3),
              input.maxStockLevel?.toFixed(3) ?? null,
              input.unitCost.toFixed(2),
              input.storageLocation,
              input.expiryDate
                ? new Date(`${input.expiryDate}T00:00:00`).toISOString()
                : null,
              input.lotNumber,
              input.notes,
            ]
          );
          const newId = Number(inserted[0].id);
          if (input.quantity > 0) {
            await tx.unsafe(
              `INSERT INTO "inventory_transactions" ("inventoryItemId","type","quantityChange","previousQuantity","newQuantity","unitCost","reason","notes","createdBy") VALUES ($1,'adjustment',$2,'0',$3,$4,'Opening balance',$5,$6)`,
              [
                newId,
                input.quantity.toFixed(3),
                input.quantity.toFixed(3),
                input.unitCost.toFixed(2),
                input.notes,
                ctx.user.id,
              ]
            );
            if (input.lotNumber || input.expiryDate) {
              await tx.unsafe(
                `INSERT INTO "inventory_batches" ("inventoryItemId","lotNumber","expiryDate","quantity") VALUES ($1,$2,$3,$4)`,
                [
                  newId,
                  input.lotNumber,
                  input.expiryDate
                    ? new Date(`${input.expiryDate}T00:00:00`).toISOString()
                    : null,
                  input.quantity.toFixed(3),
                ]
              );
            }
          }
          return newId;
        });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "inventory_item",
          entityId: id,
          action: "created",
          after: { ...input, quantity: input.quantity } as any,
        });
        return { id };
      }),
    update: protectedProcedure
      .input(
        itemInput.extend({
          id: z.number().int().positive(),
          active: z.boolean(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requireInventory(ctx.user, "manage");
        const supabase = getSupabaseAdmin();
        const { data: current, error: curErr } = await supabase
          .from("inventory_items")
          .select("*")
          .eq("id", input.id)
          .limit(1)
          .maybeSingle();
        if (curErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: curErr.message,
          });
        if (!current)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Inventory item not found.",
          });
        await assertOutletAccess(ctx.user, (current as any).outletId ?? null);
        if (decimal((current as any).quantity) !== input.quantity)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Use the stock adjustment or receiving flow to change quantity so the movement remains auditable.",
          });
        if (
          input.maxStockLevel !== null &&
          input.maxStockLevel < input.reorderLevel
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Maximum stock must be greater than the reorder level.",
          });
        if (decimal((current as any).unitCost) !== input.unitCost)
          await requireInventory(ctx.user, "cost");
        const { error } = await supabase
          .from("inventory_items")
          .update({
            name: input.name,
            sku: input.sku,
            categoryId: input.categoryId,
            supplierId: input.supplierId,
            description: input.description,
            reorderLevel: input.reorderLevel.toFixed(3) as any,
            maxStockLevel: (input.maxStockLevel?.toFixed(3) as any) ?? null,
            unit: input.unit,
            unitCost: input.unitCost.toFixed(2) as any,
            storageLocation: input.storageLocation,
            defaultExpiryDate: input.expiryDate
              ? (new Date(`${input.expiryDate}T00:00:00`).toISOString() as any)
              : null,
            defaultLotNumber: input.lotNumber,
            notes: input.notes,
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
          entityType: "inventory_item",
          entityId: input.id,
          action: input.active ? "updated" : "deactivated",
          before: current as any,
          after: input as any,
        });
        return { success: true };
      }),
    setActiveMany: protectedProcedure
      .input(
        z.object({
          ids: z.array(z.number().int().positive()).min(1).max(100),
          active: z.boolean(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requireInventory(ctx.user, "manage");
        const supabase = getSupabaseAdmin();
        const { data: current, error: curErr } = await supabase
          .from("inventory_items")
          .select("id,active,name,outletId")
          .in("id", input.ids);
        if (curErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: curErr.message,
          });
        if (!current || current.length !== input.ids.length)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "One or more inventory items no longer exist.",
          });
        for (const item of current as any[])
          await assertOutletAccess(ctx.user, item.outletId ?? null);
        const { error } = await supabase
          .from("inventory_items")
          .update({ active: input.active } as any)
          .in("id", input.ids);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        for (const item of current as any[])
          await recordAudit({
            actorUserId: ctx.user.id,
            entityType: "inventory_item",
            entityId: item.id,
            action: input.active ? "activated" : "deactivated",
            before: { active: item.active, name: item.name },
            after: { active: input.active },
          });
        return { count: current.length };
      }),
  }),
  adjust: protectedProcedure
    .input(
      z.object({
        itemId: z.number().int().positive(),
        type: z.enum([
          "adjustment",
          "waste",
          "correction",
          "consumption",
          "transfer",
          "return",
        ]),
        direction: z.enum(["increase", "decrease"]).optional(),
        quantity: z.number().positive().max(1_000_000),
        reason: z.string().trim().min(2).max(240),
        notes: z.string().trim().max(4_000).nullable(),
        batchId: z.number().int().positive().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireAdjustment(ctx.user, input.type);
      const delta =
        input.type === "waste" ||
        input.type === "consumption" ||
        input.type === "transfer" ||
        input.direction === "decrease"
          ? -input.quantity
          : input.quantity;
      const sql = await getSql();
      const result = await sql.begin(async (tx: any) => {
        const rows = await tx.unsafe(
          `SELECT * FROM "inventory_items" WHERE "id" = $1 LIMIT 1`,
          [input.itemId]
        );
        const item = rows[0] as any;
        if (!item)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Inventory item not found.",
          });
        await assertOutletAccess(ctx.user, item.outletId ?? null);
        const previous = decimal(item.quantity);
        const next = previous + delta;
        if (next < -0.0001)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This adjustment would make stock negative.",
          });
        if (input.batchId) {
          const batches = await tx.unsafe(
            `SELECT * FROM "inventory_batches" WHERE "id" = $1 AND "inventoryItemId" = $2 LIMIT 1`,
            [input.batchId, input.itemId]
          );
          const batch = batches[0] as any;
          if (!batch)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "The selected batch does not belong to this item.",
            });
          const batchNext = decimal(batch.quantity) + delta;
          if (batchNext < -0.0001)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "This adjustment would make the selected batch negative.",
            });
          await tx.unsafe(
            `UPDATE "inventory_batches" SET "quantity" = $1 WHERE "id" = $2`,
            [batchNext.toFixed(3), input.batchId]
          );
        }
        await tx.unsafe(
          `UPDATE "inventory_items" SET "quantity" = $1, "lastAdjustedAt" = $2 WHERE "id" = $3`,
          [next.toFixed(3), new Date().toISOString(), input.itemId]
        );
        const inserted = await tx.unsafe(
          `INSERT INTO "inventory_transactions" ("inventoryItemId","batchId","type","quantityChange","previousQuantity","newQuantity","unitCost","reason","notes","createdBy") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING "id"`,
          [
            input.itemId,
            input.batchId,
            input.type,
            delta.toFixed(3),
            previous.toFixed(3),
            next.toFixed(3),
            item.unitCost,
            input.reason,
            input.notes,
            ctx.user.id,
          ]
        );
        return { id: Number(inserted[0].id), quantity: next, previous };
      });
      await recordAudit({
        actorUserId: ctx.user.id,
        entityType: "inventory_transaction",
        entityId: result.id,
        action: input.type,
        before: { quantity: result.previous },
        after: { quantity: result.quantity, reason: input.reason },
      });
      return { id: result.id, quantity: result.quantity };
    }),
  purchaseOrders: router({
    list: protectedProcedure
      .input(
        z
          .object({
            status: z
              .enum([
                "draft",
                "ordered",
                "partially_received",
                "received",
                "cancelled",
              ])
              .optional(),
          })
          .nullish()
      )
      .query(async ({ ctx, input }) => {
        await requireInventory(ctx.user, "view");
        const supabase = getSupabaseAdmin();
        let query: any = supabase
          .from("purchase_orders")
          .select("*")
          .order("createdAt", { ascending: false });
        if (input?.status) query = query.eq("status", input.status);
        const { data: orders, error } = await query;
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        // enrich supplierName via batch fetch
        const supplierIds = Array.from(
          new Set((orders ?? []).map((o: any) => o.supplierId).filter(Boolean))
        ) as number[];
        let supMap = new Map<number, string>();
        if (supplierIds.length) {
          const { data: sups } = await supabase
            .from("suppliers")
            .select("id,name")
            .in("id", supplierIds);
          supMap = new Map((sups ?? []).map((s: any) => [s.id, s.name]));
        }
        return (orders ?? []).map((row: any) => ({
          ...row,
          subtotal: decimal(row.subtotal),
          supplierName: supMap.get(row.supplierId) ?? null,
        }));
      }),
    byId: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        await requireInventory(ctx.user, "view");
        const supabase = getSupabaseAdmin();
        const { data: header, error: hErr } = await supabase
          .from("purchase_orders")
          .select("*")
          .eq("id", input.id)
          .limit(1)
          .maybeSingle();
        if (hErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: hErr.message,
          });
        if (!header)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Purchase order not found.",
          });
        const supplierName = await supabase
          .from("suppliers")
          .select("name")
          .eq("id", (header as any).supplierId)
          .limit(1)
          .maybeSingle()
          .then((r: any) => r.data?.name ?? null);
        const { data: lines, error: lErr } = await supabase
          .from("purchase_order_lines")
          .select("*")
          .eq("purchaseOrderId", input.id);
        if (lErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: lErr.message,
          });
        // enrich item names
        const itemIds = Array.from(
          new Set((lines ?? []).map((l: any) => l.inventoryItemId))
        );
        let itemMap = new Map<number, { name: string; unit: string }>();
        if (itemIds.length) {
          const { data: items } = await supabase
            .from("inventory_items")
            .select("id,name,unit")
            .in("id", itemIds);
          itemMap = new Map(
            (items ?? []).map((it: any) => [
              it.id,
              { name: it.name, unit: it.unit },
            ])
          );
        }
        return {
          ...(header as any),
          subtotal: decimal((header as any).subtotal),
          supplierName,
          lines: (lines ?? []).map((row: any) => ({
            ...row,
            orderedQuantity: decimal(row.orderedQuantity),
            receivedQuantity: decimal(row.receivedQuantity),
            unitCost: decimal(row.unitCost),
            itemName:
              itemMap.get(row.inventoryItemId)?.name ??
              `Item #${row.inventoryItemId}`,
            unit: itemMap.get(row.inventoryItemId)?.unit ?? "",
          })),
        };
      }),
    create: protectedProcedure
      .input(
        z.object({
          poNumber: z.string().trim().min(2).max(80),
          supplierId: z.number().int().positive(),
          notes: z.string().trim().max(4_000).nullable(),
          lines: z
            .array(
              z.object({
                inventoryItemId: z.number().int().positive(),
                quantity: z.number().positive().max(1_000_000),
                unitCost: z.number().min(0).max(1_000_000),
              })
            )
            .min(1)
            .max(100),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requireInventory(ctx.user, "manage");
        const subtotal = input.lines.reduce(
          (sum, line) => sum + line.quantity * line.unitCost,
          0
        );
        const sql = await getSql();
        const orderId = await sql.begin(async (tx: any) => {
          const res = await tx.unsafe(
            `INSERT INTO "purchase_orders" ("poNumber","supplierId","notes","subtotal","createdBy") VALUES ($1,$2,$3,$4,$5) RETURNING "id"`,
            [
              input.poNumber,
              input.supplierId,
              input.notes,
              subtotal.toFixed(2),
              ctx.user.id,
            ]
          );
          const newId = Number(res[0].id);
          for (const line of input.lines) {
            await tx.unsafe(
              `INSERT INTO "purchase_order_lines" ("purchaseOrderId","inventoryItemId","orderedQuantity","unitCost") VALUES ($1,$2,$3,$4)`,
              [
                newId,
                line.inventoryItemId,
                line.quantity.toFixed(3),
                line.unitCost.toFixed(2),
              ]
            );
          }
          return newId;
        });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "purchase_order",
          entityId: orderId,
          action: "created",
          after: { poNumber: input.poNumber, subtotal } as any,
        });
        return { id: orderId };
      }),
    updateStatus: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          status: z.enum(["ordered", "cancelled"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requireInventory(ctx.user, "manage");
        const supabase = getSupabaseAdmin();
        const { data: current, error: curErr } = await supabase
          .from("purchase_orders")
          .select("*")
          .eq("id", input.id)
          .limit(1)
          .maybeSingle();
        if (curErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: curErr.message,
          });
        if (!current)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Purchase order not found.",
          });
        if (
          (current as any).status === "received" ||
          (current as any).status === "cancelled"
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This purchase order can no longer change state.",
          });
        const { error } = await supabase
          .from("purchase_orders")
          .update({
            status: input.status,
            orderedAt:
              input.status === "ordered"
                ? (new Date().toISOString() as any)
                : (current as any).orderedAt,
          } as any)
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "purchase_order",
          entityId: input.id,
          action: input.status,
          before: { status: (current as any).status },
          after: { status: input.status },
        });
        return { success: true };
      }),
    receive: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          notes: z.string().trim().max(4_000).nullable(),
          lines: z
            .array(
              z.object({
                lineId: z.number().int().positive(),
                quantity: z.number().positive().max(1_000_000),
                unitCost: z.number().min(0).max(1_000_000),
                lotNumber: z.string().trim().max(100).nullable(),
                expiryDate: z.string().date().nullable(),
              })
            )
            .min(1)
            .max(100),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requireInventory(ctx.user, "manage");
        const sql = await getSql();
        const finish = await sql.begin(async (tx: any) => {
          const header = await tx.unsafe(
            `SELECT * FROM "purchase_orders" WHERE "id" = $1 LIMIT 1`,
            [input.id]
          );
          const order = header[0] as any;
          if (!order)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Purchase order not found.",
            });
          if (order.status === "cancelled" || order.status === "received")
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "This purchase order cannot receive more stock.",
            });
          const lines = (await tx.unsafe(
            `SELECT * FROM "purchase_order_lines" WHERE "purchaseOrderId" = $1`,
            [input.id]
          )) as any[];
          for (const receipt of input.lines) {
            const line = lines.find(
              (entry: any) => entry.id === receipt.lineId
            );
            if (!line)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message:
                  "A receipt line does not belong to this purchase order.",
              });
            if (
              decimal(line.receivedQuantity) + receipt.quantity >
              decimal(line.orderedQuantity) + 0.0001
            )
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Received quantity exceeds the purchase order line.",
              });
            const itemRows = (await tx.unsafe(
              `SELECT * FROM "inventory_items" WHERE "id" = $1 LIMIT 1`,
              [line.inventoryItemId]
            )) as any[];
            const item = itemRows[0] as any;
            if (!item)
              throw new TRPCError({
                code: "NOT_FOUND",
                message:
                  "An inventory item on this purchase order no longer exists.",
              });
            const previous = decimal(item.quantity);
            const next = previous + receipt.quantity;
            await tx.unsafe(
              `UPDATE "purchase_order_lines" SET "receivedQuantity" = $1, "unitCost" = $2 WHERE "id" = $3`,
              [
                (decimal(line.receivedQuantity) + receipt.quantity).toFixed(3),
                receipt.unitCost.toFixed(2),
                line.id,
              ]
            );
            await tx.unsafe(
              `UPDATE "inventory_items" SET "quantity" = $1, "unitCost" = $2, "lastReceivedAt" = $3, "defaultExpiryDate" = $4, "defaultLotNumber" = $5 WHERE "id" = $6`,
              [
                next.toFixed(3),
                receipt.unitCost.toFixed(2),
                new Date().toISOString(),
                receipt.expiryDate
                  ? new Date(`${receipt.expiryDate}T00:00:00`).toISOString()
                  : item.defaultExpiryDate,
                receipt.lotNumber ?? item.defaultLotNumber,
                item.id,
              ]
            );
            const batch = await tx.unsafe(
              `INSERT INTO "inventory_batches" ("inventoryItemId","purchaseOrderLineId","lotNumber","expiryDate","quantity") VALUES ($1,$2,$3,$4,$5) RETURNING "id"`,
              [
                item.id,
                line.id,
                receipt.lotNumber,
                receipt.expiryDate
                  ? new Date(`${receipt.expiryDate}T00:00:00`).toISOString()
                  : null,
                receipt.quantity.toFixed(3),
              ]
            );
            const batchId = Number(batch[0].id);
            await tx.unsafe(
              `INSERT INTO "inventory_transactions" ("inventoryItemId","batchId","type","quantityChange","previousQuantity","newQuantity","unitCost","reason","referenceType","referenceId","notes","createdBy") VALUES ($1,$2,'purchase',$3,$4,$5,$6,$7,'purchase_order',$8,$9,$10)`,
              [
                item.id,
                batchId,
                receipt.quantity.toFixed(3),
                previous.toFixed(3),
                next.toFixed(3),
                receipt.unitCost.toFixed(2),
                `Received against ${order.poNumber}`,
                input.id,
                input.notes,
                ctx.user.id,
              ]
            );
          }
          const updated = (await tx.unsafe(
            `SELECT * FROM "purchase_order_lines" WHERE "purchaseOrderId" = $1`,
            [input.id]
          )) as any[];
          const fullyReceived = updated.every(
            (line: any) =>
              decimal(line.receivedQuantity) >= decimal(line.orderedQuantity)
          );
          const partiallyReceived = updated.some(
            (line: any) => decimal(line.receivedQuantity) > 0
          );
          const status = fullyReceived
            ? "received"
            : partiallyReceived
              ? "partially_received"
              : order.status;
          await tx.unsafe(
            `UPDATE "purchase_orders" SET "status" = $1, "receivedAt" = $2, "notes" = $3 WHERE "id" = $4`,
            [
              status,
              fullyReceived ? new Date().toISOString() : order.receivedAt,
              input.notes ?? order.notes,
              input.id,
            ]
          );
          return { status, previousStatus: order.status };
        });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "purchase_order",
          entityId: input.id,
          action: "received_stock",
          before: { status: finish.previousStatus },
          after: { status: finish.status, receiptLines: input.lines.length },
        });
        return { status: finish.status };
      }),
  }),
  attention: protectedProcedure.query(async ({ ctx }) => {
    await requireInventory(ctx.user, "view");
    const rows = await inventoryRows();
    const supabase = getSupabaseAdmin();
    const [{ data: pendingOrders }, { data: acknowledgements }] =
      await Promise.all([
        supabase
          .from("purchase_orders")
          .select("id,poNumber,status")
          .in("status", ["draft", "ordered", "partially_received"] as any),
        supabase.from("inventory_alert_acknowledgements").select("*"),
      ]);
    const acknowledged = new Set(
      (acknowledgements ?? []).map(
        (entry: any) => `${entry.inventoryItemId}:${entry.type}`
      )
    );
    const withAcknowledgement = (row: (typeof rows)[number]) => ({
      ...row,
      alertAcknowledged: acknowledged.has(
        `${(row as any).id}:${(row as any).status}`
      ),
    });
    return {
      lowStock: rows
        .filter(
          row => row.status === "low_stock" || row.status === "out_of_stock"
        )
        .map((row: any) => ({
          ...withAcknowledgement(row),
          suggestedQuantity: Math.max(
            (row.maxStockLevel ?? row.reorderLevel * 2) - row.quantity,
            row.reorderLevel - row.quantity,
            0
          ),
          estimatedCost:
            Math.max(
              (row.maxStockLevel ?? row.reorderLevel * 2) - row.quantity,
              row.reorderLevel - row.quantity,
              0
            ) * row.unitCost,
        })),
      expiry: rows
        .filter(
          row => row.status === "expired" || row.status === "expiring_soon"
        )
        .map(withAcknowledgement),
      pendingOrders: (pendingOrders ?? []) as any[],
    };
  }),
  acknowledgeAlert: protectedProcedure
    .input(
      z.object({
        itemId: z.number().int().positive(),
        type: z.enum(["low_stock", "out_of_stock", "expiring_soon", "expired"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireInventory(ctx.user, "manage");
      const supabase = getSupabaseAdmin();
      const { error } = await supabase
        .from("inventory_alert_acknowledgements")
        .upsert(
          {
            inventoryItemId: input.itemId,
            type: input.type,
            acknowledgedBy: ctx.user.id,
            acknowledgedAt: new Date().toISOString(),
          } as any,
          { onConflict: "inventoryItemId,type" }
        );
      if (error)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      await recordAudit({
        actorUserId: ctx.user.id,
        entityType: "inventory_alert",
        entityId: input.itemId,
        action: "acknowledged",
        after: input as any,
      });
      return { success: true };
    }),
  transactions: protectedProcedure
    .input(
      z
        .object({
          itemId: z.number().int().positive().optional(),
          type: z
            .enum([
              "purchase",
              "consumption",
              "waste",
              "adjustment",
              "correction",
              "transfer",
              "return",
            ])
            .optional(),
          limit: z.number().int().min(1).max(200).default(100),
        })
        .nullish()
    )
    .query(async ({ ctx, input }) => {
      await requireInventory(ctx.user, "view");
      const supabase = getSupabaseAdmin();
      const scope = await getOutletScope(ctx.user);
      let q: any = supabase
        .from("inventory_transactions")
        .select("*")
        .order("createdAt", { ascending: false })
        .limit(input?.limit ?? 100);
      if (input?.itemId) {
        // Verify the requested item is in scope before returning its history.
        const { data: it } = await supabase
          .from("inventory_items")
          .select("id,outletId")
          .eq("id", input.itemId)
          .limit(1)
          .maybeSingle();
        if (!it)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Inventory item not found.",
          });
        await assertOutletAccess(ctx.user, (it as any).outletId ?? null);
        q = q.eq("inventoryItemId", input.itemId);
      }
      if (input?.type) q = q.eq("type", input.type);
      const { data, error } = await q;
      if (error)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      const itemIds = Array.from(
        new Set((data ?? []).map((r: any) => r.inventoryItemId))
      ) as number[];
      let itemMap = new Map<number, any>();
      if (itemIds.length) {
        const { data: items } = await supabase
          .from("inventory_items")
          .select("id,name,unit,outletId")
          .in("id", itemIds);
        itemMap = new Map((items ?? []).map((it: any) => [it.id, it]));
      }
      let rows = (data ?? []) as any[];
      if (scope !== null && scope.length) {
        rows = rows.filter((t: any) => {
          const it = itemMap.get(t.inventoryItemId);
          return it && it.outletId !== null && scope.includes(it.outletId);
        });
      }
      return rows.map((transaction: any) => ({
        ...transaction,
        itemName:
          itemMap.get(transaction.inventoryItemId)?.name ??
          `Item #${transaction.inventoryItemId}`,
        unit: itemMap.get(transaction.inventoryItemId)?.unit ?? "",
        quantityChange: decimal(transaction.quantityChange),
        previousQuantity: decimal(transaction.previousQuantity),
        newQuantity: decimal(transaction.newQuantity),
        unitCost:
          transaction.unitCost === null ? null : decimal(transaction.unitCost),
      }));
    }),

  /* ── Café-grade overview ── */
  overview: protectedProcedure
    .input(
      z.object({ outletId: z.number().int().positive().optional() }).nullish()
    )
    .query(async ({ ctx, input }) => {
      await requireInventory(ctx.user, "view");
      const supabase = getSupabaseAdmin();
      const scope = await getOutletScope(ctx.user);
      if (input?.outletId) await assertOutletAccess(ctx.user, input.outletId);
      const outletId = input?.outletId ?? null;
      const rows = await inventoryRows({ outletId, scope });
      const now = new Date();
      const inThirtyDays = new Date(now);
      inThirtyDays.setDate(now.getDate() + 30);
      const { data: pending } = await supabase
        .from("purchase_orders")
        .select("id")
        .in("status", ["draft", "ordered", "partially_received"] as any);
      const expiring = rows.filter(
        row =>
          row.expiryDate &&
          dateFrom(row.expiryDate)! <= inThirtyDays &&
          dateFrom(row.expiryDate)! >= new Date(now.setHours(0, 0, 0, 0))
      ).length;
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      let wastageValue: number | null = 0;
      try {
        const { data: wastages } = await supabase
          .from("wastage_records")
          .select("*")
          .gte("createdAt", monthStart.toISOString());
        let filtered = (wastages ?? []) as any[];
        if (outletId)
          filtered = filtered.filter((w: any) => w.outletId === outletId);
        else if (scope && scope.length)
          filtered = filtered.filter(
            (w: any) => !w.outletId || scope.includes(w.outletId)
          );
        wastageValue = filtered.reduce(
          (sum: number, w: any) => sum + Number(w.estimatedCost ?? 0),
          0
        );
      } catch (e) {
        // Previously this fell back to `expiredCount * 120`, which reported a
        // made-up rupee figure as a real KPI. A wastage value we cannot compute is
        // unknown, not zero and not invented — surface null so the UI can say so.
        wastageValue = null;
        console.warn(
          "[inventory.overview] wastage value unavailable:",
          (e as Error)?.message ?? e
        );
      }
      let pendingTransfers = 0;
      try {
        const { data: transfers } = await supabase
          .from("stock_transfers")
          .select("id")
          .in("status", ["requested", "approved", "in_transit"] as any);
        pendingTransfers = (transfers ?? []).length;
      } catch {
        pendingTransfers = 0;
      }
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      let consumedToday = 0;
      try {
        const { data: todayTx } = await supabase
          .from("inventory_transactions")
          .select("id")
          .eq("type", "consumption")
          .gte("createdAt", todayStart.toISOString());
        consumedToday = (todayTx ?? []).length;
      } catch {}
      return {
        totalMaterials: rows.filter(row => (row as any).active).length,
        lowStock: rows.filter(row => row.status === "low_stock").length,
        critical: rows.filter(
          r =>
            r.quantity > 0 &&
            r.quantity <= decimal((r as any).reorderLevel) * 0.5
        ).length,
        outOfStock: rows.filter(row => row.status === "out_of_stock").length,
        pendingPurchases: (pending ?? []).length,
        stockValue: rows.reduce((sum, row) => sum + row.inventoryValue, 0),
        wastageThisMonth: wastageValue,
        expiringSoon: expiring,
        pendingTransfers,
        consumedToday,
      };
    }),
  stockHealth: protectedProcedure
    .input(
      z.object({ outletId: z.number().int().positive().optional() }).nullish()
    )
    .query(async ({ ctx, input }) => {
      await requireInventory(ctx.user, "view");
      const scope = await getOutletScope(ctx.user);
      if (input?.outletId) await assertOutletAccess(ctx.user, input.outletId);
      const rows = await inventoryRows({
        outletId: input?.outletId ?? null,
        scope,
      });
      return buildStockHealth(rows);
    }),
  lowStock: protectedProcedure
    .input(
      z
        .object({
          outletId: z.number().int().positive().optional(),
          limit: z.number().int().min(1).max(50).default(10),
        })
        .nullish()
    )
    .query(async ({ ctx, input }) => {
      await requireInventory(ctx.user, "view");
      const supabase = getSupabaseAdmin();
      const scope = await getOutletScope(ctx.user);
      if (input?.outletId) await assertOutletAccess(ctx.user, input.outletId);
      const rows = await inventoryRows({
        outletId: input?.outletId ?? null,
        scope,
      });
      const low = rows
        .filter(
          r =>
            r.status === "low_stock" ||
            r.status === "out_of_stock" ||
            r.status === "expired"
        )
        .sort((a, b) => a.quantity - b.quantity)
        .slice(0, input?.limit ?? 10);
      const { data: acks } = await supabase
        .from("inventory_alert_acknowledgements")
        .select("*");
      const ackSet = new Set(
        ((acks ?? []) as any[]).map(
          (e: any) => `${e.inventoryItemId}:${e.type}`
        )
      );
      return low.map((r: any) => ({
        ...r,
        alertAcknowledged: ackSet.has(`${r.id}:${r.status}`),
      }));
    }),
  outletStock: protectedProcedure
    .input(z.object({ materialId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await requireInventory(ctx.user, "view");
      const supabase = getSupabaseAdmin();
      const scope = await getOutletScope(ctx.user);
      const { data: material, error: mErr } = await supabase
        .from("inventory_items")
        .select("*")
        .eq("id", input.materialId)
        .limit(1)
        .maybeSingle();
      if (mErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: mErr.message,
        });
      if (!material)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Material not found.",
        });
      const sku = (material as any).sku;
      const { data: all, error: aErr } = await supabase
        .from("inventory_items")
        .select(
          "id,outletId,quantity,unit,reorderLevel,defaultExpiryDate,name,sku"
        )
        .eq("sku", sku);
      if (aErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: aErr.message,
        });
      // enrich outlet names
      const outletIds = Array.from(
        new Set((all ?? []).map((r: any) => r.outletId).filter(Boolean))
      );
      let outletMap = new Map<number, string>();
      if (outletIds.length) {
        const { data: outlets } = await supabase
          .from("outlets")
          .select("id,name")
          .in("id", outletIds);
        outletMap = new Map((outlets ?? []).map((o: any) => [o.id, o.name]));
      }
      let filtered = (all ?? []) as any[];
      if (scope && scope.length)
        filtered = filtered.filter(
          (r: any) =>
            r.outletId === null || scope.includes(r.outletId as number)
        );
      return filtered.map((r: any) => ({
        outletId: r.outletId,
        outletName: r.outletId
          ? (outletMap.get(r.outletId) ?? `Outlet #${r.outletId}`)
          : "Global",
        quantity: decimal(r.quantity),
        unit: r.unit,
        status: statusFor({
          quantity: r.quantity,
          reorderLevel: r.reorderLevel,
          expiryDate: dateFrom(r.defaultExpiryDate),
        }),
      }));
    }),

  preparedItems: router({
    list: protectedProcedure
      .input(
        z
          .object({
            outletId: z.number().int().positive().optional(),
            search: z.string().trim().max(160).optional(),
            status: z
              .enum(["healthy", "low_stock", "out_of_stock", "expired"])
              .optional(),
            limit: z.number().int().min(1).max(100).default(50),
          })
          .nullish()
      )
      .query(async ({ ctx, input }) => {
        await requireInventory(ctx.user, "view");
        const supabase = getSupabaseAdmin();
        const scope = await getOutletScope(ctx.user);
        if (input?.outletId) await assertOutletAccess(ctx.user, input.outletId);
        let rows: any[] = [];
        try {
          const { data, error } = await supabase
            .from("prepared_items")
            .select("*")
            .order("updatedAt", { ascending: false });
          if (error) throw error;
          // enrich category/outlet names
          const catIds = Array.from(
            new Set((data ?? []).map((r: any) => r.categoryId).filter(Boolean))
          );
          const outletIds = Array.from(
            new Set((data ?? []).map((r: any) => r.outletId).filter(Boolean))
          ) as number[];
          let catMap = new Map<number, string>();
          let outletMap = new Map<number, string>();
          if (catIds.length) {
            const { data: cats } = await supabase
              .from("inventory_categories")
              .select("id,name")
              .in("id", catIds);
            catMap = new Map((cats ?? []).map((c: any) => [c.id, c.name]));
          }
          if (outletIds.length) {
            const { data: outs } = await supabase
              .from("outlets")
              .select("id,name")
              .in("id", outletIds);
            outletMap = new Map((outs ?? []).map((o: any) => [o.id, o.name]));
          }
          rows = (data ?? []).map((r: any) => ({
            item: r,
            categoryName: r.categoryId
              ? (catMap.get(r.categoryId) ?? null)
              : null,
            outletName: r.outletId ? (outletMap.get(r.outletId) ?? null) : null,
          }));
        } catch {
          rows = [];
        }
        let filtered = rows.map((r: any) => ({
          ...r.item,
          categoryName: r.categoryName,
          outletName: r.outletName,
          quantity: decimal(r.item.quantity),
          minQuantity: decimal(r.item.minQuantity),
          unitCost: decimal(r.item.unitCost),
          status:
            decimal(r.item.quantity) <= 0
              ? ("out_of_stock" as const)
              : decimal(r.item.quantity) <= decimal(r.item.minQuantity)
                ? ("low_stock" as const)
                : ("healthy" as const),
        }));
        if (input?.outletId)
          filtered = filtered.filter(
            r => (r as any).outletId === input.outletId
          );
        else if (scope && scope.length)
          filtered = filtered.filter(
            r => !(r as any).outletId || scope.includes((r as any).outletId)
          );
        if (input?.search) {
          const q = input.search.toLowerCase();
          filtered = filtered.filter((r: any) =>
            [r.name, r.sku, r.categoryName]
              .filter(Boolean)
              .some((f: string) => String(f).toLowerCase().includes(q))
          );
        }
        if (input?.status)
          filtered = filtered.filter(r => r.status === input.status);
        return filtered.slice(0, input?.limit ?? 50);
      }),
    create: protectedProcedure
      .input(
        z.object({
          outletId: z.number().int().positive().nullable(),
          categoryId: z.number().int().positive().nullable(),
          name: z.string().trim().min(2).max(160),
          sku: z.string().trim().min(2).max(80),
          description: z.string().trim().max(2000).nullable(),
          quantity: z.number().min(0).max(1000000).default(0),
          unit: z.enum(units),
          minQuantity: z.number().min(0).max(1000000).default(0),
          maxStockLevel: z.number().positive().max(1000000).nullable(),
          shelfLifeHours: z.number().int().min(1).max(720).nullable(),
          unitCost: z.number().min(0).max(1000000).default(0),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requireInventory(ctx.user, "manage");
        if (input.outletId) await assertOutletAccess(ctx.user, input.outletId);
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
          .from("prepared_items")
          .insert({
            outletId: input.outletId,
            categoryId: input.categoryId,
            name: input.name,
            sku: input.sku,
            description: input.description,
            quantity: input.quantity.toFixed(3) as any,
            unit: input.unit,
            minQuantity: input.minQuantity.toFixed(3) as any,
            maxStockLevel: (input.maxStockLevel?.toFixed(3) as any) ?? null,
            shelfLifeHours: input.shelfLifeHours,
            unitCost: input.unitCost.toFixed(2) as any,
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
          entityType: "prepared_item",
          entityId: id,
          outletId: input.outletId ?? null,
          action: "created",
          after: input as any,
        });
        return { id };
      }),
    batches: router({
      list: protectedProcedure
        .input(z.object({ preparedItemId: z.number().int().positive() }))
        .query(async ({ ctx, input }) => {
          await requireInventory(ctx.user, "view");
          const supabase = getSupabaseAdmin();
          try {
            const { data, error } = await supabase
              .from("prepared_item_batches")
              .select("*")
              .eq("preparedItemId", input.preparedItemId)
              .order("producedAt", { ascending: false });
            if (error) throw error;
            return (data ?? []) as any[];
          } catch {
            return [];
          }
        }),
      produce: protectedProcedure
        .input(
          z.object({
            preparedItemId: z.number().int().positive(),
            outletId: z.number().int().positive().nullable(),
            quantity: z.number().positive().max(100000),
            preparedBy: z.number().int().positive().optional(),
          })
        )
        .mutation(async ({ ctx, input }) => {
          await requireInventory(ctx.user, "manage");
          await assertOutletAccess(ctx.user, input.outletId);
          const supabase = getSupabaseAdmin();
          const { data: item, error: iErr } = await supabase
            .from("prepared_items")
            .select("*")
            .eq("id", input.preparedItemId)
            .limit(1)
            .maybeSingle();
          if (iErr)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: iErr.message,
            });
          if (!item)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Prepared item not found.",
            });
          const batchNumber = `PD-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${Math.floor(Math.random() * 9000 + 1000)}`;
          const shelf = (item as any).shelfLifeHours ?? 24;
          const expiresAt = new Date(Date.now() + shelf * 3600 * 1000);
          const sql = await getSql();
          const next = await sql.begin(async (tx: any) => {
            await tx.unsafe(
              `INSERT INTO "prepared_item_batches" ("preparedItemId","outletId","batchNumber","quantity","remaining","expiresAt","preparedBy") VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [
                input.preparedItemId,
                input.outletId,
                batchNumber,
                input.quantity.toFixed(3),
                input.quantity.toFixed(3),
                expiresAt.toISOString(),
                ctx.user.id,
              ]
            );
            const prev = decimal((item as any).quantity);
            const updated = prev + input.quantity;
            await tx.unsafe(
              `UPDATE "prepared_items" SET "quantity" = $1, "lastPreparedAt" = $2 WHERE "id" = $3`,
              [
                updated.toFixed(3),
                new Date().toISOString(),
                input.preparedItemId,
              ]
            );
            await tx.unsafe(
              `INSERT INTO "inventory_transactions" ("inventoryItemId","type","quantityChange","previousQuantity","newQuantity","reason","createdBy") VALUES ($1,'adjustment',$2,$3,$4,'Prepared batch produced',$5)`,
              [
                input.preparedItemId,
                input.quantity.toFixed(3),
                prev.toFixed(3),
                updated.toFixed(3),
                ctx.user.id,
              ]
            );
            return updated;
          });
          await recordAudit({
            actorUserId: ctx.user.id,
            entityType: "prepared_item_batch",
            action: "produced",
            after: {
              preparedItemId: input.preparedItemId,
              quantity: input.quantity,
              batchNumber,
            } as any,
          });
          return { batchNumber, quantity: next };
        }),
    }),
  }),

  recipes: router({
    list: protectedProcedure
      .input(
        z
          .object({
            search: z.string().trim().max(160).optional(),
            outletId: z.number().int().positive().optional(),
            status: z.enum(["draft", "active", "archived"]).optional(),
          })
          .nullish()
      )
      .query(async ({ ctx, input }) => {
        await requireInventory(ctx.user, "view");
        const supabase = getSupabaseAdmin();
        const scope = await getOutletScope(ctx.user);
        if (input?.outletId) await assertOutletAccess(ctx.user, input.outletId);
        let rows: any[] = [];
        try {
          const { data, error } = await supabase
            .from("recipes")
            .select("*")
            .order("updatedAt", { ascending: false });
          if (error) throw error;
          const menuIds = Array.from(
            new Set((data ?? []).map((r: any) => r.menuItemId).filter(Boolean))
          );
          let menuMap = new Map<number, string>();
          if (menuIds.length) {
            const { data: menus } = await supabase
              .from("menu_items")
              .select("id,name")
              .in("id", menuIds);
            menuMap = new Map((menus ?? []).map((m: any) => [m.id, m.name]));
          }
          rows = (data ?? []).map((r: any) => ({
            recipe: r,
            menuItemName: r.menuItemId
              ? (menuMap.get(r.menuItemId) ?? null)
              : null,
          }));
        } catch {
          rows = [];
        }
        let filtered = rows.map((r: any) => ({
          ...r.recipe,
          menuItemName: r.menuItemName,
          estimatedCost: decimal(r.recipe.estimatedCost),
          yieldQuantity: decimal(r.recipe.yieldQuantity),
        }));
        if (input?.outletId)
          filtered = filtered.filter(
            (r: any) => !r.outletId || r.outletId === input.outletId
          );
        else if (scope && scope.length)
          filtered = filtered.filter(
            (r: any) => !r.outletId || scope.includes(r.outletId)
          );
        if (input?.search) {
          const q = input.search.toLowerCase();
          filtered = filtered.filter((r: any) =>
            [r.name, r.menuItemName]
              .filter(Boolean)
              .some((f: string) => String(f).toLowerCase().includes(q))
          );
        }
        if (input?.status)
          filtered = filtered.filter((r: any) => r.status === input.status);
        const { data: allComps } = await supabase
          .from("recipe_components")
          .select("*");
        return filtered.map((r: any) => ({
          ...r,
          ingredientsCount: (allComps ?? []).filter(
            (c: any) => c.recipeId === r.id
          ).length,
        }));
      }),
    byId: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        await requireInventory(ctx.user, "view");
        const supabase = getSupabaseAdmin();
        const { data: rec, error: rErr } = await supabase
          .from("recipes")
          .select("*")
          .eq("id", input.id)
          .limit(1)
          .maybeSingle();
        if (rErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: rErr.message,
          });
        if (!rec)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Recipe not found.",
          });
        await assertOutletAccess(ctx.user, (rec as any).outletId ?? null);
        let menuItemName: string | null = null;
        let menuItemPrice: number | null = null;
        if ((rec as any).variantId) {
          const { data: v } = await supabase
            .from("menu_item_variants")
            .select("price")
            .eq("id", (rec as any).variantId)
            .limit(1)
            .maybeSingle();
          menuItemPrice =
            (v as any)?.price != null ? decimal((v as any).price) : null;
          if ((rec as any).menuItemId) {
            const { data: mi } = await supabase
              .from("menu_items")
              .select("name")
              .eq("id", (rec as any).menuItemId)
              .limit(1)
              .maybeSingle();
            menuItemName = (mi as any)?.name ?? null;
          }
        } else if ((rec as any).menuItemId) {
          const { data: mi } = await supabase
            .from("menu_items")
            .select("name")
            .eq("id", (rec as any).menuItemId)
            .limit(1)
            .maybeSingle();
          menuItemName = (mi as any)?.name ?? null;
          const { data: vs } = await supabase
            .from("menu_item_variants")
            .select("price")
            .eq("menuItemId", (rec as any).menuItemId)
            .order("sortOrder")
            .limit(1);
          menuItemPrice =
            (vs as any)?.[0]?.price != null
              ? decimal((vs as any)[0].price)
              : null;
        }
        const { data: comps, error: cErr } = await supabase
          .from("recipe_components")
          .select("*")
          .eq("recipeId", input.id);
        if (cErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: cErr.message,
          });
        const enriched = await Promise.all(
          (comps ?? []).map(async (c: any) => {
            let name = `Component #${c.componentId}`;
            try {
              if (c.componentType === "material") {
                const { data: m } = await supabase
                  .from("inventory_items")
                  .select("name")
                  .eq("id", c.componentId)
                  .limit(1)
                  .maybeSingle();
                name = (m as any)?.name ?? name;
              } else {
                const { data: p } = await supabase
                  .from("prepared_items")
                  .select("name")
                  .eq("id", c.componentId)
                  .limit(1)
                  .maybeSingle();
                name = (p as any)?.name ?? name;
              }
            } catch {}
            return { ...c, quantity: decimal(c.quantity), name };
          })
        );
        return {
          ...(rec as any),
          menuItemName,
          menuItemPrice,
          estimatedCost: decimal((rec as any).estimatedCost),
          yieldQuantity: decimal((rec as any).yieldQuantity),
          components: enriched,
        };
      }),
    create: protectedProcedure
      .input(
        z.object({
          name: z.string().trim().min(2).max(160),
          menuItemId: z.number().int().positive().nullable(),
          variantId: z.number().int().positive().nullable().optional(),
          outletId: z.number().int().positive().nullable(),
          yieldQuantity: z.number().positive().max(100000).default(1),
          yieldUnit: z.string().trim().max(24).default("unit"),
          status: z.enum(["draft", "active", "archived"]).default("active"),
          components: z
            .array(
              z.object({
                componentType: z.enum(["material", "prepared_item"]),
                componentId: z.number().int().positive(),
                quantity: z.number().positive().max(1000000),
                unit: z.string().trim().max(24),
              })
            )
            .min(1)
            .max(30),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requireInventory(ctx.user, "manage");
        if (input.outletId) await assertOutletAccess(ctx.user, input.outletId);
        const supabase = getSupabaseAdmin();
        if (input.variantId) {
          const { data: v, error: vErr } = await supabase
            .from("menu_item_variants")
            .select("id,menuItemId")
            .eq("id", input.variantId)
            .limit(1)
            .maybeSingle();
          if (vErr)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: vErr.message,
            });
          if (!v)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Variant not found.",
            });
          if (
            input.menuItemId &&
            Number((v as any).menuItemId) !== Number(input.menuItemId)
          )
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Variant does not belong to the selected product.",
            });
        }
        let cost = 0;
        for (const c of input.components) {
          try {
            if (c.componentType === "material") {
              const { data: m } = await supabase
                .from("inventory_items")
                .select("unitCost")
                .eq("id", c.componentId)
                .limit(1)
                .maybeSingle();
              cost += decimal((m as any)?.unitCost ?? 0) * c.quantity;
            } else {
              const { data: p } = await supabase
                .from("prepared_items")
                .select("unitCost")
                .eq("id", c.componentId)
                .limit(1)
                .maybeSingle();
              cost += decimal((p as any)?.unitCost ?? 0) * c.quantity;
            }
          } catch {}
        }
        const { data: res, error } = await supabase
          .from("recipes")
          .insert({
            name: input.name,
            menuItemId: input.menuItemId as any,
            variantId: input.variantId ?? (null as any),
            outletId: input.outletId as any,
            yieldQuantity: input.yieldQuantity.toFixed(3) as any,
            yieldUnit: input.yieldUnit,
            estimatedCost: cost.toFixed(2) as any,
            status: input.status,
            version: 1,
            createdBy: ctx.user.id,
          } as any)
          .select("id")
          .single();
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        const id = Number((res as any).id);
        const { error: compErr } = await supabase
          .from("recipe_components")
          .insert(
            input.components.map(
              c =>
                ({
                  recipeId: id,
                  componentType: c.componentType,
                  componentId: c.componentId,
                  quantity: c.quantity.toFixed(3) as any,
                  unit: c.unit,
                }) as any
            )
          );
        if (compErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: compErr.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "recipe",
          entityId: id,
          outletId: input.outletId ?? null,
          action: "created",
          after: {
            name: input.name,
            components: input.components.length,
            cost,
          } as any,
        });
        return { id, estimatedCost: cost };
      }),
    update: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          name: z.string().trim().min(2).max(160),
          yieldQuantity: z.number().positive().max(100000),
          yieldUnit: z.string().trim().max(24),
          status: z.enum(["draft", "active", "archived"]),
          variantId: z.number().int().positive().nullable().optional(),
          components: z
            .array(
              z.object({
                componentType: z.enum(["material", "prepared_item"]),
                componentId: z.number().int().positive(),
                quantity: z.number().positive().max(1000000),
                unit: z.string().trim().max(24),
              })
            )
            .min(1)
            .max(30),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requireInventory(ctx.user, "manage");
        const supabase = getSupabaseAdmin();
        const { data: cur, error: curErr } = await supabase
          .from("recipes")
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
            message: "Recipe not found.",
          });
        await assertOutletAccess(ctx.user, (cur as any).outletId ?? null);
        let cost = 0;
        for (const c of input.components) {
          try {
            if (c.componentType === "material") {
              const { data: m } = await supabase
                .from("inventory_items")
                .select("unitCost")
                .eq("id", c.componentId)
                .limit(1)
                .maybeSingle();
              cost += decimal((m as any)?.unitCost ?? 0) * c.quantity;
            } else {
              const { data: p } = await supabase
                .from("prepared_items")
                .select("unitCost")
                .eq("id", c.componentId)
                .limit(1)
                .maybeSingle();
              cost += decimal((p as any)?.unitCost ?? 0) * c.quantity;
            }
          } catch {}
        }
        const { error: updErr } = await supabase
          .from("recipes")
          .update({
            name: input.name,
            variantId: input.variantId ?? ((cur as any).variantId as any),
            yieldQuantity: input.yieldQuantity.toFixed(3) as any,
            yieldUnit: input.yieldUnit,
            estimatedCost: cost.toFixed(2) as any,
            status: input.status,
            version: (cur as any).version + 1,
          } as any)
          .eq("id", input.id);
        if (updErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: updErr.message,
          });
        await supabase
          .from("recipe_components")
          .delete()
          .eq("recipeId", input.id);
        const { error: insErr } = await supabase
          .from("recipe_components")
          .insert(
            input.components.map(
              c =>
                ({
                  recipeId: input.id,
                  componentType: c.componentType,
                  componentId: c.componentId,
                  quantity: c.quantity.toFixed(3) as any,
                  unit: c.unit,
                }) as any
            )
          );
        if (insErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: insErr.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "recipe",
          entityId: input.id,
          action: "updated",
          before: { version: (cur as any).version },
          after: { version: (cur as any).version + 1, cost } as any,
        });
        return { success: true, estimatedCost: cost };
      }),
    remove: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await requireInventory(ctx.user, "manage");
        const supabase = getSupabaseAdmin();
        const { data: cur, error: curErr } = await supabase
          .from("recipes")
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
            message: "Recipe not found.",
          });
        await assertOutletAccess(ctx.user, (cur as any).outletId ?? null);
        const { error } = await supabase
          .from("recipes")
          .delete()
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "recipe",
          entityId: input.id,
          action: "deleted",
        });
        return { success: true };
      }),
  }),

  variantIngredients: router({
    byVariant: protectedProcedure
      .input(z.object({ variantId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        await requireInventory(ctx.user, "view");
        const supabase = getSupabaseAdmin();
        const { data: v, error: vErr } = await supabase
          .from("menu_item_variants")
          .select("id")
          .eq("id", input.variantId)
          .limit(1)
          .maybeSingle();
        if (vErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: vErr.message,
          });
        if (!v)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Variant not found.",
          });
        const { data: rows, error } = await supabase
          .from("menu_variant_ingredients")
          .select("*")
          .eq("variantId", input.variantId);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        const itemIds = Array.from(
          new Set((rows ?? []).map((r: any) => r.inventoryItemId))
        );
        let itemMap = new Map<number, any>();
        if (itemIds.length) {
          const { data: items } = await supabase
            .from("inventory_items")
            .select("id,name,unit")
            .in("id", itemIds);
          itemMap = new Map((items ?? []).map((it: any) => [it.id, it]));
        }
        return (rows ?? []).map((r: any) => ({
          ...r,
          quantityPerSale: decimal(r.quantityPerSale),
          itemName:
            itemMap.get(r.inventoryItemId)?.name ??
            `Item #${r.inventoryItemId}`,
          unit: itemMap.get(r.inventoryItemId)?.unit ?? "",
        }));
      }),
    set: protectedProcedure
      .input(
        z.object({
          variantId: z.number().int().positive(),
          ingredients: z
            .array(
              z.object({
                inventoryItemId: z.number().int().positive(),
                quantityPerSale: z.number().positive().max(1000000),
              })
            )
            .max(50),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requireInventory(ctx.user, "manage");
        const supabase = getSupabaseAdmin();
        const { data: v, error: vErr } = await supabase
          .from("menu_item_variants")
          .select("id")
          .eq("id", input.variantId)
          .limit(1)
          .maybeSingle();
        if (vErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: vErr.message,
          });
        if (!v)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Variant not found.",
          });
        const { error: delErr } = await supabase
          .from("menu_variant_ingredients")
          .delete()
          .eq("variantId", input.variantId);
        if (delErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: delErr.message,
          });
        if (input.ingredients.length) {
          const { error: insErr } = await supabase
            .from("menu_variant_ingredients")
            .insert(
              input.ingredients.map(
                it =>
                  ({
                    variantId: input.variantId,
                    inventoryItemId: it.inventoryItemId,
                    quantityPerSale: it.quantityPerSale.toFixed(3) as any,
                  }) as any
              )
            );
          if (insErr)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: insErr.message,
            });
        }
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "menu_variant_ingredients",
          entityId: input.variantId,
          action: "updated",
          after: {
            variantId: input.variantId,
            count: input.ingredients.length,
          } as any,
        });
        return { success: true };
      }),
  }),

  transfers: router({
    list: protectedProcedure
      .input(
        z
          .object({
            outletId: z.number().int().positive().optional(),
            status: z
              .enum([
                "draft",
                "requested",
                "approved",
                "in_transit",
                "received",
                "rejected",
                "cancelled",
              ])
              .optional(),
          })
          .nullish()
      )
      .query(async ({ ctx, input }) => {
        await requireInventory(ctx.user, "view");
        const supabase = getSupabaseAdmin();
        const scope = await getOutletScope(ctx.user);
        if (input?.outletId) await assertOutletAccess(ctx.user, input.outletId);
        let query: any = supabase
          .from("stock_transfers")
          .select("*")
          .order("createdAt", { ascending: false });
        if (input?.status) query = query.eq("status", input.status);
        const { data: rows, error } = await query;
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        let filtered = (rows ?? []) as any[];
        if (input?.outletId)
          filtered = filtered.filter(
            (t: any) =>
              t.fromOutletId === input.outletId ||
              t.toOutletId === input.outletId
          );
        else if (scope && scope.length)
          filtered = filtered.filter(
            (t: any) =>
              scope.includes(t.fromOutletId) || scope.includes(t.toOutletId)
          );
        const ids = filtered.map((t: any) => t.id);
        const itemCounts = new Map<number, number>();
        if (ids.length) {
          const { data: items } = await supabase
            .from("stock_transfer_items")
            .select("transferId")
            .in("transferId", ids);
          for (const it of (items ?? []) as any[])
            itemCounts.set(
              it.transferId,
              (itemCounts.get(it.transferId) ?? 0) + 1
            );
        }
        return filtered.map((t: any) => ({
          ...t,
          itemsCount: itemCounts.get(t.id) ?? 0,
        }));
      }),
    create: protectedProcedure
      .input(
        z.object({
          fromOutletId: z.number().int().positive(),
          toOutletId: z.number().int().positive(),
          notes: z.string().trim().max(2000).nullable(),
          items: z
            .array(
              z.object({
                inventoryItemId: z.number().int().positive().nullable(),
                preparedItemId: z.number().int().positive().nullable(),
                quantity: z.number().positive().max(1000000),
              })
            )
            .min(1)
            .max(50),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requireInventory(ctx.user, "manage");
        await assertOutletAccess(ctx.user, input.fromOutletId);
        await assertOutletAccess(ctx.user, input.toOutletId);
        if (input.fromOutletId === input.toOutletId)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Source and destination outlets must differ.",
          });
        const transferNumber = `TR-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${Math.floor(Math.random() * 9000 + 1000)}`;
        const sql = await getSql();
        const transferId = await sql.begin(async (tx: any) => {
          const res = await tx.unsafe(
            `INSERT INTO "stock_transfers" ("transferNumber","fromOutletId","toOutletId","status","notes","createdBy") VALUES ($1,$2,$3,'requested',$4,$5) RETURNING "id"`,
            [
              transferNumber,
              input.fromOutletId,
              input.toOutletId,
              input.notes,
              ctx.user.id,
            ]
          );
          const newId = Number(res[0].id);
          for (const it of input.items) {
            await tx.unsafe(
              `INSERT INTO "stock_transfer_items" ("transferId","inventoryItemId","preparedItemId","quantity") VALUES ($1,$2,$3,$4)`,
              [
                newId,
                it.inventoryItemId,
                it.preparedItemId,
                it.quantity.toFixed(3),
              ]
            );
          }
          return newId;
        });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "stock_transfer",
          entityId: transferId,
          outletId: input.fromOutletId,
          action: "created",
          after: { transferNumber, items: input.items.length } as any,
        });
        return { id: transferId, transferNumber };
      }),
    updateStatus: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          status: z.enum([
            "approved",
            "in_transit",
            "received",
            "rejected",
            "cancelled",
          ]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requireInventory(ctx.user, "manage");
        const supabase = getSupabaseAdmin();
        const { data: cur, error: curErr } = await supabase
          .from("stock_transfers")
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
            message: "Transfer not found.",
          });
        await assertOutletAccess(ctx.user, (cur as any).fromOutletId);
        await assertOutletAccess(ctx.user, (cur as any).toOutletId);
        if (
          (cur as any).status === "received" ||
          (cur as any).status === "cancelled" ||
          (cur as any).status === "rejected"
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Transfer already closed.",
          });
        if (input.status === "received") {
          const { data: items } = await supabase
            .from("stock_transfer_items")
            .select("*")
            .eq("transferId", input.id);
          const sql = await getSql();
          await sql.begin(async (tx: any) => {
            for (const it of (items ?? []) as any[]) {
              if (it.inventoryItemId) {
                const fromRows = (await tx.unsafe(
                  `SELECT * FROM "inventory_items" WHERE "id" = $1 AND "outletId" = $2 LIMIT 1`,
                  [it.inventoryItemId, (cur as any).fromOutletId]
                )) as any[];
                let fromItem = fromRows[0] as any;
                if (!fromItem) {
                  const base = (await tx.unsafe(
                    `SELECT * FROM "inventory_items" WHERE "id" = $1 LIMIT 1`,
                    [it.inventoryItemId]
                  )) as any[];
                  if (!base[0])
                    throw new TRPCError({
                      code: "NOT_FOUND",
                      message: "Material not found for transfer.",
                    });
                  fromItem = base[0];
                }
                const prevFrom = decimal(fromItem.quantity);
                const qty = decimal(it.quantity);
                if (prevFrom < qty - 0.001)
                  throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: `${fromItem.name} insufficient stock in source outlet.`,
                  });
                await tx.unsafe(
                  `UPDATE "inventory_items" SET "quantity" = $1 WHERE "id" = $2`,
                  [(prevFrom - qty).toFixed(3), fromItem.id]
                );
                await tx.unsafe(
                  `INSERT INTO "inventory_transactions" ("inventoryItemId","type","quantityChange","previousQuantity","newQuantity","reason","referenceType","referenceId","createdBy") VALUES ($1,'transfer',$2,$3,$4,$5,'stock_transfer',$6,$7)`,
                  [
                    fromItem.id,
                    (-qty).toFixed(3),
                    prevFrom.toFixed(3),
                    (prevFrom - qty).toFixed(3),
                    `Transfer ${(cur as any).transferNumber} out`,
                    input.id,
                    ctx.user.id,
                  ]
                );
                const sku = fromItem.sku;
                const destRows = (await tx.unsafe(
                  `SELECT * FROM "inventory_items" WHERE "sku" = $1 AND "outletId" = $2 LIMIT 1`,
                  [sku, (cur as any).toOutletId]
                )) as any[];
                if (destRows[0]) {
                  const prevTo = decimal(destRows[0].quantity);
                  await tx.unsafe(
                    `UPDATE "inventory_items" SET "quantity" = $1 WHERE "id" = $2`,
                    [(prevTo + qty).toFixed(3), destRows[0].id]
                  );
                  await tx.unsafe(
                    `INSERT INTO "inventory_transactions" ("inventoryItemId","type","quantityChange","previousQuantity","newQuantity","reason","referenceType","referenceId","createdBy") VALUES ($1,'transfer',$2,$3,$4,$5,'stock_transfer',$6,$7)`,
                    [
                      destRows[0].id,
                      qty.toFixed(3),
                      prevTo.toFixed(3),
                      (prevTo + qty).toFixed(3),
                      `Transfer ${(cur as any).transferNumber} in`,
                      input.id,
                      ctx.user.id,
                    ]
                  );
                } else {
                  const ins = await tx.unsafe(
                    `INSERT INTO "inventory_items" ("name","sku","categoryId","supplierId","description","quantity","unit","reorderLevel","maxStockLevel","unitCost","storageLocation","active") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true) RETURNING "id"`,
                    [
                      fromItem.name,
                      sku,
                      fromItem.categoryId,
                      fromItem.supplierId,
                      fromItem.description,
                      qty.toFixed(3),
                      fromItem.unit,
                      fromItem.reorderLevel,
                      fromItem.maxStockLevel,
                      fromItem.unitCost,
                      fromItem.storageLocation,
                    ]
                  );
                  const newId = Number(ins[0].id);
                  await tx.unsafe(
                    `INSERT INTO "inventory_transactions" ("inventoryItemId","type","quantityChange","previousQuantity","newQuantity","reason","referenceType","referenceId","createdBy") VALUES ($1,'transfer',$2,'0',$3,$4,'stock_transfer',$5,$6)`,
                    [
                      newId,
                      qty.toFixed(3),
                      qty.toFixed(3),
                      `Transfer ${(cur as any).transferNumber} in (new)`,
                      input.id,
                      ctx.user.id,
                    ]
                  );
                }
              }
            }
            await tx.unsafe(
              `UPDATE "stock_transfers" SET "status" = 'received' WHERE "id" = $1`,
              [input.id]
            );
          });
        } else {
          const { error } = await supabase
            .from("stock_transfers")
            .update({ status: input.status } as any)
            .eq("id", input.id);
          if (error)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
            });
        }
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "stock_transfer",
          entityId: input.id,
          outletId: (cur as any).fromOutletId,
          action: input.status,
          before: { status: (cur as any).status },
          after: { status: input.status } as any,
        });
        return { success: true };
      }),
  }),

  wastage: router({
    list: protectedProcedure
      .input(
        z
          .object({
            outletId: z.number().int().positive().optional(),
            reason: z
              .enum([
                "expired",
                "spoiled",
                "damaged",
                "burned",
                "preparation_error",
                "dropped",
                "quality_issue",
                "other",
              ])
              .optional(),
            from: z.date().optional(),
            to: z.date().optional(),
            limit: z.number().int().min(1).max(100).default(50),
          })
          .nullish()
      )
      .query(async ({ ctx, input }) => {
        await requireInventory(ctx.user, "view");
        const supabase = getSupabaseAdmin();
        const scope = await getOutletScope(ctx.user);
        if (input?.outletId) await assertOutletAccess(ctx.user, input.outletId);
        try {
          let q: any = supabase
            .from("wastage_records")
            .select("*")
            .order("createdAt", { ascending: false })
            .limit(input?.limit ?? 50);
          if (input?.reason) q = q.eq("reason", input.reason);
          if (input?.from) q = q.gte("createdAt", input.from.toISOString());
          if (input?.to) q = q.lte("createdAt", input.to.toISOString());
          if (input?.outletId) q = q.eq("outletId", input.outletId);
          const { data, error } = await q;
          if (error) throw error;
          const matIds = Array.from(
            new Set(
              (data ?? []).map((r: any) => r.inventoryItemId).filter(Boolean)
            )
          ) as number[];
          const prepIds = Array.from(
            new Set(
              (data ?? []).map((r: any) => r.preparedItemId).filter(Boolean)
            )
          ) as number[];
          const outletIds = Array.from(
            new Set((data ?? []).map((r: any) => r.outletId).filter(Boolean))
          ) as number[];
          let matMap = new Map<number, string>();
          let prepMap = new Map<number, string>();
          let outletMap = new Map<number, string>();
          if (matIds.length) {
            const { data: mats } = await supabase
              .from("inventory_items")
              .select("id,name")
              .in("id", matIds);
            matMap = new Map((mats ?? []).map((m: any) => [m.id, m.name]));
          }
          if (prepIds.length) {
            const { data: preps } = await supabase
              .from("prepared_items")
              .select("id,name")
              .in("id", prepIds);
            prepMap = new Map((preps ?? []).map((p: any) => [p.id, p.name]));
          }
          if (outletIds.length) {
            const { data: outs } = await supabase
              .from("outlets")
              .select("id,name")
              .in("id", outletIds);
            outletMap = new Map((outs ?? []).map((o: any) => [o.id, o.name]));
          }
          let filtered = (data ?? []).map((r: any) => ({
            ...r,
            materialName: r.inventoryItemId
              ? (matMap.get(r.inventoryItemId) ?? null)
              : null,
            preparedName: r.preparedItemId
              ? (prepMap.get(r.preparedItemId) ?? null)
              : null,
            outletName: r.outletId ? (outletMap.get(r.outletId) ?? null) : null,
            quantity: decimal(r.quantity),
            estimatedCost: decimal(r.estimatedCost),
          }));
          if (!input?.outletId && scope && scope.length)
            filtered = filtered.filter(
              (r: any) => !r.outletId || scope.includes(r.outletId)
            );
          return filtered;
        } catch {
          return [];
        }
      }),
    analytics: protectedProcedure
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
        await requireInventory(ctx.user, "view");
        const supabase = getSupabaseAdmin();
        const scope = await getOutletScope(ctx.user);
        if (input?.outletId) await assertOutletAccess(ctx.user, input.outletId);
        let rows: any[] = [];
        try {
          let q: any = supabase
            .from("wastage_records")
            .select("*")
            .order("createdAt", { ascending: false })
            .limit(500);
          if (input?.from) q = q.gte("createdAt", input.from.toISOString());
          if (input?.to) q = q.lte("createdAt", input.to.toISOString());
          if (input?.outletId) q = q.eq("outletId", input.outletId);
          const { data, error } = await q;
          if (error) throw error;
          rows = (data ?? []) as any[];
        } catch {
          rows = [];
        }
        let filtered = rows;
        if (!input?.outletId && scope && scope.length)
          filtered = filtered.filter(
            (r: any) => !r.outletId || scope.includes(r.outletId)
          );
        const totalCost = filtered.reduce(
          (sum: number, r: any) => sum + Number(r.estimatedCost ?? 0),
          0
        );
        const byMaterial = new Map<string, number>();
        for (const r of filtered) {
          const key = r.inventoryItemId
            ? `material:${r.inventoryItemId}`
            : `prepared:${r.preparedItemId}`;
          byMaterial.set(
            key,
            (byMaterial.get(key) ?? 0) + Number(r.estimatedCost ?? 0)
          );
        }
        const top = Array.from(byMaterial.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([k, v]) => ({ key: k, cost: v }));
        return { totalCost, count: filtered.length, top };
      }),
    create: protectedProcedure
      .input(
        z.object({
          inventoryItemId: z.number().int().positive().nullable(),
          preparedItemId: z.number().int().positive().nullable(),
          outletId: z.number().int().positive().nullable(),
          quantity: z.number().positive().max(1000000),
          unit: z.string().trim().max(24),
          reason: z.enum([
            "expired",
            "spoiled",
            "damaged",
            "burned",
            "preparation_error",
            "dropped",
            "quality_issue",
            "other",
          ]),
          notes: z.string().trim().max(2000).nullable(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // Wastage decrements stock, so it must pass through the adjustment policy
        // (staff may record waste; other stock adjustments remain restricted).
        await requireAdjustment(ctx.user, "waste");
        if (!input.inventoryItemId && !input.preparedItemId)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Material or prepared item required.",
          });
        if (input.outletId) await assertOutletAccess(ctx.user, input.outletId);
        const supabase = getSupabaseAdmin();
        let cost = 0;
        if (input.inventoryItemId) {
          const { data: material, error: mErr } = await supabase
            .from("inventory_items")
            .select("*")
            .eq("id", input.inventoryItemId)
            .limit(1)
            .maybeSingle();
          if (mErr)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: mErr.message,
            });
          if (!material)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Material not found.",
            });
          cost = decimal((material as any).unitCost) * input.quantity;
          const prev = decimal((material as any).quantity);
          const next = prev - input.quantity;
          if (next < -0.001)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Insufficient stock for wastage.",
            });
          const sql = await getSql();
          await sql.begin(async (tx: any) => {
            await tx.unsafe(
              `UPDATE "inventory_items" SET "quantity" = $1 WHERE "id" = $2`,
              [next.toFixed(3), input.inventoryItemId]
            );
            await tx.unsafe(
              `INSERT INTO "inventory_transactions" ("inventoryItemId","type","quantityChange","previousQuantity","newQuantity","reason","notes","createdBy") VALUES ($1,'waste',$2,$3,$4,$5,$6,$7)`,
              [
                input.inventoryItemId,
                (-input.quantity).toFixed(3),
                prev.toFixed(3),
                next.toFixed(3),
                input.reason,
                input.notes,
                ctx.user.id,
              ]
            );
            await tx.unsafe(
              `INSERT INTO "wastage_records" ("inventoryItemId","preparedItemId","outletId","quantity","unit","reason","estimatedCost","notes","createdBy") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              [
                input.inventoryItemId,
                input.preparedItemId,
                input.outletId,
                input.quantity.toFixed(3),
                input.unit,
                input.reason,
                cost.toFixed(2),
                input.notes,
                ctx.user.id,
              ]
            );
          });
        } else if (input.preparedItemId) {
          const { data: prep, error: pErr } = await supabase
            .from("prepared_items")
            .select("*")
            .eq("id", input.preparedItemId)
            .limit(1)
            .maybeSingle();
          if (pErr)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: pErr.message,
            });
          if (!prep)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Prepared item not found.",
            });
          cost = decimal((prep as any).unitCost) * input.quantity;
          const prev = decimal((prep as any).quantity);
          const next = prev - input.quantity;
          if (next < -0.001)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Insufficient prepared stock.",
            });
          const sql = await getSql();
          await sql.begin(async (tx: any) => {
            await tx.unsafe(
              `UPDATE "prepared_items" SET "quantity" = $1 WHERE "id" = $2`,
              [next.toFixed(3), input.preparedItemId]
            );
            await tx.unsafe(
              `INSERT INTO "wastage_records" ("inventoryItemId","preparedItemId","outletId","quantity","unit","reason","estimatedCost","notes","createdBy") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              [
                null,
                input.preparedItemId,
                input.outletId,
                input.quantity.toFixed(3),
                input.unit,
                input.reason,
                cost.toFixed(2),
                input.notes,
                ctx.user.id,
              ]
            );
          });
        }
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "wastage",
          action: "created",
          outletId: input.outletId ?? null,
          after: { ...input, cost } as any,
        });
        return { estimatedCost: cost };
      }),
  }),
});
