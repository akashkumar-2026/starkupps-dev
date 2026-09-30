import { describe, expect, it } from "vitest";

import {
  getNavGroupsForRole,
  getNavigationForRole,
  isActiveRoute,
  navigation,
  roleCapabilities,
  viewLabels,
} from "@/config/navigation";
import type { NavGroup, StaffRole, View } from "@/types";

const ALL_VIEWS = Object.keys(viewLabels) as View[];

describe("navigation", () => {
  it("covers every declared view exactly once", () => {
    const declared = ALL_VIEWS.slice().sort();
    const present = navigation
      .map(item => item.view)
      .slice()
      .sort();
    expect(present).toEqual(declared);
  });

  it("labels every view", () => {
    for (const view of ALL_VIEWS) {
      expect(viewLabels[view], `viewLabels.${view}`).toBeTruthy();
    }
  });

  it("points each entry at its own route", () => {
    for (const item of navigation) {
      expect(item.href, item.view).toBe(`/${item.view}`);
    }
  });
});

describe("roleCapabilities", () => {
  it("declares a list for every role", () => {
    const roles: StaffRole[] = ["owner", "manager", "staff"];
    for (const role of roles) {
      expect(Array.isArray(roleCapabilities[role])).toBe(true);
    }
  });

  it("only grants views that exist", () => {
    for (const [role, views] of Object.entries(roleCapabilities)) {
      for (const view of views) {
        expect(viewLabels, `${role} -> ${view}`).toHaveProperty(view);
      }
    }
  });

  it("never grants a role more than the owner has", () => {
    const owner = new Set(roleCapabilities.owner);
    for (const role of ["manager", "staff"] as const) {
      for (const view of roleCapabilities[role]) {
        expect(owner.has(view), `${role} has ${view} but owner does not`).toBe(
          true
        );
      }
    }
  });
});

describe("getNavigationForRole", () => {
  it("returns only what the role may open", () => {
    for (const role of ["owner", "manager", "staff"] as const) {
      const items = getNavigationForRole(role);
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(roleCapabilities[role], `${role} -> ${item.view}`).toContain(
          item.view
        );
      }
    }
  });

  it("is a subset of the full navigation", () => {
    const all = new Set(navigation.map(item => item.view));
    for (const item of getNavigationForRole("staff")) {
      expect(all.has(item.view)).toBe(true);
    }
  });
});

describe("getNavGroupsForRole", () => {
  it("keeps every item the role can open", () => {
    for (const role of ["owner", "manager", "staff"] as const) {
      const grouped = Object.values(getNavGroupsForRole(role)).flat();
      expect(grouped.length).toBe(getNavigationForRole(role).length);
    }
  });

  it("omits groups with nothing in them", () => {
    for (const role of ["owner", "manager", "staff"] as const) {
      const groups = getNavGroupsForRole(role);
      for (const [name, items] of Object.entries(groups)) {
        expect(items.length, `${role} group ${name}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("isActiveRoute", () => {
  it("matches on the current view", () => {
    expect(isActiveRoute("orders", "orders", "/orders")).toBe(true);
    expect(isActiveRoute("orders", "menu", "/orders")).toBe(false);
  });

  it("keeps a section active across its sub-routes", () => {
    expect(
      isActiveRoute("inventory", "inventory", "/inventory/purchase-orders")
    ).toBe(true);
    expect(
      isActiveRoute("inventory", "inventory", "/inventory/materials/4")
    ).toBe(true);
    expect(isActiveRoute("orders", "orders", "/orders/12")).toBe(true);
  });

  it("does not leak between sections", () => {
    // The URL decides which section is lit, so a sibling prefix must not match.
    expect(isActiveRoute("inventory", "menu", "/inventory")).toBe(false);
    expect(isActiveRoute("inventory", "orders", "/inventory/purchases")).toBe(
      false
    );
    expect(isActiveRoute("menu", "orders", "/menu")).toBe(false);
  });

  it("does not match a prefix that merely starts with the same characters", () => {
    expect(isActiveRoute("orders", "menu", "/menu-editor")).toBe(false);
  });
});

describe("NavGroup", () => {
  it("only contains groups the nav actually uses", () => {
    const used = new Set<NavGroup>(navigation.map(item => item.group));
    const declared: NavGroup[] = [
      "workstation",
      "catalog",
      "customers",
      "delivery",
      "growth",
      "management",
      "system",
    ];
    for (const group of declared) {
      expect(used.has(group), `group ${group} is declared but unused`).toBe(
        true
      );
    }
  });
});
