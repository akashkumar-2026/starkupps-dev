import { Button } from "@/components/ui/button";
import { cn } from "@/utils/cn";
import { CircleAlert, Loader2, PackageOpen } from "lucide-react";
import type { ReactNode } from "react";

/** Suspense and query placeholder. Matches the height of a content panel. */
export function PageLoading({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "grid min-h-[240px] place-items-center bg-[#F4F0E9]",
        className
      )}
    >
      <div className="text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#211B18]">
          <span className="text-sm font-extrabold text-white">SK</span>
        </div>
        <Loader2 className="mx-auto mt-5 h-5 w-5 animate-spin text-[#E2533C]" />
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-[#847669]">
          Opening the pass
        </p>
      </div>
    </div>
  );
}

type EmptyPanelProps = {
  title: string;
  detail: string;
  action?: ReactNode;
};

/** Shown when a query succeeded but there is nothing to list. */
export function EmptyPanel({ title, detail, action }: EmptyPanelProps) {
  return (
    <div className="grid min-h-[235px] place-items-center rounded-[14px] border border-dashed border-[#D5C8BA] bg-[#FCFAF6] p-6 text-center">
      <div className="max-w-sm">
        <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-[#EEE7DE] text-[#8E8174]">
          <PackageOpen className="h-5 w-5" />
        </div>
        <h3 className="mt-4 text-sm font-extrabold tracking-[-0.02em]">
          {title}
        </h3>
        <p className="mt-2 text-xs leading-5 text-[#827568]">{detail}</p>
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}

type ErrorPanelProps = {
  title?: string;
  detail: string;
  retry: () => void;
};

/** Shown when a query failed. Always offers a way back. */
export function ErrorPanel({
  title = "This section could not load",
  detail,
  retry,
}: ErrorPanelProps) {
  return (
    <div className="rounded-[14px] border border-[#F1C9BD] bg-[#FFF8F5] p-5">
      <div className="flex gap-3">
        <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-[#B83D29]" />
        <div>
          <h3 className="text-sm font-extrabold text-[#6D3025]">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-[#8D5145]">{detail}</p>
          <Button
            onClick={retry}
            variant="outline"
            className="mt-3 h-8 border-[#E8B9AC] bg-white text-xs text-[#8E392A] hover:bg-[#FFF2EE]"
          >
            Try again
          </Button>
        </div>
      </div>
    </div>
  );
}
