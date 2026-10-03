#!/usr/bin/env tsx
/**
 * Live end-to-end verification of the ordering workflow against the real
 * database, via the public tRPC router.
 *
 * Deliberately NOT a vitest file: `server/routers` transitively loads `argon2`,
 * whose native binding segfaults on this Node build and kills the vitest worker.
 * Run directly with `npx tsx`, which does not fork.
 *
 * Covers the full chain from Phase 11.5:
 *   1. Admin toggles a fulfilment method.
 *   2. The public menu/outlets endpoints reflect it.
 *   3. A customer order is placed and every field is persisted.
 *   4. The Admin detail read returns all of it.
 *   5. Status transitions are enforced.
 *
 * Leaves no residue: creates a throwaway outlet, then removes it.
 *
 * Run it through the argon2 stub so the real router can be imported:
 *
 *   npx tsx --import ./scripts/argon2-stub.mjs scripts/verify-ordering.ts
 *
 * Or, after `npm run db:migrate`, via the package script:
 *
 *   npm run verify:ordering
 */
import "dotenv/config";

import { randomUUID } from "node:crypto";
import postgres from "postgres";

import { createCallerFactory } from "../server/lib/trpc";
import { publicRouter } from "../server/routers/publicRouter";
import { evaluateFulfillment } from "../shared/fulfillment";
import { canTransitionOrderStatus } from "../shared/orderStatus";

const sql = postgres(process.env.DATABASE_URL!, {
  ssl: "require",
  max: 1,
  prepare: false,
});

const caller = createCallerFactory(publicRouter)({
  user: null,
  aud: null,
  req: { headers: {}, protocol: "http" } as any,
  res: {} as any,
});

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(
      `  FAIL ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`
    );
  }
}

function section(title: string) {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 58 - title.length))}`);
}

/** Domain code carried by a rejected tRPC call, or undefined. */
async function codeOf(
  run: () => Promise<unknown>
): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (error: any) {
    return error?.cause?.domainCode ?? undefined;
  }
}

const suffix = randomUUID().slice(0, 8);
const outletCode = `E2E-${suffix.toUpperCase()}`;

let outletId: number | null = null;
const createdOrderIds: number[] = [];

/** Bound as a parameter (never `JSON.stringify(...)` — see `setServices`). */
const ALL_ON = {
  dineIn: true,
  takeaway: true,
  delivery: true,
  pos: true,
  onlineOrdering: true,
};

/**
 * Writes the jsonb column.
 *
 * `JSON.stringify(...)::jsonb` is wrong here: postgres.js already JSON-encodes
 * values, so the explicit `stringify` nests the object inside a string and the
 * `outlets_services_is_object` constraint correctly rejects it. This is the same
 * double-encoding that once made every order type unorderable (see
 * `shared/outletServices.ts`) — worth being careful about even in a script.
 */
async function setServices(services: Record<string, unknown>) {
  // `sql.json(...)` is postgres.js's explicit json parameter — it binds the
  // object as JSON rather than as a text parameter, which is both what the
  // `outlets_services_is_object` constraint requires and what its types accept.
  // `JSON.stringify` would double-encode and the constraint would reject it.
  await sql`UPDATE public.outlets SET services = ${sql.json(
    services as postgres.JSONValue
  )} WHERE id = ${outletId}`;
}

async function main() {
  // ── Fixture ──────────────────────────────────────────────────────────────
  section("Fixture");
  const [menuItem] = await sql`
    SELECT mi.id FROM public.menu_items mi
    JOIN public.menu_item_variants mv ON mv."menuItemId" = mi.id
    WHERE mi.available AND mv.available
    GROUP BY mi.id
    ORDER BY mi.id
    LIMIT 1
  `;
  const [variant] = await sql`
    SELECT id, price FROM public.menu_item_variants
    WHERE "menuItemId" = ${menuItem.id} AND available
    ORDER BY "isDefault" DESC, id LIMIT 1
  `;
  if (!menuItem || !variant) throw new Error("no sellable menu item found");

  const [outlet] = await sql`
    INSERT INTO public.outlets
      (code, name, city, state, address, phone, timezone,
       "openingTime", "closingTime", "deliveryRadiusKm", "minimumOrder",
       "preparationTimeMinutes", status, services)
    VALUES
      (${outletCode}, ${`E2E Order Check ${suffix}`}, 'Munger', 'Bihar',
       'Test address', '9999999999', 'Asia/Kolkata', '09:00', '22:00',
       5, 0, 20, 'active',
       ${sql.json(ALL_ON)})
    RETURNING id
  `;
  outletId = outlet.id as number;
  check("created a throwaway outlet", typeof outletId === "number", {
    outletId,
  });
  console.log(`  outlet id=${outletId} code=${outletCode}`);

  // ── 1. Admin toggles fulfilment ──────────────────────────────────────────
  section("1. Admin toggles a fulfilment method");
  // `updateServices` is behind `outlets.update`; here the merge semantics are
  // what is under test, exercised through the same helper the endpoint uses.
  const { mergeOutletServices } = await import("../shared/outletServices");
  const merged = mergeOutletServices(
    { dineIn: true, takeaway: true, delivery: true, packingCharge: 17 },
    { delivery: false }
  );
  check(
    "disabling delivery leaves the others on",
    merged.delivery === false &&
      merged.dineIn === true &&
      merged.takeaway === true,
    merged
  );
  check(
    "disabling delivery preserves charge overrides",
    merged.packingCharge === 17,
    merged
  );

  await setServices({ ...merged });
  const quoteRejected = await codeOf(() =>
    (caller as any).settings.charges({
      outletId,
      type: "delivery",
      taxable: 100,
    })
  );
  check(
    "delivery quote is refused once disabled",
    quoteRejected === "ORDER_TYPE_UNAVAILABLE",
    quoteRejected
  );

  const dineInQuote = await (caller as any).settings.charges({
    outletId,
    type: "dine_in",
    taxable: 100,
  });
  check(
    "dine-in still quotes (packing waived)",
    dineInQuote.packing === 0,
    dineInQuote
  );

  // ── 2. Server-side enforcement of every method ───────────────────────────
  section("2. Server rejects disabled methods regardless of the client");
  await setServices({
    dineIn: true,
    takeaway: true,
    delivery: false,
    pos: true,
    onlineOrdering: true,
  });
  check(
    "delivery verdict is ORDER_TYPE_UNAVAILABLE",
    evaluateFulfillment({ delivery: false }, "delivery").allowed === false
  );

  await setServices({
    dineIn: false,
    takeaway: true,
    delivery: true,
    pos: true,
    onlineOrdering: true,
  });
  const dineInCode = await codeOf(() =>
    (caller as any).orders.create({
      outletId,
      type: "dine_in",
      customer: { name: "Probe User", phone: "9000000001" },
      notes: null,
      items: [{ menuItemId: menuItem.id, variantId: variant.id, quantity: 1 }],
      idempotencyKey: `probe-${suffix}-dinein`,
    })
  );
  check(
    "dine-in order is refused when disabled",
    dineInCode === "ORDER_TYPE_UNAVAILABLE",
    dineInCode
  );

  await setServices({
    dineIn: true,
    takeaway: false,
    delivery: true,
    pos: true,
    onlineOrdering: true,
  });
  const takeawayCode = await codeOf(() =>
    (caller as any).orders.create({
      outletId,
      type: "takeaway",
      customer: { name: "Probe User", phone: "9000000002" },
      items: [{ menuItemId: menuItem.id, variantId: variant.id, quantity: 1 }],
      idempotencyKey: `probe-${suffix}-takeaway`,
    })
  );
  check(
    "takeaway order is refused when disabled",
    takeawayCode === "ORDER_TYPE_UNAVAILABLE",
    takeawayCode
  );

  // All three off.
  await setServices({
    dineIn: false,
    takeaway: false,
    delivery: false,
    onlineOrdering: false,
  });
  const allOffCode = await codeOf(() =>
    (caller as any).orders.create({
      outletId,
      type: "delivery",
      customer: {
        name: "Probe User",
        phone: "9000000003",
        address: "1 Test St",
      },
      items: [{ menuItemId: menuItem.id, variantId: variant.id, quantity: 1 }],
      idempotencyKey: `probe-${suffix}-alloff`,
    })
  );
  check(
    "all-off reports the kill switch, not a broken method",
    allOffCode === "OUTLET_NOT_ACCEPTING_ORDERS",
    allOffCode
  );

  await setServices({
    dineIn: false,
    takeaway: false,
    delivery: false,
    onlineOrdering: true,
  });
  const noTypesCode = await codeOf(() =>
    (caller as any).orders.create({
      outletId,
      type: "delivery",
      customer: {
        name: "Probe User",
        phone: "9000000004",
        address: "1 Test St",
      },
      items: [{ menuItemId: menuItem.id, variantId: variant.id, quantity: 1 }],
      idempotencyKey: `probe-${suffix}-notypes`,
    })
  );
  check(
    "all methods disabled reports NO_ORDER_TYPES_AVAILABLE",
    noTypesCode === "NO_ORDER_TYPES_AVAILABLE",
    noTypesCode
  );

  const noTypesQuote = await codeOf(() =>
    (caller as any).settings.charges({
      outletId,
      type: "takeaway",
      taxable: 100,
    })
  );
  check(
    "quote is refused too, not just the write",
    noTypesQuote === "NO_ORDER_TYPES_AVAILABLE",
    noTypesQuote
  );

  // ── 3. Delivery address validation ───────────────────────────────────────
  section("3. Delivery requires an address");
  await setServices({
    dineIn: true,
    takeaway: true,
    delivery: true,
    onlineOrdering: true,
  });
  const noAddressCode = await codeOf(() =>
    (caller as any).orders.create({
      outletId,
      type: "delivery",
      customer: { name: "Probe User", phone: "9000000005" },
      items: [{ menuItemId: menuItem.id, variantId: variant.id, quantity: 1 }],
      idempotencyKey: `probe-${suffix}-noaddr`,
    })
  );
  check(
    "delivery without an address is refused",
    noAddressCode === "DELIVERY_ADDRESS_REQUIRED",
    noAddressCode
  );

  // ── 4. Full order, every field persisted ─────────────────────────────────
  section("4. Customer order persists every field");
  const address = "12 Station Road, Near temple, Munger 813211";
  const notes = "Aacha sa banana less spicy";
  const key = `e2e-${suffix}`;
  const order: any = await (caller as any).orders.create({
    outletId,
    type: "delivery",
    customer: {
      name: "Aashish kumar",
      phone: "7545957093",
      address,
      email: "aashish@example.com",
    },
    notes,
    idempotencyKey: key,
    items: [{ menuItemId: menuItem.id, variantId: variant.id, quantity: 2 }],
  });
  createdOrderIds.push(order.id);
  check("order created", typeof order.id === "number", order);
  check(
    "response total is a number",
    typeof order.total === "number",
    order.total
  );
  check(
    "response carries the charge breakdown",
    typeof order.charges === "number" && typeof order.delivery === "number",
    order
  );

  const [row] = await sql`
    SELECT * FROM public.orders WHERE id = ${order.id}
  `;
  check(
    "order number assigned",
    Number(row.orderNumber) > 1000,
    row.orderNumber
  );
  check(
    "customer name snapshotted",
    row.customerName === "Aashish kumar",
    row.customerName
  );
  check(
    "customer phone snapshotted",
    row.customerPhone === "7545957093",
    row.customerPhone
  );
  check(
    "customer email snapshotted",
    row.customerEmail === "aashish@example.com",
    row.customerEmail
  );
  check(
    "delivery address persisted",
    row.deliveryAddress === address,
    row.deliveryAddress
  );
  check("order notes persisted verbatim", row.notes === notes, row.notes);
  check("fulfilment type persisted", row.type === "delivery", row.type);
  check(
    "chargesTotal persisted",
    Number(row.chargesTotal) === Number(order.charges),
    { stored: row.chargesTotal, response: order.charges }
  );
  check(
    "deliveryFee persisted",
    Number(row.deliveryFee) === Number(order.delivery),
    { stored: row.deliveryFee, response: order.delivery }
  );
  check("taxAmount persisted", Number(row.taxAmount) === Number(order.tax), {
    stored: row.taxAmount,
    response: order.tax,
  });
  check(
    "total reconciles: subtotal - discount + chargesTotal = total",
    Math.abs(
      Number(row.subtotal) -
        Number(row.couponDiscount) +
        Number(row.chargesTotal) -
        Number(row.total)
    ) < 0.01,
    {
      subtotal: row.subtotal,
      discount: row.couponDiscount,
      charges: row.chargesTotal,
      total: row.total,
    }
  );

  const [item] = await sql`
    SELECT * FROM public.order_items WHERE "orderId" = ${order.id}
  `;
  check(
    "order item persisted with its snapshot name",
    typeof item.itemName === "string" && item.itemName.length > 0,
    item.itemName
  );
  check("unit price persisted", Number(item.unitPrice) > 0, item.unitPrice);
  check(
    "line total = unit price × quantity",
    Math.abs(
      Number(item.lineTotal) - Number(item.unitPrice) * Number(item.quantity)
    ) < 0.01,
    item
  );
  check(
    "selectedModifiers is a json array, not a string",
    Array.isArray(item.selectedModifiers),
    typeof item.selectedModifiers
  );

  // ── 5. Takeaway carries no address ───────────────────────────────────────
  section("5. Takeaway order");
  const takeaway: any = await (caller as any).orders.create({
    outletId,
    type: "takeaway",
    customer: { name: "Rohit Sharma", phone: "9508398154" },
    notes: "no sugar",
    idempotencyKey: `${key}-takeaway`,
    items: [{ menuItemId: menuItem.id, variantId: variant.id, quantity: 1 }],
  });
  createdOrderIds.push(takeaway.id);
  const [tRow] =
    await sql`SELECT * FROM public.orders WHERE id = ${takeaway.id}`;
  check(
    "takeaway has no delivery address",
    tRow.deliveryAddress === null,
    tRow.deliveryAddress
  );
  check(
    "takeaway name snapshotted",
    tRow.customerName === "Rohit Sharma",
    tRow.customerName
  );
  check(
    "takeaway charges no delivery fee",
    Number(tRow.deliveryFee) === 0,
    tRow.deliveryFee
  );

  // ── 6. Dine-in never charged packing ─────────────────────────────────────
  section("6. Dine-in pricing");
  const dineInQuote2: any = await (caller as any).settings.charges({
    outletId,
    type: "dine_in",
    taxable: 500,
  });
  check("dine-in packing is zero", dineInQuote2.packing === 0, dineInQuote2);
  check("dine-in delivery is zero", dineInQuote2.delivery === 0, dineInQuote2);

  // ── 7. Idempotency ───────────────────────────────────────────────────────
  section("7. Duplicate submission is idempotent");
  const replay: any = await (caller as any).orders.create({
    outletId,
    type: "delivery",
    customer: {
      name: "Aashish kumar",
      phone: "7545957093",
      address,
      email: "aashish@example.com",
    },
    notes,
    idempotencyKey: key,
    items: [{ menuItemId: menuItem.id, variantId: variant.id, quantity: 2 }],
  });
  check(
    "replay returns the same order, not a new one",
    replay.id === order.id,
    { first: order.id, replay: replay.id }
  );
  check(
    "replay is flagged as already-created",
    replay.already === true,
    replay.already
  );
  check(
    "replay reports the persisted charges, not zero",
    Number(replay.charges) === Number(order.charges),
    { replay: replay.charges, first: order.charges }
  );
  const [countRows] = await sql`
    SELECT count(*)::int AS n FROM public.orders WHERE "idempotencyKey" = ${key}
  `;
  check("exactly one row exists for the key", countRows.n === 1, countRows);

  // ── 8. Admin detail read ────────────────────────────────────────────────
  section("8. Admin detail returns everything");
  // Reproduces `orderDetail`'s query set without importing adminRouter (argon2).
  const { normalizeSelectedModifiers } = await import("../server/db/index");
  const [detail] =
    await sql`SELECT * FROM public.orders WHERE id = ${order.id}`;
  const [cust] =
    await sql`SELECT name, phone, email FROM public.customers WHERE id = ${detail.customerId}`;
  const [outletRow] =
    await sql`SELECT name, code FROM public.outlets WHERE id = ${detail.outletId}`;
  const items =
    await sql`SELECT * FROM public.order_items WHERE "orderId" = ${detail.id}`;
  check(
    "admin detail has the customer name",
    (detail.customerName ?? cust?.name) === "Aashish kumar"
  );
  check(
    "admin detail has the phone",
    (detail.customerPhone ?? cust?.phone) === "7545957093"
  );
  check(
    "admin detail has the email",
    (detail.customerEmail ?? cust?.email) === "aashish@example.com"
  );
  check(
    "admin detail has the delivery address",
    detail.deliveryAddress === address,
    detail.deliveryAddress
  );
  check(
    "admin detail has the outlet name",
    outletRow?.name === `E2E Order Check ${suffix}`,
    outletRow
  );
  check("admin detail returns all items", items.length === 1, items.length);
  check(
    "order items normalise modifiers to an array",
    Array.isArray(normalizeSelectedModifiers(items[0].selectedModifiers))
  );

  // ── 9. Status transitions ────────────────────────────────────────────────
  section("9. Status lifecycle");
  check(
    "new → preparing allowed",
    canTransitionOrderStatus("new", "preparing")
  );
  check(
    "preparing → ready allowed",
    canTransitionOrderStatus("preparing", "ready")
  );
  check(
    "ready → completed allowed",
    canTransitionOrderStatus("ready", "completed")
  );
  check(
    "new → completed refused",
    !canTransitionOrderStatus("new", "completed")
  );
  check("ready → new refused", !canTransitionOrderStatus("ready", "new"));

  await sql`UPDATE public.orders SET status = 'preparing' WHERE id = ${order.id}`;
  const [prepped] =
    await sql`SELECT status FROM public.orders WHERE id = ${order.id}`;
  check(
    "status persisted to preparing",
    prepped.status === "preparing",
    prepped.status
  );

  // ── 10. Existing orders survive a disabled method ─────────────────────────
  section("10. Existing orders survive disabling their method");
  await setServices({
    dineIn: false,
    takeaway: false,
    delivery: false,
    onlineOrdering: false,
  });
  const [stillThere] =
    await sql`SELECT * FROM public.orders WHERE id = ${order.id}`;
  check(
    "the delivery order is still readable after delivery is disabled",
    stillThere?.id === order.id
  );
  check(
    "its persisted address is untouched",
    stillThere.deliveryAddress === address
  );
  const legacyCharge = await (caller as any).orders
    .create({
      outletId,
      type: "delivery",
      customer: { name: "Should Fail", phone: "9000000009", address },
      items: [{ menuItemId: menuItem.id, variantId: variant.id, quantity: 1 }],
      idempotencyKey: `${key}-blocked`,
    })
    .then(() => "created")
    .catch((e: any) => e?.cause?.domainCode ?? "error");
  check(
    "a new delivery order is still refused",
    legacyCharge !== "created",
    legacyCharge
  );

  await setServices({
    dineIn: true,
    takeaway: true,
    delivery: true,
    onlineOrdering: true,
  });

  // ── 11. New-order alert count ────────────────────────────────────────────
  section("11. Pending-order count that drives the ringtone");
  // `adminRouter` is imported lazily: it pulls in `routers/index` → `argon2`.
  const { createCallerFactory: adminCallerFactory } =
    await import("../server/lib/trpc");
  const { adminRouter } = await import("../server/routers/adminRouter");
  // `resolveStaffRole` maps a user whose `role` is `admin` straight to `owner`,
  // so this exercises the real permission path without minting a session.
  const [owner] =
    await sql`SELECT id FROM public.users WHERE role = 'admin' LIMIT 1`;
  const admin = adminCallerFactory(adminRouter)({
    user: {
      id: owner.id as number,
      name: "verify",
      email: "verify@example.com",
      role: "admin",
    } as any,
    aud: "admin" as any,
    req: { headers: {}, protocol: "http" } as any,
    res: {} as any,
  });
  const adminOrders = admin.orders as any;

  const allOutlets = await adminOrders.pending({ outletId: undefined });
  check(
    "pending returns a numeric count",
    typeof allOutlets.count === "number",
    allOutlets
  );
  const [direct] =
    await sql`SELECT count(*)::int AS n FROM public.orders WHERE status = 'new'`;
  check(
    "pending agrees with a direct count of status='new'",
    allOutlets.count === Number(direct?.n),
    { api: allOutlets.count, sql: direct?.n }
  );
  check(
    "newest carries an order number so the banner can link to it",
    allOutlets.newest.every(
      (o: any) => typeof o.orderNumber === "number" && typeof o.id === "number"
    ),
    allOutlets.newest
  );

  // The transition the ringtone depends on: a non-zero count while an order is
  // untouched, and nothing counted once it has been actioned.
  await sql`UPDATE public.orders SET status = 'new' WHERE id = ${order.id}`;
  const whileNew = await adminOrders.pending({ outletId: undefined });
  check(
    "an order set back to 'new' is counted again",
    whileNew.count >= 1,
    whileNew
  );
  check(
    "the waiting ticket is included",
    whileNew.newest.some((o: any) => o.id === order.id),
    whileNew.newest
  );

  await sql`UPDATE public.orders SET status = 'preparing' WHERE id = ${order.id}`;
  const afterAction = await adminOrders.pending({ outletId: undefined });
  check(
    "acting on it drops it from the count, which stops the ringtone",
    !afterAction.newest.some((o: any) => o.id === order.id),
    afterAction
  );

  // Scoping: filtering the header to another outlet must not ring for this one.
  const [otherOutlet] = await sql`
    SELECT id FROM public.outlets WHERE id <> ${outletId} AND status = 'active' LIMIT 1
  `;
  if (otherOutlet) {
    await sql`UPDATE public.orders SET status = 'new' WHERE id = ${order.id}`;
    const other = await adminOrders.pending({
      outletId: otherOutlet.id as number,
    });
    check(
      "filtering to another outlet excludes this outlet's new orders",
      !other.newest.some((o: any) => o.id === order.id),
      other
    );
    const own = await adminOrders.pending({ outletId: outletId as number });
    check(
      "filtering to the owning outlet includes it",
      own.newest.some((o: any) => o.id === order.id),
      own
    );
  }

  await sql`UPDATE public.orders SET status = 'preparing' WHERE id = ${order.id}`;
}

async function cleanup() {
  console.log("\n── Cleanup ───────────────────────────────────────────");
  try {
    for (const id of createdOrderIds) {
      await sql`DELETE FROM public.order_items WHERE "orderId" = ${id}`;
      await sql`DELETE FROM public.orders WHERE id = ${id}`;
    }
    if (outletId != null) {
      await sql`DELETE FROM public.outlet_menu_availability WHERE "outletId" = ${outletId}`;
      await sql`DELETE FROM public.outlet_hours WHERE "outletId" = ${outletId}`;
      await sql`DELETE FROM public.outlet_staff WHERE "outletId" = ${outletId}`;
      await sql`DELETE FROM public.outlets WHERE id = ${outletId}`;
    }
    console.log(
      `  removed ${createdOrderIds.length} order(s) and outlet ${outletId}`
    );
  } catch (error) {
    console.error("  cleanup failed:", error);
    failed++;
    failures.push("cleanup");
  }
}

main()
  .then(cleanup)
  .catch(error => {
    console.error("\nverification threw:", error);
    failed++;
    failures.push("unhandled");
    return cleanup();
  })
  .then(async () => {
    await sql.end();
    console.log(`\n${"=".repeat(62)}`);
    console.log(`passed ${passed}  failed ${failed}`);
    if (failures.length) console.log(`failing: ${failures.join(", ")}`);
    process.exitCode = failed > 0 ? 1 : 0;
  });
