import { describe, expect, it } from "vitest";
import { expirationStatus, statusFor } from "../routers/inventoryRouter";

describe("inventory status rules", () => {
  it("prioritises an empty shelf over expiry and reorder state", () => {
    expect(
      statusFor({
        quantity: 0,
        reorderLevel: 5,
        expiryDate: new Date(Date.now() - 86_400_000),
      })
    ).toBe("out_of_stock");
  });

  it("calculates low stock and in-stock state from quantity and reorder levels", () => {
    expect(statusFor({ quantity: 3, reorderLevel: 3, expiryDate: null })).toBe(
      "low_stock"
    );
    expect(
      statusFor({ quantity: 3.1, reorderLevel: 3, expiryDate: null })
    ).toBe("in_stock");
  });

  it("surfaces expiry risk only for stock that remains on hand", () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 3);
    const expired = new Date();
    expired.setDate(expired.getDate() - 1);
    expect(expirationStatus(soon, 1)).toBe("expiring_soon");
    expect(expirationStatus(expired, 1)).toBe("expired");
    expect(expirationStatus(soon, 0)).toBeNull();
  });
});
