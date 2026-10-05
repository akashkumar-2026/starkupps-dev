import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react";
import { springs } from "@/utils/motion";
import { cn } from "@/utils/cn";

type Props = HTMLMotionProps<"button"> & { scale?: number };

/**
 * The shared touch primitive for buttons that are not `<Button>`.
 *
 * ## Feedback
 *
 * Two channels, because one is not enough on a phone:
 *
 * - `whileTap` scales the element down. Nice, but `motion` omits it entirely
 *   when `prefers-reduced-motion: reduce` is set — so those users previously got
 *   *no* press feedback whatsoever, which is backwards: they are the group most
 *   likely to be relying on non-motion confirmation that a tap registered.
 * - `active:opacity-90` is a plain CSS state that always applies, including
 *   under reduced motion.
 *
 * So `whileTap` is additive, and `pressable` is the guarantee.
 *
 * ## Target size
 *
 * 44x44 (WCAG 2.5.5) is the caller's job — pass `min-h-11` or `size-11`. This
 * component does not guess a height, because a component that silently padded
 * its children would stop call sites from being honest about their own layout.
 */
export function Pressable({ className, scale = 0.97, children, ...rest }: Props) {
  const reduced = useReducedMotion();
  return (
    <motion.button
      type="button"
      {...(reduced ? {} : { whileTap: { scale } })}
      transition={reduced ? { duration: 0.1 } : springs.addToCart}
      className={cn("pressable select-none touch-manipulation", className)}
      {...rest}
    >
      {children}
    </motion.button>
  );
}
