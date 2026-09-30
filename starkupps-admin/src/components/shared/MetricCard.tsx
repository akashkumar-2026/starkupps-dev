import { cn } from "@/utils/cn";

export type MetricTone = "red" | "amber" | "green" | "ink";

const TONE_DOT: Record<MetricTone, string> = {
  red: "bg-[#E2533C]",
  amber: "bg-[#D5962A]",
  green: "bg-[#468A61]",
  ink: "bg-[#685E55]",
};

type MetricCardProps = {
  label: string;
  value: string;
  detail: string;
  tone?: MetricTone;
};

/** A single headline figure with a status dot. */
export function MetricCard({
  label,
  value,
  detail,
  tone = "ink",
}: MetricCardProps) {
  return (
    <div className="rounded-[12px] border border-[#DAD0C5] bg-[#FCFAF6] p-4 shadow-[0_3px_0_rgba(77,55,37,0.05)]">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#8B7E71]">
          {label}
        </span>
        <span className={cn("h-2 w-2 rounded-full", TONE_DOT[tone])} />
      </div>
      <p className="mt-3 text-[26px] font-extrabold tracking-[-0.055em] text-[#211B18]">
        {value}
      </p>
      <p className="mt-1 text-[11px] font-semibold text-[#827568]">{detail}</p>
    </div>
  );
}

type MetricGridProps = {
  children: React.ReactNode;
  className?: string;
};

/** Responsive four-up grid for {@link MetricCard}. */
export function MetricGrid({ children, className }: MetricGridProps) {
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2 xl:grid-cols-4", className)}>
      {children}
    </div>
  );
}
