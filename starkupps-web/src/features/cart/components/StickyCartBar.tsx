import { AnimatePresence, motion } from "motion/react";
import { ShoppingBag } from "lucide-react";
import { Pressable } from "@/components/shared/Pressable";
import { useCart } from "@/state";
import { inr } from "@/utils/format";
import { springs } from "@/utils/motion";

/**
 * Persistent cart affordance on mobile: appears the moment a first item lands,
 * so cart state stays visible while browsing. Desktop uses the header pill.
 */
export function StickyCartBar() {
  const { count, subtotal, setOpen, open } = useCart();
  const show = count > 0 && !open;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: 90, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 90, opacity: 0 }}
          transition={springs.sheet}
          className="fixed inset-x-0 bottom-0 z-sticky-bar p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden"
        >
          <Pressable
            onClick={() => setOpen(true)}
            className="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-primary px-5 text-left text-base font-semibold text-primary-foreground shadow-raised"
          >
            <ShoppingBag className="size-5 shrink-0" />
            <span className="flex-1 tabular-nums">
              {count} {count === 1 ? "item" : "items"} · {inr(subtotal)}
            </span>
            <span className="text-sm opacity-90">View cart</span>
          </Pressable>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
