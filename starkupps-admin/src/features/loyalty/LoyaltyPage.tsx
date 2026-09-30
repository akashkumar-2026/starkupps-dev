import { trpc } from "@/api/trpc";
import { PageHeading } from "@/components/shared/PageHeading";
import {
  EmptyPanel,
  ErrorPanel,
  PageLoading,
} from "@/components/shared/StatePanels";
import { Button } from "@/components/ui/button";
import { apiError } from "@/utils/errors";
import { Link } from "wouter";

export default function LoyaltyPage(_props: { detailId?: number }) {
  const list = trpc.loyalty.list.useQuery({ limit: 25 });
  if (list.isLoading) return <PageLoading />;
  if (list.isError)
    return (
      <ErrorPanel detail={apiError(list.error)} retry={() => list.refetch()} />
    );
  return (
    <>
      <PageHeading
        kicker="Guest loyalty"
        title="Loyalty and retention"
        detail="View guest visit history and adjust points where authorized."
      />
      <div className="overflow-hidden rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6]">
        <div className="divide-y divide-[#E7DED4]">
          {(list.data?.items ?? []).map((m: any) => (
            <div
              key={m.id}
              className="flex items-center justify-between px-5 py-4"
            >
              <div>
                <p className="text-sm font-bold">{m.name || m.phone}</p>
                <p className="text-xs text-[#827568]">
                  {m.phone} · {m.pointsBalance ?? 0} pts
                </p>
              </div>
              <Link href={`/loyalty/${m.id}`}>
                <Button variant="outline" className="h-8 text-xs">
                  View
                </Button>
              </Link>
            </div>
          ))}
        </div>
      </div>
      {!list.data?.items.length && (
        <EmptyPanel
          title="No loyalty members yet"
          detail="Members appear as guests are added."
        />
      )}
    </>
  );
}
