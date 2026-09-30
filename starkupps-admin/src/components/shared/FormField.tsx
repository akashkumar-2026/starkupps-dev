import type { ReactNode } from "react";

type FormFieldProps = {
  label: string;
  children: ReactNode;
};

/** Label + control pair used across every dialog and settings form. */
export function FormField({ label, children }: FormFieldProps) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-bold text-[#5A4E45]">{label}</span>
      {children}
    </label>
  );
}
