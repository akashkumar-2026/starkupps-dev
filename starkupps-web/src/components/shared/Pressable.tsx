import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react";
import { springs } from "@/utils/motion";
import { cn } from "@/utils/cn";

type Props = HTMLMotionProps<"button"> & { scale?: number };

/**
 * Feedback on pointer-down (not release), 100ms, spring settle on release.
 * Min 44x44 tap target enforced by callers via padding/size classes.
 */
export function Pressable({ className, scale = 0.97, children, ...rest }: Props) {
  const reduced = useReducedMotion();
  return (
    <motion.button
      type="button"
      {...(reduced ? {} : { whileTap: { scale } })}
      transition={reduced ? { duration: 0.1 } : springs.addToCart}
      className={cn("select-none touch-manipulation", className)}
      {...rest}
    >
      {children}
    </motion.button>
  );
}
