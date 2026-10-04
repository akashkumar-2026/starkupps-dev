/**
 * The dialog shapes the app uses, over the shadcn primitives.
 *
 * ## Why these exist
 *
 * `DialogContent` is a bare panel, so every call site hand-assembled the same
 * four regions — header, description, scrolling body, footer — and got the
 * details wrong in different ways: footers scrolled out of view, close buttons
 * overlapping long titles, destructive confirmations styled as neutral buttons.
 * Each shape exists here once, so it is correct everywhere:
 *
 * * `AppDialog` — the read-only shell. Header stays fixed, only the body
 *   scrolls, and the footer action strip never leaves the screen.
 * * `FormDialog` — `AppDialog` whose body is a `<form>`, owning the submit
 *   button so a pending mutation can disable it without every caller wiring it.
 * * `ConfirmDialog` — a yes/no with an explicit destructive affordance.
 * * `ViewDialog` — a viewer with row-level header actions plus a footer.
 */
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/cn";
import type { ReactNode } from "react";

/**
 * Class for a primary action in a dialog footer.
 *
 * Applied from one place so the "next step" button in a ticket, and the same
 * button in a settings form, are the same colour rather than each caller
 * choosing a hex value.
 */
export const dialogPrimaryAction = "bg-[#211B18] text-white hover:bg-[#3A2D27]";

/**
 * Class for a destructive confirm action.
 *
 * Destructive buttons were individually styled, and the result was inconsistent
 * — some red, some plain outlines sitting next to each other. One class so
 * "this cannot be undone" always looks the same.
 */
export const dialogDangerAction = "bg-[#B83D29] text-white hover:bg-[#962C20]";

type DialogSize = "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";

type AppDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Action strip pinned below the body, outside the scroll area. */
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  titleClassName?: string;
  size?: DialogSize;
};

/**
 * The shared shell.
 *
 * `<Dialog>` is the root of every branch, including when `children` is absent —
 * `DialogContent` renders a `DialogPortal`, which requires Radix's `Dialog`
 * context, so returning a bare `DialogContent` for a loading or empty state
 * throws and takes the whole panel into its error boundary.
 */
export function AppDialog({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
  className,
  bodyClassName,
  titleClassName,
  size = "md",
}: AppDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size={size} className={className}>
        <DialogHeader>
          <DialogTitle className={titleClassName}>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogBody className={bodyClassName}>{children}</DialogBody>
        {footer ? <DialogFooter>{footer}</DialogFooter> : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * A dialog whose body is a form.
 *
 * `onSubmit` receives the DOM event and is expected to call `preventDefault()`
 * itself — the handler is attached to the `<form>`, so browser validation still
 * applies.
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  onSubmit,
  submitLabel = "Save",
  cancelLabel = "Cancel",
  submitPending = false,
  submitDisabled = false,
  isDirty = false,
  destructive = false,
  formClassName,
  bodyClassName,
  titleClassName,
  className,
  size = "md",
  children,
}: AppDialogProps & {
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  submitLabel?: ReactNode;
  cancelLabel?: ReactNode;
  /** Disables the submit button and marks the dialog busy. */
  submitPending?: boolean;
  /**
   * Disables submit because the form is invalid, not because it is submitting.
   *
   * Kept separate from `submitPending` so a caller can express both: a cancel
   * dialog whose reason is too short is disabled on its own merits, and becomes
   * `pending` only while the mutation runs.
   */
  submitDisabled?: boolean;
  /**
   * Applies the destructive styling to the submit button.
   *
   * Separate from the label because a form can legitimately *save* something
   * dangerous (cancelling an order) without the dialog reading as a warning.
   */
  destructive?: boolean;
  /**
   * Guards an accidental close.
   *
   * Only meaningful when the operator has unsaved work, so it is opt-in: without
   * it, `pending` alone would block the only way out of a failed submit.
   */
  isDirty?: boolean;
  formClassName?: string;
}) {
  return (
    <AppDialog
      open={open}
      onOpenChange={next => {
        // Discard is refused only while both busy and dirty, so a failed submit
        // never leaves the operator unable to close the dialog.
        if (!next && (submitPending || isDirty)) return;
        onOpenChange(next);
      }}
      title={title}
      description={description}
      titleClassName={titleClassName}
      className={className}
      bodyClassName={bodyClassName}
      size={size}
    >
      <form onSubmit={onSubmit} className={cn("contents", formClassName)}>
        <DialogBody className={bodyClassName}>{children}</DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitPending}
          >
            {cancelLabel}
          </Button>
          <Button
            type="submit"
            disabled={submitPending || submitDisabled}
            className={cn(destructive && dialogDangerAction)}
          >
            {submitLabel}
          </Button>
        </DialogFooter>
      </form>
    </AppDialog>
  );
}

/** A yes/no dialog, with the confirm action styled for its consequence. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  pending = false,
  size = "sm",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  onConfirm: () => void;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  /** Applies the destructive styling. */
  destructive?: boolean;
  /** Disables both actions while the mutation is in flight. */
  pending?: boolean;
  className?: string;
  size?: DialogSize;
}) {
  return (
    <AppDialog
      open={open}
      onOpenChange={next => {
        if (!next && pending) return;
        onOpenChange(next);
      }}
      title={title}
      description={description}
      size={size}
    >
      <DialogFooter>
        <Button
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={pending}
        >
          {cancelLabel}
        </Button>
        <Button
          className={cn(destructive && dialogDangerAction)}
          onClick={onConfirm}
          disabled={pending}
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </AppDialog>
  );
}

/**
 * A read-only viewer.
 *
 * `headerActions` sits in the header for row-level actions (edit, archive) that
 * must stay reachable while the body scrolls; `footer` carries the primary
 * action.
 */
export function ViewDialog({
  headerActions,
  footer,
  ...props
}: AppDialogProps & {
  headerActions?: ReactNode;
}) {
  return (
    <AppDialog {...props} size={props.size ?? "lg"} footer={footer}>
      {headerActions ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {headerActions}
        </div>
      ) : null}
      {props.children}
    </AppDialog>
  );
}
