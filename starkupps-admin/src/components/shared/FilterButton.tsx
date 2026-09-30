import { cn } from "@/utils/cn";

type FilterButtonProps = {
  label: string;
  active: boolean;
  onClick: () => void;
};

/** Pill toggle inside a segmented filter bar. */
export function FilterButton({ label, active, onClick }: FilterButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg px-3 py-2 text-xs font-bold transition",
        active
          ? "bg-[#FCFAF6] text-[#211B18] shadow-sm"
          : "text-[#766A5F] hover:text-[#211B18]"
      )}
    >
      {label}
    </button>
  );
}
