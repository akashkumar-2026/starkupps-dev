import { Button } from "@/components/ui/button";
import { ShieldX } from "lucide-react";
import { Link } from "wouter";

export default function ForbiddenPage() {
  return (
    <div className="grid min-h-screen place-items-center bg-[#F4F0E9] p-6">
      <div className="w-full max-w-md rounded-2xl border border-[#D8CDC0] bg-[#FCFAF6] p-8 text-center shadow-[0_14px_35px_rgba(55,38,25,0.06)]">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#FFF0EA] text-[#B83D29]">
          <ShieldX className="h-6 w-6" />
        </div>
        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-[#A83825]">
          403 — Access restricted
        </p>
        <h1 className="mt-2 text-xl font-extrabold tracking-[-0.04em] text-[#211B18]">
          You don&apos;t have permission to access this area.
        </h1>
        <p className="mt-3 text-sm leading-6 text-[#776A5E]">
          This workspace is limited to your assigned role and outlets. Contact
          your administrator if you need access.
        </p>
        <Link href="/overview">
          <Button className="mt-6 w-full bg-[#211B18] text-white hover:bg-[#3A2D27]">
            Go to Overview
          </Button>
        </Link>
      </div>
    </div>
  );
}
