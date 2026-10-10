import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isStorefrontMutation,
  triggerStorefrontRebuild,
} from "../lib/seo-rebuild";

/**
 * The rebuild hook must fire for every storefront-visible write and for
 * nothing else. An order write during the lunch rush must never rebuild the
 * site; a menu price change must. Both directions are pinned here so a future
 * router rename fails loudly instead of silently dropping freshness.
 */
describe("isStorefrontMutation", () => {
  it.each([
    "siteContent.save",
    "admin.menu.update",
    "admin.menu.variants.setAvailability",
    "admin.menu.modifiers.addOption",
    "content.faqs.create",
    "content.testimonials.remove",
    "instagram.posts.update",
    "instagram.settings.update",
    "outlets.update",
    "outlets.hours.save",
    "outlets.menuAvailability.set",
  ])("matches %s", path => {
    expect(isStorefrontMutation(path)).toBe(true);
  });

  it.each([
    "admin.orders.updateStatus",
    "admin.orders.create",
    "public.orders.create",
    "public.menu.list",
    "inventory.items.update",
    "content.blocks.create",
    "content.banners.create",
    "outlets.zones.create",
    "auth.login",
    "",
  ])("rejects %s", path => {
    expect(isStorefrontMutation(path)).toBe(false);
  });
});

describe("triggerStorefrontRebuild", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("is a no-op without SEO_REBUILD_HOOK_URL (never phones home, never throws)", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(() => triggerStorefrontRebuild("admin.menu.update")).not.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
