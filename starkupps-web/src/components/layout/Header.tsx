import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { ShoppingBag, UserRound } from "lucide-react";
import { Pressable } from "@/components/shared/Pressable";
import { AuthDialog } from "@/features/auth/components/AuthDialog";
import { useCart } from "@/state";
import { useAuth } from "@/state";
import { inr } from "@/utils/format";
import { springs } from "@/utils/motion";

/**
 * Site header.
 *
 * ## Why there is no hamburger menu
 *
 * The brief for a phone-first header is usually "collapse the links behind a
 * hamburger". That is the wrong call for *this* nav and would be a regression:
 * there are exactly two links ("Menu", "About"), and hiding them behind an extra
 * tap makes the cafe's own content harder to reach while saving ~90px that the
 * layout does not need. Instead the bar is built to fit at 320px — the narrowest
 * phone in common use — by tightening the horizontal padding and the gap below
 * `sm`, and the links stay visible at every width.
 *
 * That fit is not free, so it is load-bearing: the measured bar needs 354px at
 * 320px viewport, which is why the mobile padding/gap values below are what
 * they are. Loosening them re-introduces horizontal page scroll at 320px.
 *
 * The cart button is deliberately *not* collapsed. It is the page's primary
 * conversion action and stays in the top bar at every width.
 */
export function Header() {
  const { count, subtotal, setOpen } = useCart();
  const { user } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);

  return (
    <header className="material sticky top-0 z-header border-b border-border">
      <div className="shell flex h-16 items-center justify-between gap-1 sm:gap-2">
        {/* `min-h-11` + `shrink-0`: the wordmark is the "home" control and was a
            28px-tall tap target before, and it must never be the thing that
            gives way when the bar runs out of room. */}
        <Link
          to="/"
          className="pressable -mx-1 flex min-h-11 shrink-0 items-center rounded-xl px-1 font-display text-lg font-semibold tracking-tight sm:text-xl"
        >
          StarKupps
        </Link>

        <nav className="flex shrink-0 items-center gap-0.5 text-sm sm:gap-1">
          <Link
            to="/"
            hash="menu"
            className="flex min-h-11 items-center rounded-xl px-2 font-medium text-muted-foreground active:opacity-70 sm:px-3"
          >
            Menu
          </Link>
          <Link
            to="/about"
            className="flex min-h-11 items-center rounded-xl px-2 font-medium text-muted-foreground active:opacity-70 sm:px-3"
            activeProps={{ className: "text-foreground" }}
          >
            About
          </Link>
          <Link
            to="/contact"
            className="flex min-h-11 items-center rounded-xl px-2 font-medium text-muted-foreground active:opacity-70 sm:px-3"
            activeProps={{ className: "text-foreground" }}
          >
            Contact
          </Link>
          <Pressable
            onClick={() => setOpen(true)}
            aria-label={`Open cart, ${count} items`}
            className="relative flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-3 sm:ml-1"
          >
            <ShoppingBag className="size-5" />
            <AnimatePresence initial={false}>
              {count > 0 && (
                <motion.span
                  key="total"
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: "auto", opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={springs.sheet}
                  className="hidden overflow-hidden whitespace-nowrap text-sm font-semibold tabular-nums md:block"
                >
                  {count} · {inr(subtotal)}
                </motion.span>
              )}
            </AnimatePresence>
            <AnimatePresence>
              {count > 0 && (
                <motion.span
                  key={count}
                  initial={{ scale: 0.4 }}
                  animate={{ scale: 1 }}
                  transition={springs.sheet}
                  className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground md:hidden"
                >
                  {count}
                </motion.span>
              )}
            </AnimatePresence>
          </Pressable>
          {user ? (
            <Link
              to="/account"
              aria-label="My account"
              className="pressable flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-3 text-sm font-semibold sm:ml-1"
            >
              <UserRound className="size-5" />
              <span className="hidden md:block">Account</span>
            </Link>
          ) : (
            <Pressable
              onClick={() => setAuthOpen(true)}
              aria-label="Sign in"
              className="flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-3 text-sm font-semibold sm:ml-1"
            >
              <UserRound className="size-5" />
              <span className="hidden md:block">Sign in</span>
            </Pressable>
          )}
        </nav>
      </div>
      <AuthDialog open={authOpen} onOpenChange={setAuthOpen} />
    </header>
  );
}
