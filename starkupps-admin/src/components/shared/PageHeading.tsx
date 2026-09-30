import { cn } from "@/utils/cn";
import type { ReactNode } from "react";

type PageHeadingProps = {
  kicker: string;
  title: string;
  detail: string;
  action?: ReactNode;
};

/** The kicker / title / lede / actions block every workspace view opens with. */
export function PageHeading({
  kicker,
  title,
  detail,
  action,
}: PageHeadingProps) {
  return (
    <section className="mb-7 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div>
        <div className="mb-3 flex items-center gap-2">
          <span className="h-px w-7 bg-[#E2533C]" />
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#A83825]">
            {kicker}
          </span>
        </div>
        <h2 className="max-w-2xl text-3xl font-extrabold tracking-[-0.055em] md:text-[38px]">
          {title}
        </h2>
        <p className="mt-3 max-w-xl text-sm font-medium leading-6 text-[#75695E]">
          {detail}
        </p>
      </div>
      {action}
    </section>
  );
}

type SectionCardProps = {
  children: ReactNode;
  className?: string;
};

/** The standard raised panel used for content blocks inside a view. */
export function SectionCard({ children, className }: SectionCardProps) {
  return (
    <section
      className={cn(
        "rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] shadow-[0_8px_20px_rgba(55,38,25,0.04)]",
        className
      )}
    >
      {children}
    </section>
  );
}
