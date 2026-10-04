import { cn } from "@/utils/cn";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { XIcon } from "lucide-react";
import * as React from "react";

// Context to track composition state across dialog children
const DialogCompositionContext = React.createContext<{
  isComposing: () => boolean;
  setComposing: (composing: boolean) => void;
  justEndedComposing: () => boolean;
  markCompositionEnd: () => void;
}>({
  isComposing: () => false,
  setComposing: () => {},
  justEndedComposing: () => false,
  markCompositionEnd: () => {},
});

export const useDialogComposition = () =>
  React.useContext(DialogCompositionContext);

/*
 * The dialog shell.
 *
 * Every modal in Starkupps Admin is a three-region flex column: a header that
 * never moves, a body that is the only scroll container, and a footer that
 * never moves. `overflow-hidden` plus a capped `max-height` is what guarantees
 * the outer panel can never become the scroller — the region that scrolls is
 * `DialogBody`, which is a sibling of neither and cannot inherit the mistake.
 */
const dialogContentVariants = cva(
  [
    "bg-dialog text-dialog-foreground fixed top-[50%] left-[50%] z-50 flex max-h-(--dialog-max-height) w-full max-w-[calc(100%-1rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden",
    "rounded-lg border border-dialog-border p-0 shadow-lg",
    "duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out",
    "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
    "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
  ],
  {
    variants: {
      size: {
        sm: "sm:max-w-sm",
        md: "sm:max-w-md",
        lg: "sm:max-w-lg",
        xl: "sm:max-w-xl",
        "2xl": "sm:max-w-2xl",
        "3xl": "sm:max-w-3xl",
        "4xl": "sm:max-w-4xl",
        full: "sm:max-w-[min(90rem,100%)]",
      },
    },
    defaultVariants: {
      size: "lg",
    },
  }
);

type DialogSize = NonNullable<
  VariantProps<typeof dialogContentVariants>["size"]
>;

export type { DialogSize };

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  const composingRef = React.useRef(false);
  const justEndedRef = React.useRef(false);
  const endTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const contextValue = React.useMemo(
    () => ({
      isComposing: () => composingRef.current,
      setComposing: (composing: boolean) => {
        composingRef.current = composing;
      },
      justEndedComposing: () => justEndedRef.current,
      markCompositionEnd: () => {
        justEndedRef.current = true;
        if (endTimerRef.current) {
          clearTimeout(endTimerRef.current);
        }
        endTimerRef.current = setTimeout(() => {
          justEndedRef.current = false;
        }, 150);
      },
    }),
    []
  );

  React.useEffect(
    () => () => {
      if (endTimerRef.current) clearTimeout(endTimerRef.current);
    },
    []
  );

  return (
    <DialogCompositionContext.Provider value={contextValue}>
      <DialogPrimitive.Root data-slot="dialog" {...props} />
    </DialogCompositionContext.Provider>
  );
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return (
    // `type="button"` is explicit so a close control can never submit a form
    // that happens to wrap the dialog.
    <DialogPrimitive.Close type="button" data-slot="dialog-close" {...props} />
  );
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
        className
      )}
      {...props}
    />
  );
}

DialogOverlay.displayName = "DialogOverlay";

/** The one close affordance every dialog shares, sized and placed by token. */
function DialogCloseButton({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return (
    <DialogPrimitive.Close
      type="button"
      data-slot="dialog-close-button"
      className={cn(
        "ring-offset-background focus:ring-ring hover:bg-accent hover:text-accent-foreground absolute top-(--dialog-close-offset) right-(--dialog-close-offset) z-10 grid size-7 place-items-center rounded-md text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      {...props}
    >
      <XIcon className="size-4" />
      <span className="sr-only">Close dialog</span>
    </DialogPrimitive.Close>
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  onEscapeKeyDown,
  size,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
  size?: DialogSize;
}) {
  const { isComposing } = useDialogComposition();

  const handleEscapeKeyDown = React.useCallback(
    (e: KeyboardEvent) => {
      // Check both the IME composition flag and our own context state; Safari
      // reports composition inconsistently, so either signal suppresses close.
      // `isComposing` is a vendor extension, so it is not in the DOM types.
      const isCurrentlyComposing =
        (e as KeyboardEvent & { isComposing?: boolean }).isComposing === true ||
        isComposing();

      // If IME is composing, prevent dialog from closing
      if (isCurrentlyComposing) {
        e.preventDefault();
        return;
      }

      // Call user's onEscapeKeyDown if provided
      onEscapeKeyDown?.(e);
    },
    [isComposing, onEscapeKeyDown]
  );

  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(dialogContentVariants({ size }), className)}
        onEscapeKeyDown={handleEscapeKeyDown}
        {...props}
      >
        {children}
        {showCloseButton && <DialogCloseButton />}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

/*
 * Fixed header. It is a flex child with `shrink-0`, never a positioned overlay,
 * so it cannot be pushed out of view by body content. The trailing padding
 * reserves the close button's lane, which is what lets a long title wrap
 * instead of colliding with it.
 */
function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        "flex shrink-0 flex-col gap-1 border-b border-dialog-divider bg-dialog px-(--dialog-pad-x) py-(--dialog-pad-header-y) pr-[calc(var(--dialog-pad-x)+var(--dialog-close-gutter))] text-left",
        className
      )}
      {...props}
    />
  );
}

/*
 * The one scrollable region.
 *
 * `min-h-0` lets a flex child actually shrink below its content height — without
 * it the body refuses to compress and the shell overflows instead. The scrollbar
 * is hidden (never the scroll), and `scroll-shadow-y` keeps a hairline visible
 * while there is more content above or below.
 */
function DialogBody({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const ref = React.useRef<HTMLDivElement>(null);

  // Structural guard, dev only. The layout makes a mis-structured dialog look
  // wrong rather than broken, which is easy to ship; this makes it loud.
  React.useEffect(() => {
    if (!import.meta.env.DEV) return;
    const node = ref.current;
    if (!node) return;
    for (const child of Array.from(node.children)) {
      const slot = (child as HTMLElement).dataset?.slot;
      if (slot === "dialog-header" || slot === "dialog-footer") {
        console.warn(
          `[dialog] <${slot}> was rendered inside <DialogBody>. Header and ` +
            `footer must be siblings of the body so they stay fixed; move it up ` +
            `one level.`
        );
      }
    }
  }, [children]);

  return (
    <div
      ref={ref}
      data-slot="dialog-body"
      className={cn(
        "scrollbar-none scroll-shadow-y min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-(--dialog-pad-x) py-(--dialog-pad-body-y)",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** Fixed footer. `flex-col-reverse` stacks actions full-width on a phone. */
function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex shrink-0 flex-col-reverse gap-2 border-t border-dialog-divider bg-dialog px-(--dialog-pad-x) py-(--dialog-pad-footer-y) sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "text-dialog-ink text-[15px] leading-tight font-semibold",
        className
      )}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-dialog-muted text-xs leading-relaxed text-balance",
        className
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogCloseButton,
  DialogContent,
  dialogContentVariants,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
