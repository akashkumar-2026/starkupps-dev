/**
 * Formatting helpers. All money in the app is paise (integer) end to end —
 * the gateway converts to rupees — so these never deal in floating point.
 */

/** Format paise as Indian-grouped rupees, e.g. `₹1,40,000`. */
export function inr(paise: number): string {
  return `₹${Math.round(paise).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

/** Convert a category label to the slug used for image lookup and routing. */
export function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, "-");
}
