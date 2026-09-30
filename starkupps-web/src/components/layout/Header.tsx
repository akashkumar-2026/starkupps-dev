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

export function Header() {
  const { count, subtotal, setOpen } = useCart();
  const { user } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);

  return (
    <header className="material sticky top-0 z-30 border-b border-border">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4">
        <Link to="/" className="font-display text-xl font-semibold tracking-tight">
          StarKupps
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link
            to="/"
            hash="menu"
            className="flex min-h-11 items-center px-3 font-medium text-muted-foreground"
          >
            Menu
          </Link>
          <Link
            to="/about"
            className="flex min-h-11 items-center px-3 font-medium text-muted-foreground"
            activeProps={{ className: "text-foreground" }}
          >
            About
          </Link>
          <Pressable
            onClick={() => setOpen(true)}
            aria-label={`Open cart, ${count} items`}
            className="relative ml-1 flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-3"
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
              className="ml-1 flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-3 text-sm font-semibold"
            >
              <UserRound className="size-5" />
              <span className="hidden md:block">Account</span>
            </Link>
          ) : (
            <Pressable
              onClick={() => setAuthOpen(true)}
              aria-label="Sign in"
              className="ml-1 flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-3 text-sm font-semibold"
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
