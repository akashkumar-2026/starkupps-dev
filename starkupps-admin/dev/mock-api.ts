/**
 * Offline API mock for local development.
 *
 * This is a **development-only convenience**, not part of the production build.
 * It is registered with `apply: "serve"`, so `vite build` never includes it, and
 * it stays inert whenever `DATABASE_URL` is set — in that case Vite proxies
 * `/api` to the real Express gateway instead. That guard matters: mixing a
 * mocked `/api/auth/me` with a real `/api/trpc` produces a split brain where the
 * client believes it is signed in and every query 401s.
 *
 * Run `npm run dev` with no database configured to work on the UI without one.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import dotenv from "dotenv";
import superjson from "superjson";
import type { Plugin } from "vite";

/*
 * Vite does not put .env values into process.env — it only exposes VITE_*
 * through import.meta.env. The mock needs to know whether a database is
 * configured, so read the files directly. Later files do not override earlier
 * ones, which matches the server's own loading order in server/config/env.ts.
 */
for (const file of [
  path.resolve(import.meta.dirname, ".env"),
  path.resolve(import.meta.dirname, "../.env"),
]) {
  dotenv.config({ path: file, quiet: true });
}

/** 5 MB, mirroring `adminRouter.storage.upload*` in production. */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

const PLACEHOLDER_IMAGE =
  "https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=800&q=80";

const MOCK_USER = {
  id: 1,
  openId: "local-admin",
  name: "StarKupps Admin",
  email: "admin@starkupps.local",
  role: "admin",
};

const MOCK_MENU_CATEGORIES = [
  { id: 1, name: "Coffee", sortOrder: 1 },
  { id: 2, name: "Pizza", sortOrder: 2 },
  { id: 3, name: "Burgers", sortOrder: 3 },
];

const MOCK_OUTLET = {
  id: 1,
  code: "MUNGER-01",
  name: "StarKupps Munger",
  city: "Munger",
  address: "Azad Chowk, Munger",
  phone: "9876543210",
  openingTime: "09:00",
  closingTime: "22:00",
  deliveryRadiusKm: 5,
  minimumOrder: 0,
  status: "active",
  services: {
    dineIn: true,
    takeaway: true,
    delivery: true,
    pos: true,
    onlineOrdering: true,
  },
};

type Req = IncomingMessage & { url?: string };
type Res = ServerResponse;
type Next = (error?: unknown) => void;

/** Wraps a payload in the superjson envelope tRPC expects on the wire. */
function trpcResult(data: unknown, batch: boolean): string {
  const envelope = { result: { data: superjson.serialize(data) } };
  return JSON.stringify(batch ? [envelope] : envelope);
}

function json(res: Res, payload: unknown): void {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function isBatchRequest(url: string): boolean {
  return new URL(url, "http://localhost").searchParams.get("batch") === "1";
}

function readBody(req: Req): Promise<string> {
  return new Promise(resolve => {
    let body = "";
    req.on("data", (chunk: unknown) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
  });
}

/**
 * tRPC batch bodies are `{ "0": { json: <input> } }`. Digs the first input out
 * so the mock can react to it (name collisions, coupon codes).
 */
function firstInput(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body || "{}") as Record<string, unknown>;
    const entry = (parsed["0"] ?? parsed[0]) as
      { json?: Record<string, unknown> } | undefined;
    return (entry?.json ?? entry ?? null) as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

const EMPTY_PAGE = { items: [], nextCursor: undefined };

/**
 * Per-procedure responses. Order matters: specific paths are listed before the
 * prefix they would otherwise be swallowed by.
 */
function mockTrpcData(
  path: string,
  cookie: string,
  input: Record<string, unknown> | null,
  state: MockState
): unknown {
  const hasSession = cookie.includes("app_session_id=");

  if (path === "auth.me") {
    return hasSession
      ? { user: MOCK_USER, staffRole: "owner", outletScope: null }
      : null;
  }
  if (path === "auth.bootstrap" || path === "admin.bootstrap") {
    return { staffRole: "owner", outletScope: null, user: MOCK_USER };
  }
  if (path === "auth.login") {
    return {
      success: true,
      user: MOCK_USER,
      staffRole: "owner",
      outletScope: null,
      returnTo: null,
    };
  }
  if (path === "auth.logout") return { success: true };
  if (path === "auth.forgotPassword") {
    return {
      success: true,
      message:
        "If an account exists for this email, password reset instructions have been sent.",
    };
  }
  if (path === "auth.resetPassword" || path === "auth.changePassword") {
    return { success: true };
  }
  if (path === "admin.dashboard") {
    return {
      openCount: 0,
      totalRevenue: 0,
      servedCount: 0,
      averagePrepMinutes: 0,
      repeatRate: 0,
    };
  }
  if (
    path === "admin.storage.uploadProductImage" ||
    path === "admin.storage.uploadCategoryImage"
  ) {
    const category = path.endsWith("CategoryImage");
    return {
      key: `${category ? "categories" : "products"}/mock-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.jpg`,
      url: `${PLACEHOLDER_IMAGE}&mock-upload=${Date.now()}`,
      bytes: 68_000,
    };
  }
  if (path === "shifts.list") return [];
  if (path === "notifications.list") return { items: [], unreadCount: 0 };

  // ── Orders ──
  if (path === "admin.orders.list") return { ...EMPTY_PAGE };
  if (path === "admin.orders.byId") return null;
  if (path === "admin.orders.create")
    return { id: 1000 + Math.floor(Math.random() * 9000) };
  if (path === "admin.orders.updateStatus" || path === "admin.orders.cancel")
    return { success: true };
  if (path.startsWith("admin.orders")) return { ...EMPTY_PAGE };

  // ── Menu ── (stateful so a created category survives HMR)
  if (path === "admin.menu.createCategory") {
    const name =
      String(input?.name ?? "").trim() ||
      `Category ${state.nextMenuCategoryId}`;
    const existing = state.menuCategories.find(
      c => c.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) return { id: existing.id };
    const created = {
      id: state.nextMenuCategoryId++,
      name,
      sortOrder: state.menuCategories.length + 1,
    };
    state.menuCategories.push(created);
    return { id: created.id };
  }
  if (path === "admin.menu.create") {
    state.menuItems.push({
      id: 1000 + Math.floor(Math.random() * 90000),
      name: "Mock Item",
      price: 0,
    });
    return { id: 1000 + Math.floor(Math.random() * 90000) };
  }
  if (
    path === "admin.menu.updateCategory" ||
    path === "admin.menu.removeCategory" ||
    path === "admin.menu.update" ||
    path === "admin.menu.setAvailability" ||
    path === "admin.menu.setComingSoon" ||
    path === "admin.menu.remove"
  ) {
    return { success: true };
  }
  if (path.startsWith("admin.menu.modifiers")) {
    if (path.includes("createGroup") || path.includes("addOption")) {
      return { id: Date.now() % 90000 };
    }
    return path.includes("forItem") ? [] : [];
  }
  if (path.startsWith("admin.menu")) {
    return {
      categories: state.menuCategories,
      items: state.menuItems,
      nextCursor: undefined,
    };
  }

  // ── Inventory ──
  if (path === "inventory.categories.create") {
    const name =
      String(input?.name ?? "").trim() ||
      `Inventory Cat ${state.nextInventoryCategoryId}`;
    const created = {
      id: state.nextInventoryCategoryId++,
      name,
      description: null,
    };
    state.inventoryCategories.push(created);
    return { id: created.id };
  }
  if (path === "inventory.categories.list") return state.inventoryCategories;
  if (path === "inventory.overview") {
    return {
      totalMaterials: 0,
      lowStock: 0,
      critical: 0,
      outOfStock: 0,
      pendingPurchases: 0,
      stockValue: 0,
      wastageThisMonth: 0,
      expiringSoon: 0,
      pendingTransfers: 0,
      consumedToday: 0,
    };
  }
  if (path === "inventory.dashboard") {
    return {
      totalItems: 0,
      lowStock: 0,
      outOfStock: 0,
      inventoryValue: 0,
      expiringSoon: 0,
      pendingOrders: 0,
    };
  }
  if (path === "inventory.attention")
    return { lowStock: [], expiry: [], pendingOrders: [] };
  if (path === "inventory.stockHealth") {
    return {
      total: 0,
      healthy: 0,
      low: 0,
      critical: 0,
      out: 0,
      expired: 0,
      pct: { healthy: 0, low: 0, critical: 0, out: 0, expired: 0 },
    };
  }
  if (path === "inventory.list") return { items: [], total: 0 };
  if (path.startsWith("inventory.recipes"))
    return path.includes("byId") ? null : [];
  if (path === "inventory.transactions") return [];
  if (path.startsWith("inventory")) {
    return {
      items: [],
      total: 0,
      totalItems: 0,
      lowStock: 0,
      outOfStock: 0,
      inventoryValue: 0,
      expiringSoon: 0,
      pendingOrders: 0,
      lowStockItems: [],
      expiryItems: [],
    };
  }

  // ── Staff ──
  if (path === "staff.overview") {
    return {
      total: 0,
      active: 0,
      inactive: 0,
      suspended: 0,
      present: 0,
      late: 0,
      absent: 0,
      onLeave: 0,
      working: 0,
      scheduledToday: 0,
      byOutlet: [],
    };
  }
  if (path === "staff.byId") return null;
  if (path === "staff.create") return { id: 1, employeeId: "SK-EMP-0001" };
  if (path.startsWith("staff.roles")) {
    return path.includes("matrix")
      ? { roles: [], permissions: [], matrix: [] }
      : [];
  }
  if (path.startsWith("staff.attendance")) {
    if (path.includes("today"))
      return { expected: 0, present: 0, late: 0, absent: 0, records: [] };
    if (
      path.includes("clockIn") ||
      path.includes("clockOut") ||
      path.includes("breakToggle") ||
      path.includes("correct")
    ) {
      return { success: true, id: 1 };
    }
    return { ...EMPTY_PAGE };
  }
  if (
    path.startsWith("staff.shiftTemplates") ||
    path.startsWith("staff.schedules")
  ) {
    return path.includes("create") || path.includes("assign") ? { id: 1 } : [];
  }
  if (path.startsWith("staff.leave")) {
    return path.includes("create") || path.includes("review")
      ? { id: 1, success: true }
      : [];
  }
  if (
    path === "staff.update" ||
    path === "staff.changeRole" ||
    path === "staff.assignOutlet" ||
    path === "staff.setStatus" ||
    path === "staff.setActive"
  ) {
    return { success: true };
  }
  if (path === "staff.list") return { ...EMPTY_PAGE };
  if (path.startsWith("staff")) return { ...EMPTY_PAGE };

  // ── Coupons ──
  if (path === "coupons.kpi") {
    return {
      active: 0,
      scheduled: 0,
      expired: 0,
      exhausted: 0,
      usedToday: 0,
      totalRedemptions: 0,
      discountGiven: 0,
      mostUsed: null,
    };
  }
  if (path === "coupons.create") return { id: 1 };
  if (
    path === "coupons.update" ||
    path === "coupons.setStatus" ||
    path === "coupons.remove"
  )
    return { success: true };
  if (path.startsWith("coupons.byId")) return null;
  if (path === "coupons.validate")
    return { valid: true, discount: 0, eligibleAmount: 0 };
  if (path === "coupons.redeem") return { id: 1, discount: 0 };
  if (path.startsWith("coupons.analytics")) {
    return {
      totalRedemptions: 0,
      uniqueCustomers: 0,
      ordersGenerated: 0,
      gross: 0,
      discount: 0,
      net: 0,
      aov: 0,
      revenuePerDiscount: 0,
      newCustomers: 0,
      repeatRate: 0,
    };
  }
  if (path === "coupons.list" || path.startsWith("coupons.redemptions"))
    return { ...EMPTY_PAGE };
  if (path.startsWith("coupons")) return { ...EMPTY_PAGE };

  // ── Remaining modules ──
  if (path === "settings.get") return null;
  if (path === "analytics.overview")
    return {
      totalRevenue: 0,
      totalOrders: 0,
      averageOrderValue: 0,
      daily: [],
      topItems: [],
    };
  if (path === "loyalty.list") return { ...EMPTY_PAGE };
  if (path === "search.query") return [];
  if (path === "delivery.performance")
    return {
      total: 0,
      delivered: 0,
      failed: 0,
      deliveryRate: 0,
      avgMinutes: 0,
    };
  if (path === "finance.revenue") {
    return {
      gross: 0,
      discounts: 0,
      taxes: 0,
      refunds: 0,
      net: 0,
      totalOrders: 0,
      paidOrders: 0,
      daily: [],
    };
  }
  if (path === "system.health")
    return { status: "ok", timestamp: new Date().toISOString() };
  if (path === "public.outlets.list") return [MOCK_OUTLET];
  if (path === "public.menu.categories") return MOCK_MENU_CATEGORIES;
  if (path.startsWith("public.menu"))
    return { categories: MOCK_MENU_CATEGORIES, items: [] };
  if (path === "public.coupons.validate") {
    return String(input?.code ?? "").toUpperCase() === "WELCOME50"
      ? {
          valid: true,
          discount: 50,
          eligibleAmount: 200,
          coupon: { code: "WELCOME50" },
        }
      : { valid: false, reason: "Coupon not found." };
  }
  if (path === "public.orders.create") {
    return {
      id: 1234,
      orderNumber: 1234,
      status: "new",
      subtotal: 300,
      couponDiscount: 0,
      charges: 15,
      total: 315,
      outletId: 1,
    };
  }
  if (path === "support.list") return { ...EMPTY_PAGE };
  if (path.startsWith("support")) return null;
  if (path.startsWith("outlets")) {
    if (path.startsWith("outlets.byId")) return null;
    if (path === "outlets.list") return { ...EMPTY_PAGE };
    return [];
  }
  if (path.startsWith("customers")) {
    if (path.startsWith("customers.byId")) return null;
    if (path === "customers.list") return { ...EMPTY_PAGE };
    return [];
  }
  if (path.startsWith("marketing") || path.startsWith("content")) return [];
  if (path.startsWith("audit")) return { ...EMPTY_PAGE };

  return null;
}

/** Mutable state that must outlive an HMR reload within one Vite process. */
type MockState = {
  menuCategories: Array<{ id: number; name: string; sortOrder: number }>;
  menuItems: Array<{ id: number; name: string; price: number }>;
  nextMenuCategoryId: number;
  inventoryCategories: Array<{
    id: number;
    name: string;
    description: string | null;
  }>;
  nextInventoryCategoryId: number;
};

export function mockApiPlugin(): Plugin {
  // The plugin object survives HMR while the dev server runs, so this state
  // persists across a component reload.
  const state: MockState = {
    menuCategories: [],
    menuItems: [],
    nextMenuCategoryId: 1,
    inventoryCategories: [],
    nextInventoryCategoryId: 1,
  };

  const handleUpload = async (
    req: Req,
    res: Res,
    url: string,
    isCategory: boolean
  ): Promise<void> => {
    const batch = isBatchRequest(url);
    const input = firstInput(await readBody(req));
    const contentType = String(
      input?.contentType ?? "image/jpeg"
    ).toLowerCase();

    if (input?.contentType && !ALLOWED_IMAGE_TYPES.has(contentType)) {
      return json(
        res,
        batch
          ? [
              {
                error: {
                  code: "BAD_REQUEST",
                  message: "Only JPEG, PNG, WebP, GIF, AVIF images are allowed",
                },
              },
            ]
          : {
              error: {
                code: "BAD_REQUEST",
                message: "Only JPEG, PNG, WebP, GIF, AVIF images are allowed",
              },
            }
      );
    }

    const raw = String(input?.data ?? "");
    const base64 = raw.includes(",") ? (raw.split(",").pop() ?? "") : raw;
    const bytes = base64 ? Buffer.from(base64, "base64").length : 68_000;
    if (bytes > MAX_UPLOAD_BYTES) {
      const message = `Image too large — max 5 MB (got ${(bytes / 1024 / 1024).toFixed(2)} MB)`;
      return json(
        res,
        batch
          ? [{ error: { code: "BAD_REQUEST", message } }]
          : { error: { code: "BAD_REQUEST", message } }
      );
    }

    // Echo the upload back as a data URL so the preview works with no storage.
    const preview = base64
      ? `data:${contentType};base64,${base64}`
      : `${PLACEHOLDER_IMAGE}&mock-upload=${Date.now()}`;

    // A short delay keeps the progress bar in the dialog honest.
    setTimeout(() => {
      res.end(
        trpcResult(
          {
            key: `${isCategory ? "categories" : "products"}/mock-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.jpg`,
            url: preview,
            bytes,
          },
          batch
        )
      );
    }, 400);
  };

  const handlePublicRest = async (
    req: Req,
    res: Res,
    url: string
  ): Promise<void> => {
    if (url.startsWith("/api/public/outlets")) {
      return json(res, [MOCK_OUTLET]);
    }
    if (url.startsWith("/api/public/menu")) {
      return json(res, { categories: MOCK_MENU_CATEGORIES, items: [] });
    }
    if (url.startsWith("/api/public/coupons/validate")) {
      const body = firstInput(await readBody(req));
      const code = String(body?.code ?? "").toUpperCase();
      return code === "WELCOME50"
        ? json(res, { valid: true, discount: 50, eligibleAmount: 200 })
        : json(res, { valid: false, reason: "Coupon not found." });
    }
    if (url.startsWith("/api/public/orders")) {
      return json(res, {
        id: 1000 + Math.floor(Math.random() * 9000),
        orderNumber: 1000 + Math.floor(Math.random() * 9000),
        status: "new",
        subtotal: 300,
        couponDiscount: 0,
        charges: 15,
        total: 315,
        outletId: 1,
      });
    }
    return json(res, { error: "Not found" });
  };

  const handleTrpc = async (req: Req, res: Res, url: string): Promise<void> => {
    const batch = isBatchRequest(url);
    const body = batch ? await readBody(req) : "";
    const paths = new URL(url, "http://localhost").pathname
      .replace("/api/trpc", "")
      .replace(/^\//, "")
      .split(",")
      .filter(Boolean);
    const targets = paths.length ? paths : ["admin.bootstrap"];

    if (targets.includes("auth.login")) {
      res.setHeader(
        "Set-Cookie",
        "app_session_id=mock-session; Path=/; SameSite=Lax"
      );
    }
    if (targets.includes("auth.logout")) {
      res.setHeader(
        "Set-Cookie",
        "app_session_id=; Path=/; Max-Age=0; SameSite=Lax"
      );
    }

    const cookie = req.headers.cookie ?? "";
    const data = targets.map(path =>
      superjson.serialize(mockTrpcData(path, cookie, firstInput(body), state))
    );
    json(
      res,
      data.map(payload => ({ result: { data: payload } }))
    );
  };

  return {
    name: "starkupps:mock-api",
    // Dev only. `vite build` never sees this plugin.
    apply: "serve",
    // Run before Vite's own middlewares so the SPA fallback cannot swallow /api.
    enforce: "pre",
    configureServer(server) {
      // With a real database configured, defer everything to the Express gateway.
      const hasDatabase = Boolean(process.env.DATABASE_URL);
      if (hasDatabase) return;

      const handler = (
        req: IncomingMessage,
        res: ServerResponse,
        next: Next
      ) => {
        const url = (req as Req).url ?? "";
        if (!url.startsWith("/api/")) return next();
        const request = req as Req;

        const run = async () => {
          if (
            url.includes("admin.storage.uploadProductImage") ||
            url.includes("admin.storage.uploadCategoryImage")
          ) {
            return handleUpload(
              request,
              res,
              url,
              url.includes("uploadCategoryImage")
            );
          }
          if (url.startsWith("/api/health")) {
            return json(res, {
              status: "ok",
              timestamp: new Date().toISOString(),
            });
          }
          if (url.startsWith("/api/auth/me")) {
            const hasSession = (request.headers.cookie ?? "").includes(
              "app_session_id="
            );
            return json(
              res,
              hasSession
                ? { user: MOCK_USER, staffRole: "owner", outletScope: null }
                : { user: null, staffRole: null, outletScope: null }
            );
          }
          if (url.startsWith("/api/public/"))
            return handlePublicRest(request, res, url);
          if (url.startsWith("/api/trpc")) return handleTrpc(request, res, url);
          return next();
        };

        run().catch((error: unknown) => {
          res.statusCode = 500;
          json(res, { error: { message: String(error) } });
        });
      };

      server.middlewares.use(handler);
    },
  };
}
