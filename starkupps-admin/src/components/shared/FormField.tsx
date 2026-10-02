import type { ReactNode } from "react";

type FormFieldProps = {
  label: string;
  children: ReactNode;
  /** Optional helper text shown under the control. */
  hint?: string;
  className?: string;
};

/** Label + control pair used across every dialog and settings form. */
export function FormField({
  label,
  children,
  hint,
  className,
}: FormFieldProps) {
  return (
    <label className={`space-y-1.5 ${className ?? ""}`}>
      <span className="text-xs font-bold text-[#5A4E45]">{label}</span>
      {children}
      {hint ? (
        <span className="block text-xs text-[#8A7D72]">{hint}</span>
      ) : null}
    </label>
  );
}
