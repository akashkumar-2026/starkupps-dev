# Responsive design

How the storefront behaves at every width, and the rules a new section has to
follow so it inherits the behaviour instead of re-deriving it.

Most visitors to a cafe's public site arrive on a phone, so mobile is the base
case here, not a fallback.

---

## Breakpoints

The scale is Tailwind's default, **restated in the token layer** in
`src/styles.css` under `@theme inline` so the values are documented in one place
rather than being implicit:

| Prefix | Value    | Reference widths             | What it is                    |
| ------ | -------- | --------------------------- | ----------------------------- |
| base   | `< 640px` | 320, 360, 375, 430          | phone                         |
| `sm`   | `640px`  | 640, 768                    | large phone, tablet portrait  |
| `md`   | `768px`  | 768, 834                    | tablet portrait               |
| `lg`   | `1024px` | 1024, 1180, 1280            | tablet landscape, small laptop|
| `xl`   | `1280px` | 1280, 1440                  | laptop / desktop              |
| `2xl`  | `1536px` | 1920                        | large desktop                 |

**The scale is mobile-first.** Base styles target the smallest screen and each
`min-width` query progressively enhances. There are no `max-width` queries in
this codebase and none should be added — a `max-md:` rule is the usual symptom
of a desktop layout being retrofitted rather than composed.

Do not change the numbers to tune a single layout. Add a token (below) or a
container query instead, so the decision lands in one place.

### Layout tokens

Defined once in `src/styles.css`, so a new section does not re-derive the gutter,
max width and vertical rhythm:

- **`shell`** — page gutter plus max content width. The direct child of
  `<main>`/`<section>` that constrains a row. `1rem` gutter below `sm`, `1.5rem`
  to `lg`, `2rem` above.
- **`section-y`** — vertical padding for a top-level section. Fluid
  (`clamp(2.5rem, 6vw, 5.5rem)`) so it never steps awkwardly at a breakpoint.
- **`shell-max`** (72rem) — matches the previous `max-w-6xl`, so nothing moves.

```tsx
// Correct — inherits the responsive gutter and rhythm for free.
<section className="shell section-y">…</section>
```

---

## Per-pattern rules

### Navigation

There is **no hamburger**, deliberately. The nav has exactly two links, and
hiding them behind an extra tap makes the cafe's own content harder to reach to
save space the layout does not need. Instead the bar is built to fit at 320px by
tightening padding and gap below `sm`.

That fit is load-bearing. The measured bar needs 354px of a 320px viewport if the
mobile padding is loosened, which produces horizontal page scroll. If you widen a
header item, re-measure at 320px.

The **cart button is never collapsed** — it is the primary conversion action and
stays in the top bar at every width. It shows a count badge below `md` and
`count · total` above it.

### Hero

Full-bleed image with overlaid text, `min-h-[86svh]`. The Ken Burns drift is a CSS
`transform` animation (`hero-drift`) rather than JS, so it does not occupy the
main thread behind the LCP paint, and it is disabled under
`prefers-reduced-motion`. The scrim is `bg-espresso/60`, which is what keeps the
text legible over any part of the photograph.

### Menu / product grid

Two columns of cards on a phone, one column from `lg`. Cards reflow with the
grid system — no fixed pixel widths. Quantity steppers and the add-to-cart control
are `size-11` (44px).

### Cart and checkout

The highest-value surface on the site, so the strictest rules.

- **Bottom sheet on mobile, right drawer from `sm`** — `CartSheet` and
  `ItemSheet`. Bottom-anchored, `max-h-[85svh]`/`[88svh]`, drag handle on mobile.
- **Dialogs are bottom sheets too.** `DialogContent` is anchored to the bottom
  edge below `sm` and becomes a centred dialog above it. A customer who adds an
  item and is then asked to sign in must not switch interaction models
  mid-checkout.
- **Fixed footers use `pb-safe` / `pb-safe-lg`**, which add
  `env(safe-area-inset-bottom)`. `index.html` sets `viewport-fit=cover`, so that
  inset is non-zero on iOS, and the checkout footer holds *Confirm & Pay*.
- **Phone fields are `type="tel" inputMode="tel"`.** `inputMode="numeric"`
  alone gives iOS a keypad with no `+`, and `pattern` is inert because the form
  is `noValidate`.
- The `ItemSheet` CTA bar is pinned with `sm:absolute sm:inset-x-0 sm:bottom-0`.
  `absolute` with no offsets falls back to static placement, which silently
  unpins the button mid-panel on desktop.

### Instagram feed

A custom-rendered horizontal strip, **not** a third-party iframe embed — so
there is no fixed-width embed to wrap. The card width is a CSS custom property
`--ig-card-w` on `.instagram-shell`: `78vw` on a phone (so the next card peeks
and the strip reads as swipeable), `38vw` from `sm`, clamped 220–280px from `lg`.

Below `hover: hover` the marquee animation is switched off entirely and the
viewport becomes a native scroll strip with scroll snapping. `:hover` never
sticks on touch, so an animated track there can never be paused.

### Review list

Same treatment as the Instagram strip, for the same reason, and the same bug it
fixes: the list was inside a fixed-height `overflow-hidden` window, so on a phone
every review past the first few was unreachable — the marquee could not be paused
and the window could not be scrolled. It is a real scroll area below `lg` and a
marquee above it, and the loop-seam duplicate is hidden where there is no
animation to justify it.

### Forms

Single column at every size, real `<label>` association (never placeholder-only)
so mobile autofill and screen readers both work, and `min-h-11` inputs. Inputs
use `text-base` below `md` so iOS does not zoom the viewport on focus.

### Footer

Facts are separate lines rather than one `" · "`-joined string, which wrapped to
four or five lines at 320px and left the separator stranded at a line end. The
phone number is a `tel:` link — the most useful fact in the footer on a phone.

`pb-24` reserves room for `StickyCartBar`, which is mobile-only (`md:hidden`), so
the reserve drops to `pb-12` at `md`.

---

## Touch targets

**44x44px is the floor** (WCAG 2.5.5). It is set explicitly at the call site —
`min-h-11` for a full-width control, `size-11` for an icon button — rather than in
a utility, so a call site is honest about its own layout. There is deliberately
no `tap` helper class.

**Every control has a non-hover press state.** Tailwind compiles `hover:`
utilities inside `@media (hover: hover)`, so on touch those styles are *absent*,
not merely unhelpful. The `pressable` utility supplies a plain `:active` opacity
step that always applies, and it is on `Pressable`, `Button`, and the bare
`<a>`/`<button>` cases that do not go through either. `Pressable` also keeps
`whileTap` for the non-reduced-motion case; under `prefers-reduced-motion` that
used to mean *no* feedback at all, which is backwards for the users most likely
to depend on non-motion confirmation.

Anchors used as inline links inside a sentence are exempt from WCAG 2.5.8. The
FAQ's "Get in touch" is one, and still gets `py-1 -my-1` — an 8px larger hit area
in each direction with no change to the line box.

---

## Images

**Generate derivatives after changing a bundled photo:**

```bash
python3 scripts/generate-responsive-images.py
```

The script writes downscaled variants to `src/assets/responsive/<stem>-<width>.jpg`
at 320/480/640/960/1280/1600, never upscaling. `src/lib/responsive-images.ts`
discovers them with `import.meta.glob`, so there is no generated manifest to fall
out of sync and **no build-time image dependency** — the project builds on Vite 8
/ Rolldown, where `vite-imagetools` is not reliably supported, and a working build
is worth more than the plugin.

Render bundled photos with `<ResponsiveImage>`:

```tsx
<ResponsiveImage
  src={spaceImg}
  stem="space"                              // → space-320.jpg, space-480.jpg, …
  alt="The StarKupps counter"
  width={1408}                              // the ORIGINAL's intrinsic size
  height={912}
  sizes="(min-width: 640px) 25vw, 50vw"     // required in practice
  className="aspect-square object-cover"
/>
```

- `sizes` must describe the rendered width at each breakpoint, grid fraction
  included. A wrong `sizes` is worse than no `srcset`, because it makes the
  browser pick the wrong file.
- `width`/`height` must be the **original's** intrinsic size. The browser derives
  an aspect ratio from them before CSS loads, which is what keeps below-the-fold
  images from shifting the page.
- A photo with no derivatives renders with a plain `src`. Owner-uploaded images
  from Supabase Storage go down that path — the build does not process them.
- LCP images are `loading="eager"` with `fetchPriority="high"`, and must not have
  an entrance animation.

Measured on the home page (7 bundled photos, all rendered): **747 KB before →
84–140 KB after**, i.e. 81–93% less image payload, verified at 360–1920px × 2x
and 3x.

CLS: 0.000 at 375px and 430px, ≤0.055 at tablet and above.

---

## Verification

Layout claims here were measured in a real browser, not read off the source.
The checks that matter, and roughly how to run them:

- **No horizontal page scroll** at 320/360/375/430/768/834/1024/1180/1280/1440/1920.
- **No interactive element under 44x44**, checked on the static page *and* with
  the item sheet, cart sheet and auth dialog open.
- **Both tablet orientations** (768/834 portrait, 1024/1180 landscape).
- **No console errors** on any route.
- **CLS** via a `PerformanceObserver` on `layout-shift`.

The gateway on `:3000` is not needed to check layout — intercept
`/api/public/*` and serve fixtures. The response shapes are in `src/types/*`;
getting them wrong produces false failures (a `ChargeQuote` missing `taxLines`
crashes `CartSheet` exactly as a broken gateway would).

---

## Adding a section

1. `<section className="shell section-y">` for the gutter and rhythm.
2. Grid: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`. Never a bare
   `grid-cols-3` with no responsive base.
3. Interactive elements: `min-h-11` (or `size-11`) and `pressable` if they are a
   bare `<a>`/`<button>`.
4. Images: `<ResponsiveImage>` with a real `sizes`.
5. Do not add a `max-width` query, and do not build a second mobile component tree
   — one component that adapts is the pattern.
