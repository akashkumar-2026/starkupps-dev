import { describe, expect, it } from "vitest";

import {
  addLineTo,
  countOf,
  lineKeyFor,
  setQtyIn,
  subtotalOf,
  type AddLineArgs,
} from "./cart-provider";
import type { CartLine } from "@/types/cart";

const coldCoffee: AddLineArgs = {
  product: { id: 7, name: "Classic Cold Coffee", image: null },
  unitPrice: 14000,
  optionLabels: ["Regular"],
  quantity: 1,
  modifiers: [],
  variant: { id: 3, name: "Regular", quantity: 350, unit: "ml", price: 14000 },
};

const largeCoffee: AddLineArgs = {
  ...coldCoffee,
  unitPrice: 19000,
  optionLabels: ["Large"],
  variant: { id: 4, name: "Large", quantity: 500, unit: "ml", price: 19000 },
};

const latte: AddLineArgs = {
  ...coldCoffee,
  product: { id: 8, name: "Iced Latte", image: null },
  variant: { id: 3, name: "Regular", quantity: 350, unit: "ml", price: 16000 },
  unitPrice: 16000,
};

describe("lineKeyFor", () => {
  it("treats item, variant and options as the identity of a line", () => {
    expect(lineKeyFor(7, 3, ["Regular"])).toBe(lineKeyFor(7, 3, ["Regular"]));
    expect(lineKeyFor(7, 3, ["Regular"])).not.toBe(lineKeyFor(7, 4, ["Regular"]));
    expect(lineKeyFor(7, 3, ["Regular"])).not.toBe(lineKeyFor(8, 3, ["Regular"]));
    expect(lineKeyFor(7, 3, ["Regular"])).not.toBe(lineKeyFor(7, 3, ["Large"]));
  });

  it("cannot be collided by a comma inside an option label", () => {
    // ["a,b"] and ["a","b"] are different selections but a plain join(",")
    // renders both as "a,b".
    expect(lineKeyFor(7, 3, ["a,b"])).not.toBe(lineKeyFor(7, 3, ["a", "b"]));
  });

  it("does not depend on the order options were collected in", () => {
    expect(lineKeyFor(7, 3, ["Oat", "Extra shot"])).toBe(lineKeyFor(7, 3, ["Extra shot", "Oat"]));
  });
});

describe("addLineTo", () => {
  it("increments the quantity when the same selection is added again", () => {
    const once = addLineTo([], coldCoffee);
    const twice = addLineTo(once, coldCoffee);

    expect(twice).toHaveLength(1);
    expect(twice[0]!.qty).toBe(2);
    expect(countOf(twice)).toBe(2);
    expect(subtotalOf(twice)).toBe(28000);
  });

  it("adds the incoming quantity rather than setting it", () => {
    const once = addLineTo([], { ...coldCoffee, quantity: 3 });
    const twice = addLineTo(once, coldCoffee);

    expect(twice).toHaveLength(1);
    expect(twice[0]!.qty).toBe(4);
  });

  it("appends a new line for a different product", () => {
    const lines = addLineTo(addLineTo([], coldCoffee), latte);

    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.name)).toEqual(["Classic Cold Coffee", "Iced Latte"]);
    expect(countOf(lines)).toBe(2);
  });

  it("appends a new line for the same product in a different size", () => {
    const lines = addLineTo(addLineTo([], coldCoffee), largeCoffee);

    expect(lines).toHaveLength(2);
    expect(subtotalOf(lines)).toBe(33000);
  });

  it("keeps two sizes as separate lines, each carrying its own variant", () => {
    // The cart shows the product name once per line, so two sizes of one
    // product must stay distinguishable by variant rather than merging.
    const lines = addLineTo(addLineTo([], coldCoffee), largeCoffee);

    expect(lines.map((l) => l.variantName)).toEqual(["Regular", "Large"]);
    expect(lines.map((l) => l.variantId)).toEqual([3, 4]);
    expect(lines.map((l) => l.unitPrice)).toEqual([14000, 19000]);
    // Merging these would price a 350 ml drink at the 500 ml rate.
    expect(new Set(lines.map((l) => l.variantId)).size).toBe(2);
  });

  it("still merges when the same size is added a third time", () => {
    const lines = addLineTo(addLineTo(addLineTo([], coldCoffee), largeCoffee), coldCoffee);

    expect(lines).toHaveLength(2);
    expect(lines[0]!.qty).toBe(2);
    expect(lines[1]!.qty).toBe(1);
    expect(subtotalOf(lines)).toBe(47000);
  });

  it("appends a new line for the same product with different options", () => {
    const withOat: AddLineArgs = { ...coldCoffee, optionLabels: ["Regular", "Oat"] };
    const lines = addLineTo(addLineTo([], coldCoffee), withOat);

    expect(lines).toHaveLength(2);
  });

  it("re-prices a merged line so a live menu edit is reflected", () => {
    const first = addLineTo([], coldCoffee);
    const merged = addLineTo(first, { ...coldCoffee, unitPrice: 15500 });

    expect(merged[0]!.qty).toBe(2);
    expect(merged[0]!.unitPrice).toBe(15500);
  });

  it("keeps the variant name out of the option labels", () => {
    // The variant renders in its own field; repeating it here showed it twice.
    const [line] = addLineTo([], coldCoffee);

    expect(line!.variantName).toBe("Regular");
    expect(line!.optionLabels).toEqual(["Regular"]);
  });

  it("does not mutate the array it was given", () => {
    const first: CartLine[] = addLineTo([], coldCoffee);
    const snapshot = structuredClone(first);
    addLineTo(first, coldCoffee);

    expect(first).toEqual(snapshot);
  });
});

describe("setQtyIn", () => {
  it("drops the line when the quantity reaches zero", () => {
    const lines = addLineTo([], coldCoffee);
    expect(setQtyIn(lines, lines[0]!.key, 0)).toEqual([]);
  });

  it("leaves other lines untouched", () => {
    const lines = addLineTo(addLineTo([], coldCoffee), latte);
    const after = setQtyIn(lines, lines[0]!.key, 5);

    expect(after[0]!.qty).toBe(5);
    expect(after[1]!.qty).toBe(1);
  });
});
