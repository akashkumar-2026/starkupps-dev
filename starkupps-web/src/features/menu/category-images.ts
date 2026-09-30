import coffeeImg from "@/assets/cat-coffee.jpg";
import pizzaImg from "@/assets/cat-pizza.jpg";
import burgerImg from "@/assets/cat-burger.jpg";

/**
 * Fallback imagery for categories.
 *
 * Category images are optional in Admin, so a slug that has no uploaded image
 * still needs something to render. Lookup falls back from the full slug to its
 * first segment, so "Cold Coffee" resolves via "cold" and "Burgers & More"
 * resolves via "burgers".
 */
export const CATEGORY_FALLBACK_IMAGES: Record<string, string> = {
  coffee: coffeeImg,
  pizza: pizzaImg,
  burgers: burgerImg,
  burger: burgerImg,
};

export function categoryImage(slug: string): string {
  const head = slug.split("-")[0] ?? "";
  return CATEGORY_FALLBACK_IMAGES[slug] ?? CATEGORY_FALLBACK_IMAGES[head] ?? coffeeImg;
}
