import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/utils/cn";

type Props = ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * The shared touch primitive for buttons that are not `<Button>`.
 *
 * ## Feedback
 *
 * Press feedback is the plain-CSS `pressable` utility (`:active` opacity
 * step): it applies on touch, with mouse and under reduced motion, and needs
 * no JS. This component used to add a `whileTap` scale via `motion/react`,
 * but that put a 130 KB animation library on the critical path of every page
 * for a nicety — the opacity step is the guaranteed channel and it stays.
 *
 * ## Target size
 *
 * 44x44 (WCAG 2.5.5) is the caller's job — pass `min-h-11` or `size-11`. This
 * component does not guess a height, because a component that silently padded
 * its children would stop call sites from being honest about their own layout.
 */
export function Pressable({ className, children, ...rest }: Props) {
  return (
    <button
      type="button"
      className={cn("pressable select-none touch-manipulation", className)}
      {...rest}
    >
      {children}
    </button>
  );
}
