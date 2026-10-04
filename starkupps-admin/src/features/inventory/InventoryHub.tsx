import { dateText, inr, inrOrUnavailable } from "@/utils/format";
import {
  ConfirmDialog,
  FormDialog,
  ViewDialog,
} from "@/components/shared/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/api/trpc";
import { useOutlet } from "@/state/outlet-provider";
import {
  AlertTriangle,
  ChevronLeft,
  ClipboardList,
  Download,
  Factory,
  Leaf,
  ListFilter,
  Loader2,
  PackagePlus,
  PackageSearch,
  Pencil,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  ShoppingCart,
  Trash2,
  Truck,
  Warehouse,
  X,
  FlaskConical,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

const units = [
  "kg",
  "g",
  "L",
  "ml",
  "units",
  "packs",
  "boxes",
  "bottles",
] as const;
const tabs = [
  ["overview", "Overview", "/inventory"],
  ["materials", "Materials", "/inventory/materials"],
  ["prepared", "Prepared Items", "/inventory/prepared-items"],
  ["recipes", "Recipes", "/inventory/recipes"],
  ["movements", "Stock Movements", "/inventory/movements"],
  ["purchases", "Purchase Orders", "/inventory/purchases"],
  ["suppliers", "Suppliers", "/inventory/suppliers"],
  ["transfers", "Stock Transfers", "/inventory/transfers"],
  ["wastage", "Wastage", "/inventory/wastage"],
  ["lowstock", "Low Stock", "/inventory/low-stock"],
] as const;
type Tab = (typeof tabs)[number][0];
type FormItem = {
  name: string;
  sku: string;
  categoryId: string;
  supplierId: string;
  description: string;
  quantity: string;
  unit: (typeof units)[number];
  reorderLevel: string;
  maxStockLevel: string;
  unitCost: string;
  storageLocation: string;
  expiryDate: string;
  lotNumber: string;
  notes: string;
  active: boolean;
};
const blankItem = (): FormItem => ({
  name: "",
  sku: "",
  categoryId: "",
  supplierId: "",
  description: "",
  quantity: "0",
  unit: "units",
  reorderLevel: "0",
  maxStockLevel: "",
  unitCost: "0",
  storageLocation: "",
  expiryDate: "",
  lotNumber: "",
  notes: "",
  active: true,
});
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "This change could not be completed. Please try again.";
const dateInput = (value: string | Date | null | undefined) =>
  value ? new Date(value).toISOString().slice(0, 10) : "";

function InventoryHeading({
  kicker,
  title,
  detail,
  action,
}: {
  kicker: string;
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <section className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div>
        <p className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#A83825]">
          <span className="h-px w-7 bg-[#E2533C]" />
          {kicker}
        </p>
        <h2 className="text-3xl font-extrabold tracking-[-0.055em] md:text-[38px]">
          {title}
        </h2>
        <p className="mt-3 max-w-2xl text-sm font-medium leading-6 text-[#75695E]">
          {detail}
        </p>
      </div>
      {action}
    </section>
  );
}
function Metric({
  label,
  value,
  detail,
  tone = "ink",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "red" | "amber" | "green" | "ink";
}) {
  const dot = {
    red: "bg-[#E2533C]",
    amber: "bg-[#D5962A]",
    green: "bg-[#468A61]",
    ink: "bg-[#685E55]",
  }[tone];
  return (
    <article className="rounded-[12px] border border-[#DAD0C5] bg-[#FCFAF6] p-4 shadow-[0_3px_0_rgba(77,55,37,0.05)]">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#8B7E71]">
          {label}
        </span>
        <span className={`h-2 w-2 rounded-full ${dot}`} />
      </div>
      <p className="mt-3 text-[26px] font-extrabold tracking-[-0.055em]">
        {value}
      </p>
      <p className="mt-1 text-[11px] font-semibold text-[#827568]">{detail}</p>
    </article>
  );
}
function LoadingPanel() {
  return (
    <div className="grid min-h-[260px] place-items-center rounded-[14px] border border-dashed border-[#D5C8BA] bg-[#FCFAF6]">
      <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
    </div>
  );
}
function ErrorPanel({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="rounded-[14px] border border-[#F1C9BD] bg-[#FFF8F5] p-5 text-sm text-[#8D5145]">
      <p className="font-bold text-[#6D3025]">
        This inventory data could not load.
      </p>
      <p className="mt-1">{errorText(error)}</p>
      <Button
        onClick={retry}
        variant="outline"
        className="mt-3 border-[#E8B9AC] bg-white text-xs text-[#8E392A]"
      >
        Try again
      </Button>
    </div>
  );
}
function StatusBadge({ status }: { status: string }) {
  const meta: Record<string, [string, string]> = {
    in_stock: ["Healthy", "border-[#BDE0C8] bg-[#E5F2E9] text-[#2F6947]"],
    healthy: ["Healthy", "border-[#BDE0C8] bg-[#E5F2E9] text-[#2F6947]"],
    low_stock: ["Low Stock", "border-[#EFD79B] bg-[#FBF0D5] text-[#8A5D10]"],
    critical: ["Critical", "border-[#F3C5B9] bg-[#FBE4DD] text-[#A83825]"],
    out_of_stock: [
      "Out of Stock",
      "border-[#F3C5B9] bg-[#FBE4DD] text-[#A83825]",
    ],
    expiring_soon: [
      "Expiring Soon",
      "border-[#E9D49D] bg-[#FDF3D9] text-[#8A5D10]",
    ],
    expired: ["Expired", "border-[#F1C9BD] bg-[#FFF0EA] text-[#9A3627]"],
  };
  const [label, cls] = meta[status] ?? [
    status,
    "border-[#E3D9CE] bg-[#F6F0E8] text-[#706356]",
  ];
  return (
    <Badge className={`whitespace-nowrap border text-[9px] ${cls}`}>
      {label}
    </Badge>
  );
}

export default function InventoryHub({ detailId }: { detailId?: number }) {
  const [location, setLocation] = useLocation();
  const { selectedId: outletId, outlets } = useOutlet();
  const role = trpc.admin.bootstrap.useQuery().data?.staffRole;
  const canManage = role === "owner" || role === "manager";
  // Detail for material
  if (detailId)
    return (
      <ItemDetail
        itemId={detailId}
        canManage={canManage}
        onBack={() => setLocation("/inventory/materials")}
      />
    );
  // Tab resolution with backwards compat
  const loc = location.toLowerCase();
  let tab: Tab = "overview";
  if (loc.includes("prepared")) tab = "prepared";
  else if (loc.includes("recipe")) tab = "recipes";
  else if (loc.includes("movement") || loc.includes("transaction"))
    tab = "movements";
  else if (loc.includes("purchase") || loc.includes("purchases"))
    tab = "purchases";
  else if (loc.includes("supplier")) tab = "suppliers";
  else if (loc.includes("transfer")) tab = "transfers";
  else if (loc.includes("wastage")) tab = "wastage";
  else if (loc.includes("low") || loc.includes("attention")) tab = "lowstock";
  else if (loc.includes("materials")) tab = "materials";
  else if (loc === "/inventory" || loc === "/inventory/") tab = "overview";
  else tab = "materials";
  return (
    <>
      {/* Header with outlet selector, search, export */}
      <InventoryHeader
        tab={tab}
        onNavigate={setLocation}
        outletId={outletId}
        outlets={outlets}
      />
      <div
        className="mb-6 flex flex-wrap gap-2 overflow-x-auto pb-1"
        aria-label="Inventory sections"
      >
        {tabs.map(([id, label, href]) => (
          <button
            key={id}
            onClick={() => setLocation(href)}
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-bold transition ${tab === id ? "bg-[#211B18] text-white shadow-sm" : "border border-[#DCCFC2] bg-[#FCFAF6] text-[#6C6055] hover:bg-white"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "overview" && (
        <InventoryOverview outletId={outletId} onNavigate={setLocation} />
      )}
      {tab === "materials" && (
        <InventoryItems canManage={canManage} outletId={outletId} />
      )}
      {tab === "prepared" && (
        <PreparedItemsView outletId={outletId} canManage={canManage} />
      )}
      {tab === "recipes" && (
        <RecipesView outletId={outletId} canManage={canManage} />
      )}
      {tab === "movements" && <TransactionsView />}
      {tab === "purchases" && <PurchaseOrdersView canManage={canManage} />}
      {tab === "suppliers" && <SuppliersView canManage={canManage} />}
      {tab === "transfers" && (
        <TransfersView outletId={outletId} canManage={canManage} />
      )}
      {tab === "wastage" && (
        <WastageView outletId={outletId} canManage={canManage} />
      )}
      {tab === "lowstock" && (
        <LowStockView outletId={outletId} onNavigate={setLocation} />
      )}
    </>
  );
}

function InventoryHeader({
  tab,
  onNavigate,
  outletId,
  outlets,
}: {
  tab: Tab;
  onNavigate: (href: string) => void;
  outletId: number | null;
  outlets: any[];
}) {
  const { setSelectedId } = useOutlet();
  const [search, setSearch] = useState("");
  // Debounced search is handled inside Materials tab; header search just navigates to materials with query? For now local
  return (
    <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-3 shadow-[0_2px_8px_rgba(55,38,25,0.04)]">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 rounded-lg border border-[#DCCFC2] bg-white px-2 py-1.5">
          <Warehouse className="h-4 w-4 text-[#8E8174]" />
          <select
            value={outletId ? String(outletId) : "all"}
            onChange={e =>
              setSelectedId(
                e.target.value === "all" ? null : Number(e.target.value)
              )
            }
            className="bg-transparent text-xs font-bold outline-none"
          >
            <option value="all">All Outlets</option>
            {outlets.map((o: any) => (
              <option key={o.id} value={String(o.id)}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        <span className="hidden text-xs text-[#8B7E71] sm:inline">
          •{" "}
          {tab === "overview"
            ? "Command center"
            : tabs.find(t => t[0] === tab)?.[1]}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative hidden sm:block">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[#8E8174]" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search inventory..."
            onKeyDown={e => {
              if (e.key === "Enter" && search.trim())
                onNavigate(
                  `/inventory/materials?search=${encodeURIComponent(search.trim())}`
                );
            }}
            className="h-9 w-56 border-[#DCCFC2] bg-white pl-8 text-xs"
          />
        </div>
        <Button
          variant="outline"
          className="h-9 border-[#D8CDC0] bg-white text-xs"
          onClick={() =>
            toast.info(
              "Export uses real persisted records. Use Materials → Export for filtered CSV."
            )
          }
        >
          <Download className="mr-1 h-4 w-4" />
          Export
        </Button>
      </div>
    </div>
  );
}

function InventoryOverview({
  outletId,
  onNavigate,
}: {
  outletId: number | null;
  onNavigate: (href: string) => void;
}) {
  const overview = trpc.inventory.overview.useQuery(
    outletId ? { outletId } : undefined
  );
  const health = trpc.inventory.stockHealth.useQuery(
    outletId ? { outletId } : undefined
  );
  const low = trpc.inventory.lowStock.useQuery(
    outletId ? { outletId, limit: 6 } : { limit: 6 }
  );
  const tx = trpc.inventory.transactions.useQuery({ limit: 8 });
  if (overview.isLoading || health.isLoading) return <LoadingPanel />;
  if (overview.isError)
    return (
      <ErrorPanel error={overview.error} retry={() => overview.refetch()} />
    );
  if (health.isError)
    return <ErrorPanel error={health.error} retry={() => health.refetch()} />;
  const o = overview.data!;
  const h = health.data!;
  const lowItems = low.data ?? [];
  if (!o.totalMaterials && o.stockValue === 0 && o.pendingPurchases === 0) {
    return (
      <div className="grid min-h-[320px] place-items-center rounded-[14px] border border-dashed border-[#D5C8BA] bg-[#FCFAF6] p-8 text-center">
        <Warehouse className="mx-auto h-10 w-10 text-[#A39486]" />
        <h3 className="mt-4 text-lg font-extrabold">
          No inventory data available yet.
        </h3>
        <p className="mt-2 max-w-md text-xs leading-5 text-[#827568]">
          Add materials to start tracking StarKupps inventory. Materials,
          prepared items and recipes will appear here once created.
        </p>
        <Button
          onClick={() => onNavigate("/inventory/materials")}
          className="mt-4 bg-[#E2533C] text-xs text-white"
        >
          Add Material
        </Button>
      </div>
    );
  }
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Metric
          label="Total Materials"
          value={String(o.totalMaterials)}
          detail="Active materials"
          tone="ink"
        />
        <Metric
          label="Low Stock"
          value={String(o.lowStock)}
          detail="At or below reorder"
          tone="amber"
        />
        <Metric
          label="Out of Stock"
          value={String(o.outOfStock)}
          detail="Requires immediate attention"
          tone="red"
        />
        <Metric
          label="Pending Purchases"
          value={String(o.pendingPurchases)}
          detail="Draft / ordered / partial"
          tone="ink"
        />
        <Metric
          label="Stock Value"
          value={inr(o.stockValue)}
          detail="Quantity × unit cost"
          tone="green"
        />
        <Metric
          label="Wastage This Month"
          value={inrOrUnavailable(o.wastageThisMonth, "Not available")}
          detail={`${o.expiringSoon} expiring soon`}
          tone="red"
        />
      </div>
      {o.consumedToday || o.pendingTransfers ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Metric
            label="Materials Consumed Today"
            value={String(o.consumedToday)}
            detail="Consumption movements today"
            tone="ink"
          />
          <Metric
            label="Pending Transfers"
            value={String(o.pendingTransfers)}
            detail="Requested / approved / in transit"
            tone="amber"
          />
          <div className="rounded-[12px] border border-[#DAD0C5] bg-[#FCFAF6] p-4 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#8B7E71]">
              Outlet scope
            </span>
            <span className="text-xs font-bold">
              {outletId ? `Outlet #${outletId}` : "All Outlets"}
            </span>
          </div>
        </div>
      ) : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5 shadow-[0_8px_20px_rgba(55,38,25,0.04)] lg:col-span-2">
          <h3 className="text-sm font-extrabold">Stock Health</h3>
          <p className="mt-1 text-xs text-[#776A5E]">
            Healthy, low, critical, out of stock, expired — derived from real
            stock vs reorder and expiry.
          </p>
          <div className="mt-4 space-y-3">
            {[
              ["Healthy", h.pct.healthy, "bg-[#468A61]", h.healthy],
              ["Low Stock", h.pct.low, "bg-[#D5962A]", h.low],
              ["Critical", h.pct.critical, "bg-[#E2533C]", h.critical],
              ["Out of Stock", h.pct.out, "bg-[#211B18]", h.out],
              ["Expired", h.pct.expired, "bg-[#8B7E71]", h.expired],
            ].map(([label, pct, color, count]: any) => (
              <div key={label} className="flex items-center gap-3">
                <span className="w-24 text-xs font-bold text-[#5A4E45]">
                  {label}
                </span>
                <div className="flex-1 h-2 rounded-full bg-[#EEE9E1] overflow-hidden">
                  <div
                    className={`h-2 ${color}`}
                    style={{ width: `${Math.max(4, pct)}%` }}
                  />
                </div>
                <span className="w-12 text-right font-mono text-xs font-bold">
                  {pct}%
                </span>
                <span className="w-8 text-right text-xs text-[#8B7E71]">
                  {count}
                </span>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5 shadow-[0_8px_20px_rgba(55,38,25,0.04)]">
          <h3 className="text-sm font-extrabold flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-[#A83825]" />
            Low Stock
          </h3>
          {!lowItems.length ? (
            <p className="mt-4 rounded-xl border border-dashed border-[#D5C8BA] bg-white p-4 text-center text-xs text-[#827568]">
              No low stock alerts. All materials above reorder level.
            </p>
          ) : (
            <div className="mt-3 divide-y divide-[#E7DED4] rounded-xl border border-[#E7DED4] bg-white">
              {lowItems.map((item: any) => (
                <div key={item.id} className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-extrabold">{item.name}</p>
                      <p className="text-[11px] text-[#8B7E71]">
                        {item.outletName ??
                          (item.outletId
                            ? `Outlet #${item.outletId}`
                            : "Global")}{" "}
                        • {item.quantity} {item.unit} / min {item.reorderLevel}{" "}
                        {item.unit}
                      </p>
                    </div>
                    <StatusBadge status={item.status} />
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Button
                      variant="outline"
                      className="h-7 flex-1 border-[#D8CDC0] bg-white px-2 text-[10px]"
                      onClick={() =>
                        onNavigate(`/inventory/materials/${item.id}`)
                      }
                    >
                      View
                    </Button>
                    <Button
                      className="h-7 flex-1 bg-[#211B18] px-2 text-[10px] text-white"
                      onClick={() => onNavigate("/inventory/purchases")}
                    >
                      Create PO
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5 shadow-[0_8px_20px_rgba(55,38,25,0.04)]">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-extrabold">Recent Movements</h3>
            <Button
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => onNavigate("/inventory/movements")}
            >
              View all
            </Button>
          </div>
          {!tx.data?.length ? (
            <p className="mt-4 text-center text-xs text-[#827568]">
              No movements yet.
            </p>
          ) : (
            <div className="mt-3 divide-y divide-[#E7DED4] rounded-xl border border-[#E7DED4] bg-white">
              {tx.data.slice(0, 6).map((row: any) => (
                <div
                  key={row.id}
                  className="flex items-center justify-between p-3"
                >
                  <div>
                    <p className="text-xs font-bold">{row.itemName}</p>
                    <p className="text-[11px] text-[#8B7E71]">
                      {row.type} • {dateText(row.createdAt)}
                    </p>
                  </div>
                  <span
                    className={`font-mono text-xs font-bold ${row.quantityChange < 0 ? "text-[#A83825]" : "text-[#2F6947]"}`}
                  >
                    {row.quantityChange > 0 ? "+" : ""}
                    {row.quantityChange} {row.unit}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5 shadow-[0_8px_20px_rgba(55,38,25,0.04)]">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-extrabold">
              Recent Inventory Activity
            </h3>
            <Button
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => onNavigate("/inventory/movements")}
            >
              View all
            </Button>
          </div>
          <p className="mt-1 text-xs text-[#776A5E]">
            Purchases, transfers, wastage and adjustments from the immutable
            ledger.
          </p>
          {tx.isLoading ? (
            <div className="mt-4">
              <LoadingPanel />
            </div>
          ) : !tx.data?.length ? (
            <div className="mt-4 rounded-xl border border-dashed border-[#D5C8BA] bg-white p-4 text-center text-xs text-[#827568]">
              Activity is derived from stock movements. Create a purchase
              receipt or record wastage to see entries here.
            </div>
          ) : (
            <div className="mt-3 divide-y divide-[#E7DED4] rounded-xl border border-[#E7DED4] bg-white">
              {tx.data.slice(0, 8).map((row: any) => (
                <div
                  key={row.id}
                  className="flex items-center justify-between p-3"
                >
                  <div>
                    <p className="text-xs font-bold">{row.itemName}</p>
                    <p className="text-[11px] text-[#8B7E71]">
                      {row.type} • {dateText(row.createdAt)}
                    </p>
                  </div>
                  <span
                    className={`font-mono text-xs font-bold ${row.quantityChange < 0 ? "text-[#A83825]" : "text-[#2F6947]"}`}
                  >
                    {row.quantityChange > 0 ? "+" : ""}
                    {row.quantityChange} {row.unit}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function InventoryItems({
  canManage,
  outletId,
}: {
  canManage: boolean;
  outletId: number | null;
}) {
  const utils = trpc.useUtils();
  const [addOpen, setAddOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [status, setStatus] = useState("");
  const [sortBy, setSortBy] = useState<
    | "name"
    | "quantity"
    | "reorderLevel"
    | "unitCost"
    | "inventoryValue"
    | "expiryDate"
    | "updatedAt"
  >("name");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState<number[]>([]);
  const [, setLocation] = useLocation();
  const filters = useMemo(
    () =>
      ({
        search: search.trim() || undefined,
        categoryId: categoryId ? Number(categoryId) : undefined,
        supplierId: supplierId ? Number(supplierId) : undefined,
        status:
          (status as
            | "in_stock"
            | "low_stock"
            | "out_of_stock"
            | "expiring_soon"
            | "expired") || undefined,
        sortBy,
        direction,
        outletId: outletId ?? undefined,
      }) as any,
    [search, categoryId, supplierId, status, sortBy, direction, outletId]
  );
  const [items, categories, suppliers] = [
    trpc.inventory.list.useQuery(filters),
    trpc.inventory.categories.list.useQuery(),
    trpc.inventory.suppliers.list.useQuery(),
  ];
  const exportCsv = () => {
    const rows = (items.data?.items ?? []).filter(
      item => !selected.length || selected.includes(item.id)
    );
    if (!rows.length)
      return toast.error("There are no inventory records to export.");
    const header = [
      "Material",
      "Category",
      "SKU",
      "Current Stock",
      "Unit",
      "Minimum Stock",
      "Status",
      "Cost",
      "Outlet",
      "Updated",
    ];
    const esc = (value: unknown) =>
      `"${String(value ?? "").replaceAll('"', '""')}"`;
    const csv = [
      header,
      ...rows.map((item: any) => [
        item.name,
        item.categoryName,
        item.sku,
        item.quantity,
        item.unit,
        item.reorderLevel,
        item.status,
        item.unitCost,
        item.outletName ??
          (item.outletId ? `Outlet #${item.outletId}` : "Global"),
        dateInput(item.updatedAt),
      ]),
    ]
      .map(row => row.map(esc).join(","))
      .join("\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" })
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `starkupps-materials-${outletId ?? "all"}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success(
      `Exported ${rows.length} real inventory record${rows.length === 1 ? "" : "s"}.`
    );
  };
  const reset = () => {
    setSearch("");
    setCategoryId("");
    setSupplierId("");
    setStatus("");
    setSortBy("name");
    setDirection("asc");
    setSelected([]);
  };
  return (
    <>
      <InventoryHeading
        kicker="Materials"
        title="Materials are inventory."
        detail="Every material is outlet-scoped. Recipes consume materials — menu products do not hold stock."
        action={
          canManage ? (
            <div className="flex gap-2">
              <Button
                onClick={() => setCategoryOpen(true)}
                variant="outline"
                className="border-[#D8CDC0] bg-[#FCFAF6] text-xs"
              >
                <ListFilter className="mr-1 h-4 w-4" />
                Categories
              </Button>
              <Button
                onClick={() => setAddOpen(true)}
                className="bg-[#E2533C] text-xs text-white hover:bg-[#C94734]"
              >
                <Plus className="mr-1 h-4 w-4" />
                Add material
              </Button>
            </div>
          ) : undefined
        }
      />
      <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-4 shadow-[0_8px_20px_rgba(55,38,25,0.04)]">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_150px_150px_150px_auto]">
          <label className="relative">
            <span className="sr-only">Search materials</span>
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[#8E8174]" />
            <Input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search material, SKU, category, supplier"
              className="h-10 border-[#DCCFC2] bg-white pl-9 text-xs"
            />
          </label>
          <select
            value={categoryId}
            onChange={event => setCategoryId(event.target.value)}
            aria-label="Filter by category"
            className="h-10 rounded-md border border-[#DCCFC2] bg-white px-3 text-xs"
          >
            {" "}
            <option value="">All categories</option>
            {categories.data?.map(category => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <select
            value={supplierId}
            onChange={event => setSupplierId(event.target.value)}
            aria-label="Filter by supplier"
            className="h-10 rounded-md border border-[#DCCFC2] bg-white px-3 text-xs"
          >
            <option value="">All suppliers</option>
            {suppliers.data?.map(supplier => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={event => setStatus(event.target.value)}
            aria-label="Filter by stock status"
            className="h-10 rounded-md border border-[#DCCFC2] bg-white px-3 text-xs"
          >
            <option value="">All statuses</option>
            <option value="in_stock">Healthy</option>
            <option value="low_stock">Low Stock</option>
            <option value="out_of_stock">Out of Stock</option>
            <option value="expiring_soon">Expiring Soon</option>
            <option value="expired">Expired</option>
          </select>
          <Button
            onClick={reset}
            variant="outline"
            className="border-[#D8CDC0] bg-white text-xs"
          >
            Reset
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-[#75695E]">
            {items.data?.total ?? 0} matching material
            {(items.data?.total ?? 0) === 1 ? "" : "s"}
          </p>
          <div className="flex gap-2">
            <Button
              onClick={exportCsv}
              variant="outline"
              className="h-8 border-[#D8CDC0] bg-white px-3 text-xs"
            >
              <Download className="mr-1 h-4 w-4" />
              Export
            </Button>
            <select
              value={`${sortBy}-${direction}`}
              onChange={e => {
                const [s, d] = e.target.value.split("-");
                setSortBy(s as any);
                setDirection(d as any);
              }}
              className="h-8 rounded-md border border-[#DCCFC2] bg-white px-2 text-xs"
            >
              <option value="name-asc">Name A→Z</option>
              <option value="quantity-desc">Stock high→low</option>
              <option value="inventoryValue-desc">Value high→low</option>
              <option value="updatedAt-desc">Recently updated</option>
            </select>
          </div>
        </div>
      </section>
      {items.isLoading ? (
        <div className="mt-5">
          <LoadingPanel />
        </div>
      ) : items.isError ? (
        <div className="mt-5">
          <ErrorPanel error={items.error} retry={() => items.refetch()} />
        </div>
      ) : !items.data?.items.length ? (
        <div className="mt-5 grid min-h-[280px] place-items-center rounded-[14px] border border-dashed border-[#D5C8BA] bg-[#FCFAF6] p-6 text-center">
          <div>
            <PackageSearch className="mx-auto h-8 w-8 text-[#A39486]" />
            <h3 className="mt-4 text-sm font-extrabold">
              {search || categoryId || supplierId || status
                ? "No materials match these filters"
                : "No materials yet."}
            </h3>
            <p className="mt-2 max-w-sm text-xs leading-5 text-[#827568]">
              {search || categoryId || supplierId || status
                ? "Try clearing the filters or searching with a shorter phrase."
                : "Add your first material to start tracking inventory. Materials are what the café purchases and stores."}
            </p>
            <div className="mt-4 flex justify-center gap-2">
              {search || categoryId || supplierId || status ? (
                <Button onClick={reset} variant="outline" className="text-xs">
                  Clear filters
                </Button>
              ) : canManage ? (
                <Button
                  onClick={() => setAddOpen(true)}
                  className="bg-[#E2533C] text-xs text-white"
                >
                  Add material
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <section className="mt-5 overflow-hidden rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] shadow-[0_8px_20px_rgba(55,38,25,0.04)]">
          <div className="overflow-x-auto">
            <table className="min-w-[1100px] w-full text-left">
              <thead className="border-b border-[#E8DED3] bg-[#F7F2EB]">
                <tr>
                  {[
                    "",
                    "Material",
                    "Category",
                    "SKU",
                    "Current Stock",
                    "Minimum",
                    "Status",
                    "Cost",
                    "Outlet",
                    "Updated",
                    "",
                  ].map(label => (
                    <th
                      key={label}
                      className="px-3 py-3 font-mono text-[9px] uppercase tracking-[0.11em] text-[#87796C]"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EDE4DA]">
                {items.data.items.map((item: any) => (
                  <tr key={item.id} className="hover:bg-[#FFFDF9]">
                    <td className="px-3 py-3">
                      <input
                        aria-label={`Select ${item.name}`}
                        type="checkbox"
                        checked={selected.includes(item.id)}
                        onChange={e =>
                          setSelected(prev =>
                            e.target.checked
                              ? [...prev, item.id]
                              : prev.filter(id => id !== item.id)
                          )
                        }
                      />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#EEE9E1] text-[#8E8174]">
                          <Leaf className="h-4 w-4" />
                        </span>
                        <div>
                          <p className="text-xs font-extrabold">{item.name}</p>
                          <p className="text-[11px] text-[#8B7E71]">
                            {item.sku}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {item.categoryName ?? "—"}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">{item.sku}</td>
                    <td className="px-3 py-3 text-xs font-bold">
                      {item.quantity} {item.unit}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {item.reorderLevel} {item.unit}
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge status={item.status} />
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {inr(item.unitCost)}/{item.unit}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {item.outletName ??
                        (item.outletId ? `Outlet #${item.outletId}` : "Global")}
                    </td>
                    <td className="px-3 py-3 text-xs text-[#6F6257]">
                      {dateText(item.updatedAt)}
                    </td>
                    <td className="px-3 py-3">
                      <Button
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() =>
                          setLocation(`/inventory/materials/${item.id}`)
                        }
                      >
                        View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <BulkItemActions
        ids={selected}
        enabled={canManage}
        onComplete={() => {
          setSelected([]);
          void utils.inventory.list.invalidate();
        }}
      />
      <ItemDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onSaved={() => {
          setAddOpen(false);
          void utils.inventory.list.invalidate();
        }}
      />{" "}
      <CategoryDialog
        open={categoryOpen}
        onOpenChange={setCategoryOpen}
        onSaved={() => {
          void utils.inventory.categories.invalidate();
          void utils.inventory.list.invalidate();
        }}
      />
    </>
  );
}

function BulkItemActions({
  ids,
  enabled,
  onComplete,
}: {
  ids: number[];
  enabled: boolean;
  onComplete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const mutation = trpc.inventory.items.setActiveMany.useMutation({
    onSuccess: result => {
      toast.success(
        `${result.count} material${result.count === 1 ? "" : "s"} deactivated.`
      );
      setOpen(false);
      onComplete();
    },
    onError: error => toast.error(errorText(error)),
  });
  if (!enabled || !ids.length) return null;
  return (
    <div className="mt-3 flex items-center justify-between rounded-xl border border-[#EDD5CB] bg-[#FFF7F3] px-4 py-3">
      <p className="text-xs font-semibold text-[#7E4538]">
        {ids.length} selected material{ids.length === 1 ? "" : "s"}
      </p>
      <Button
        onClick={() => setOpen(true)}
        variant="outline"
        className="h-8 border-[#E7B7AB] bg-white text-[11px] text-[#A83825]"
      >
        <Trash2 className="mr-1 h-3.5 w-3.5" />
        Deactivate selected
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Deactivate ${ids.length} material${ids.length === 1 ? "" : "s"}?`}
        description="These materials will be hidden from active stock. History and movements are retained."
        confirmLabel="Deactivate"
        destructive
        pending={mutation.isPending}
        onConfirm={() => mutation.mutate({ ids, active: false })}
      />
    </div>
  );
}

function ItemDialog({
  open,
  onOpenChange,
  current,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current?: any;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormItem>(blankItem);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const categories = trpc.inventory.categories.list.useQuery();
  const suppliers = trpc.inventory.suppliers.list.useQuery();
  const outletId = useOutlet().selectedId;
  const create = trpc.inventory.items.create.useMutation({
    onSuccess: () => {
      toast.success("Material saved.");
      onSaved();
    },
    onError: error => toast.error(errorText(error)),
  });
  const update = trpc.inventory.items.update.useMutation({
    onSuccess: () => {
      toast.success("Material updated.");
      onSaved();
    },
    onError: error => toast.error(errorText(error)),
  });
  const reset = () =>
    setForm(
      current
        ? {
            name: current.name,
            sku: current.sku,
            categoryId: current.categoryId ? String(current.categoryId) : "",
            supplierId: current.supplierId ? String(current.supplierId) : "",
            description: current.description || "",
            quantity: String(current.quantity),
            unit: current.unit,
            reorderLevel: String(current.reorderLevel),
            maxStockLevel:
              current.maxStockLevel == null
                ? ""
                : String(current.maxStockLevel),
            unitCost: String(current.unitCost),
            storageLocation: current.storageLocation || "",
            expiryDate: dateInput(
              current.defaultExpiryDate || current.expiryDate
            ),
            lotNumber: current.defaultLotNumber || "",
            notes: current.notes || "",
            active: current.active,
          }
        : blankItem()
    );
  /** Everything past validation: write the record. */
  const persist = () => {
    if (current)
      update.mutate({
        ...payloadFor(),
        id: current.id,
        active: form.active,
      } as any);
    else create.mutate(payloadFor() as any);
  };

  const payloadFor = () => {
    const payload = {
      name: form.name.trim(),
      sku: form.sku.trim(),
      categoryId: form.categoryId ? Number(form.categoryId) : null,
      supplierId: form.supplierId ? Number(form.supplierId) : null,
      description: form.description.trim() || null,
      quantity: Number(form.quantity),
      unit: form.unit,
      reorderLevel: Number(form.reorderLevel),
      maxStockLevel: form.maxStockLevel ? Number(form.maxStockLevel) : null,
      unitCost: Number(form.unitCost),
      storageLocation: form.storageLocation.trim() || null,
      expiryDate: form.expiryDate || null,
      lotNumber: form.lotNumber.trim() || null,
      notes: form.notes.trim() || null,
      outletId: outletId ?? null,
    } as any;
    return payload;
  };

  /*
   * Deactivating an in-use material used to call `window.confirm` from inside
   * this modal: a native browser dialog stacked on a Radix one, which blocks the
   * main thread, ignores the app's focus trap and cannot be styled. It is now a
   * proper confirmation prompt, and the payload is rebuilt on confirm so the two
   * steps cannot disagree about what is being saved.
   */
  const submit = () => {
    if (!form.name.trim() || !form.sku.trim())
      return toast.error("Material name and SKU are required.");
    const payload = payloadFor();
    if (
      [
        payload.quantity,
        payload.reorderLevel,
        payload.unitCost,
        payload.maxStockLevel ?? 0,
      ].some(value => !Number.isFinite(value) || value < 0)
    )
      return toast.error(
        "Quantities, reorder level, maximum stock, and unit cost must be valid non-negative values."
      );
    if (current && current.active && !form.active) {
      setConfirmDeactivate(true);
      return;
    }
    persist();
  };
  return (
    <>
      <FormDialog
        open={open}
        onOpenChange={value => {
          if (value) reset();
          onOpenChange(value);
        }}
        size="2xl"
        title={current ? "Edit material" : "Add material"}
        description="Materials are outlet-scoped. Stock movements are recorded through adjustment or receiving flow."
        onSubmit={event => {
          event.preventDefault();
          submit();
        }}
        submitLabel="Save"
        submitPending={create.isPending || update.isPending}
        formClassName="grid gap-3 sm:grid-cols-2"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Material name"
            value={form.name}
            onChange={value => setForm({ ...form, name: value })}
            required
          />
          <Field
            label="SKU"
            value={form.sku}
            onChange={value => setForm({ ...form, sku: value })}
            required
          />
          <SelectField
            label="Category"
            value={form.categoryId}
            onChange={value => setForm({ ...form, categoryId: value })}
            options={
              categories.data?.map(item => [String(item.id), item.name]) ?? []
            }
          />
          <SelectField
            label="Supplier"
            value={form.supplierId}
            onChange={value => setForm({ ...form, supplierId: value })}
            options={
              suppliers.data?.map(item => [String(item.id), item.name]) ?? []
            }
          />
          <Field
            label="Current quantity"
            value={form.quantity}
            type="number"
            onChange={value => setForm({ ...form, quantity: value })}
          />
          <SelectField
            label="Unit"
            value={form.unit}
            onChange={value =>
              setForm({ ...form, unit: value as FormItem["unit"] })
            }
            options={units.map(unit => [unit, unit])}
            empty={false}
          />
          <Field
            label="Minimum stock"
            value={form.reorderLevel}
            type="number"
            onChange={value => setForm({ ...form, reorderLevel: value })}
          />
          <Field
            label="Maximum stock"
            value={form.maxStockLevel}
            type="number"
            onChange={value => setForm({ ...form, maxStockLevel: value })}
          />
          <Field
            label="Unit cost (₹)"
            value={form.unitCost}
            type="number"
            onChange={value => setForm({ ...form, unitCost: value })}
          />
          <Field
            label="Storage location"
            value={form.storageLocation}
            onChange={value => setForm({ ...form, storageLocation: value })}
          />
          <Field
            label="Expiry date"
            value={form.expiryDate}
            type="date"
            onChange={value => setForm({ ...form, expiryDate: value })}
          />
          <Field
            label="Lot number"
            value={form.lotNumber}
            onChange={value => setForm({ ...form, lotNumber: value })}
          />
        </div>
      </FormDialog>

      <ConfirmDialog
        open={confirmDeactivate}
        onOpenChange={setConfirmDeactivate}
        title={`Deactivate ${current?.name}?`}
        description="It will be hidden from the active catalogue, but its stock and audit history will remain."
        confirmLabel="Deactivate"
        cancelLabel="Keep active"
        destructive
        size="md"
        pending={update.isPending}
        onConfirm={() => {
          setConfirmDeactivate(false);
          persist();
        }}
      />
    </>
  );
}
function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label>
      <span className="mb-1 block text-[11px] font-bold text-[#66594F]">
        {label}
        {required ? " *" : ""}
      </span>
      <Input
        type={type}
        min={type === "number" ? "0" : undefined}
        value={value}
        onChange={event => onChange(event.target.value)}
        className="border-[#DCCFC2] bg-white text-xs"
      />
    </label>
  );
}
function SelectField({
  label,
  value,
  onChange,
  options,
  empty = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly (readonly [string, string])[];
  empty?: boolean;
}) {
  return (
    <label>
      <span className="mb-1 block text-[11px] font-bold text-[#66594F]">
        {label}
      </span>
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-[#DCCFC2] bg-white px-3 text-xs"
      >
        {empty && <option value="">None selected</option>}
        {options.map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

function ItemDetail({
  itemId,
  canManage,
  onBack,
}: {
  itemId: number;
  canManage: boolean;
  onBack: () => void;
}) {
  const utils = trpc.useUtils();
  const detail = trpc.inventory.byId.useQuery({ id: itemId });
  const outletStock = trpc.inventory.outletStock.useQuery({
    materialId: itemId,
  });
  const [editOpen, setEditOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [tab, setTab] = useState<
    "overview" | "stock" | "movements" | "purchases" | "wastage" | "usage"
  >("overview");
  if (detail.isLoading) return <LoadingPanel />;
  if (detail.isError || !detail.data)
    return (
      <>
        <Button onClick={onBack} variant="outline" className="mb-5">
          <ChevronLeft className="mr-1 h-4 w-4" />
          Materials
        </Button>
        <ErrorPanel error={detail.error} retry={() => detail.refetch()} />
      </>
    );
  const item = detail.data;
  return (
    <>
      <Button
        onClick={onBack}
        variant="ghost"
        className="mb-5 px-0 text-xs text-[#786B5F]"
      >
        <ChevronLeft className="mr-1 h-4 w-4" />
        Materials
      </Button>
      <InventoryHeading
        kicker="Material"
        title={`${item.name}`}
        detail={`${item.sku} • ${item.categoryName || "Uncategorised"} • ${item.storageLocation || "No storage location"}`}
        action={
          <div className="flex gap-2">
            <StatusBadge status={item.status} />
            {canManage && (
              <>
                <Button
                  onClick={() => setEditOpen(true)}
                  variant="outline"
                  className="border-[#D8CDC0] bg-[#FCFAF6] text-xs"
                >
                  <Pencil className="mr-1 h-4 w-4" />
                  Edit
                </Button>
                <Button
                  onClick={() => setAdjustOpen(true)}
                  className="bg-[#E2533C] text-xs text-white hover:bg-[#C94734]"
                >
                  <RefreshCw className="mr-1 h-4 w-4" />
                  Adjust stock
                </Button>
              </>
            )}
          </div>
        }
      />
      <div className="grid gap-4 sm:grid-cols-4">
        <Metric
          label="Current Stock"
          value={`${item.quantity} ${item.unit}`}
          detail={`Min ${item.reorderLevel} ${item.unit}`}
        />
        <Metric
          label="Stock Value"
          value={inr(item.inventoryValue)}
          detail={`${inr(item.unitCost)}/${item.unit}`}
          tone="green"
        />
        <Metric
          label="Reorder Level"
          value={`${item.reorderLevel} ${item.unit}`}
          detail={item.maxStockLevel ? `Max ${item.maxStockLevel}` : "No max"}
        />
        <Metric
          label="Expiry"
          value={dateText(item.expiryDate)}
          detail={
            item.defaultLotNumber ? `Lot ${item.defaultLotNumber}` : "No batch"
          }
          tone={
            item.status === "expired"
              ? "red"
              : item.status === "expiring_soon"
                ? "amber"
                : "ink"
          }
        />
      </div>
      <div className="mt-4 flex flex-wrap gap-1 rounded-xl border border-[#E4DCD1] bg-[#EEE9E1] p-1">
        {(
          [
            "overview",
            "stock",
            "movements",
            "purchases",
            "wastage",
            "usage",
          ] as const
        ).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold capitalize ${tab === t ? "bg-[#211B18] text-white" : "text-[#6C6055]"}`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="mt-5">
        {tab === "overview" && (
          <div className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5">
            <dl className="grid gap-x-6 gap-y-4 text-xs sm:grid-cols-2">
              {[
                ["Supplier", item.supplierName || "Not assigned"],
                [
                  "Outlet",
                  item.outletName ||
                    (item.outletId ? `Outlet #${item.outletId}` : "Global"),
                ],
                [
                  "Maximum level",
                  item.maxStockLevel == null
                    ? "Not set"
                    : `${item.maxStockLevel} ${item.unit}`,
                ],
                ["Last received", dateText(item.lastReceivedAt)],
                ["Last adjusted", dateText(item.lastAdjustedAt)],
                ["Description", item.description || "—"],
                ["Notes", item.notes || "—"],
              ].map(([term, value]) => (
                <div key={term}>
                  <dt className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#8B7E71]">
                    {term}
                  </dt>
                  <dd className="mt-1 font-semibold text-[#211B18]">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        {tab === "stock" && (
          <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5">
            <h3 className="text-sm font-extrabold">Outlet Stock</h3>
            <p className="mt-1 text-xs text-[#776A5E]">
              Same material, independent balances per outlet.
            </p>
            {outletStock.isLoading ? (
              <LoadingPanel />
            ) : !outletStock.data?.length ? (
              <p className="mt-4 text-center text-xs text-[#827568]">
                No outlet stock found.
              </p>
            ) : (
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {outletStock.data.map((s: any) => (
                  <div
                    key={s.outletId ?? "global"}
                    className="rounded-xl border bg-white p-4"
                  >
                    <p className="text-xs font-bold">{s.outletName}</p>
                    <p className="mt-1 text-lg font-extrabold">
                      {s.quantity} {s.unit}
                    </p>
                    <StatusBadge status={s.status} />
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
        {tab === "movements" && <MaterialMovements materialId={itemId} />}
        {tab === "purchases" && <MaterialPurchases materialId={itemId} />}
        {tab === "wastage" && <MaterialWastage materialId={itemId} />}
        {tab === "usage" && (
          <div className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5">
            <h3 className="text-sm font-extrabold">Usage</h3>
            <p className="mt-2 text-xs text-[#776A5E]">
              Recipes that consume this material. Link menu products via Recipes
              to see theoretical sellable quantity.
            </p>
            <TheoreticalQuantity materialId={itemId} />
          </div>
        )}
      </div>
      <ItemDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        current={item}
        onSaved={() => {
          setEditOpen(false);
          void utils.inventory.byId.invalidate();
          void utils.inventory.list.invalidate();
        }}
      />
      <AdjustmentDialog
        open={adjustOpen}
        onOpenChange={setAdjustOpen}
        item={item}
        onSaved={() => {
          setAdjustOpen(false);
          void detail.refetch();
          void utils.inventory.list.invalidate();
        }}
      />
    </>
  );
}

function MaterialMovements({ materialId }: { materialId: number }) {
  const q = trpc.inventory.transactions.useQuery({
    itemId: materialId,
    limit: 50,
  });
  if (q.isLoading) return <LoadingPanel />;
  if (q.isError)
    return <ErrorPanel error={q.error} retry={() => q.refetch()} />;
  if (!q.data?.length)
    return (
      <div className="rounded-[14px] border border-dashed border-[#D5C8BA] bg-[#FCFAF6] p-8 text-center text-xs text-[#827568]">
        No movements yet. Every stock change creates an immutable ledger entry.
      </div>
    );
  return (
    <section className="overflow-hidden rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6]">
      <div className="overflow-x-auto">
        <table className="min-w-[700px] w-full text-left">
          <thead className="border-b bg-[#F7F2EB]">
            <tr>
              {[
                "Date",
                "Movement",
                "Qty",
                "Before",
                "After",
                "Reference",
                "By",
              ].map(h => (
                <th
                  key={h}
                  className="px-3 py-2 font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {q.data.map((r: any) => (
              <tr key={r.id} className="text-xs">
                <td className="px-3 py-2 text-[#6F6257]">
                  {dateText(r.createdAt)}
                </td>
                <td className="px-3 py-2">
                  <Badge className="text-[10px]">{r.type}</Badge>
                </td>
                <td
                  className={`px-3 py-2 font-bold ${r.quantityChange < 0 ? "text-[#A83825]" : "text-[#2F6947]"}`}
                >
                  {r.quantityChange > 0 ? "+" : ""}
                  {r.quantityChange} {r.unit}
                </td>
                <td className="px-3 py-2">{r.previousQuantity}</td>
                <td className="px-3 py-2">{r.newQuantity}</td>
                <td className="px-3 py-2">{r.referenceType ?? "—"}</td>
                <td className="px-3 py-2">{r.createdBy ?? "System"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function MaterialPurchases({ materialId }: { materialId: number }) {
  const q = trpc.inventory.purchaseOrders.list.useQuery();
  const filtered = (q.data ?? []).filter(
    (po: any) =>
      po.lines?.some((l: any) => l.inventoryItemId === materialId) ?? false
  );
  // Fallback: if list doesn't include lines, just show recent POs
  if (q.isLoading) return <LoadingPanel />;
  if (!filtered.length)
    return (
      <div className="rounded-[14px] border border-dashed border-[#D5C8BA] bg-[#FCFAF6] p-6 text-center text-xs text-[#827568]">
        No purchases for this material. Create a purchase order from the
        Purchases tab.
      </div>
    );
  return (
    <div className="space-y-2">
      {filtered.slice(0, 5).map((po: any) => (
        <div
          key={po.id}
          className="flex items-center justify-between rounded-xl border bg-white p-3"
        >
          <span className="text-xs font-bold">{po.poNumber}</span>
          <Badge className="text-[10px]">{po.status}</Badge>
        </div>
      ))}
    </div>
  );
}
function MaterialWastage({ materialId }: { materialId: number }) {
  const q = trpc.inventory.wastage.list.useQuery({ limit: 20 } as any);
  const rows = (q.data ?? []).filter(
    (w: any) => w.inventoryItemId === materialId
  );
  if (q.isLoading) return <LoadingPanel />;
  if (!rows.length)
    return (
      <div className="rounded-[14px] border border-dashed border-[#D5C8BA] bg-[#FCFAF6] p-6 text-center text-xs text-[#827568]">
        No wastage recorded for this material.
      </div>
    );
  return (
    <div className="space-y-2">
      {rows.map((w: any) => (
        <div
          key={w.id}
          className="flex justify-between rounded-xl border bg-white p-3"
        >
          <span className="text-xs font-bold">
            {w.quantity} {w.unit} • {w.reason}
          </span>
          <span className="text-xs font-mono">{inr(w.estimatedCost)}</span>
        </div>
      ))}
    </div>
  );
}
function TheoreticalQuantity({ materialId }: { materialId: number }) {
  const [recipeId, setRecipeId] = useState("");
  const recipes = trpc.inventory.recipes.list.useQuery();
  const items = trpc.inventory.list.useQuery({ limit: 200 } as any);
  const recipe =
    recipes.data?.find((r: any) => String(r.id) === recipeId) ?? null;
  const recipeDetail = trpc.inventory.recipes.byId.useQuery(
    { id: Number(recipeId) },
    { enabled: !!recipeId }
  );
  const material = items.data?.items.find((m: any) => m.id === materialId);
  // Theoretical sellable = floor(material stock / qtyPerSale of this material
  // in the selected recipe). Limiting-ingredient logic across the whole recipe
  // would need every component's live stock; this answers the material tab.
  let theoretical: number | null = null;
  if (recipe && material && recipeDetail.data) {
    const comp = (recipeDetail.data.components ?? []).find(
      (c: any) =>
        c.componentType === "material" &&
        Number(c.componentId) === Number(materialId)
    );
    const per = comp ? Number(comp.quantity) : 0;
    theoretical = per > 0 ? Math.floor(Number(material.quantity) / per) : null;
  }
  return (
    <div className="mt-4 rounded-xl border bg-white p-4">
      <select
        value={recipeId}
        onChange={e => setRecipeId(e.target.value)}
        className="h-9 w-full rounded-md border bg-white px-2 text-xs"
      >
        <option value="">Select recipe to calculate</option>
        {recipes.data?.map((r: any) => (
          <option key={r.id} value={String(r.id)}>
            {r.name} ({r.menuItemName ?? "—"})
          </option>
        ))}
      </select>
      {recipeDetail.isLoading ? (
        <p className="mt-3 text-xs text-[#827568]">Loading recipe…</p>
      ) : theoretical !== null ? (
        <p className="mt-3 text-sm font-bold">
          Theoretical sellable: {theoretical} servings (limiting:{" "}
          {material?.name})
        </p>
      ) : recipeId ? (
        <p className="mt-3 text-xs text-[#827568]">
          This recipe does not consume {material?.name ?? "this material"}.
        </p>
      ) : null}
      <p className="mt-2 text-xs text-[#827568]">
        Calculated from current stock ÷ recipe quantity per sale. Not a
        reservation — use for availability guidance.
      </p>
    </div>
  );
}

function AdjustmentDialog({
  open,
  onOpenChange,
  item,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: any;
  onSaved: () => void;
}) {
  const [type, setType] = useState<
    | "adjustment"
    | "waste"
    | "correction"
    | "consumption"
    | "transfer"
    | "return"
  >("adjustment");
  const [direction, setDirection] = useState<"increase" | "decrease">(
    "increase"
  );
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [batchId, setBatchId] = useState("");
  const adjust = trpc.inventory.adjust.useMutation({
    onSuccess: () => {
      toast.success("Stock adjustment recorded in the item history.");
      setQuantity("");
      setReason("");
      setNotes("");
      onSaved();
    },
    onError: error => toast.error(errorText(error)),
  });
  const submit = () => {
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0 || !reason.trim())
      return toast.error("Enter a positive quantity and a reason.");
    adjust.mutate({
      itemId: item.id,
      type,
      direction:
        type === "adjustment" || type === "correction" || type === "return"
          ? direction
          : "decrease",
      quantity: qty,
      reason: reason.trim(),
      notes: notes.trim() || null,
      batchId: batchId ? Number(batchId) : null,
    });
  };
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={`Adjust ${item.name}`}
      description="This saves a permanent stock transaction; it does not merely alter a displayed quantity."
      onSubmit={event => {
        event.preventDefault();
        submit();
      }}
      submitLabel={
        adjust.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          "Record adjustment"
        )
      }
      submitPending={adjust.isPending}
      formClassName="space-y-3"
    >
      <SelectField
        label="Adjustment type"
        value={type}
        onChange={value => setType(value as typeof type)}
        options={[
          ["adjustment", "Manual adjustment"],
          ["waste", "Waste"],
          ["correction", "Stock count correction"],
          ["consumption", "Consumption"],
          ["transfer", "Transfer"],
          ["return", "Return"],
        ]}
        empty={false}
      />
      {["adjustment", "correction", "return"].includes(type) && (
        <SelectField
          label="Direction"
          value={direction}
          onChange={val => setDirection(val as any)}
          options={[
            ["increase", "Increase"],
            ["decrease", "Decrease"],
          ]}
          empty={false}
        />
      )}
      <Field
        label="Quantity"
        value={quantity}
        type="number"
        onChange={setQuantity}
      />
      <Field label="Reason" value={reason} onChange={setReason} />
      <Field label="Notes" value={notes} onChange={setNotes} />
      <SelectField
        label="Batch (optional)"
        value={batchId}
        onChange={setBatchId}
        options={
          item.batches?.map((b: any) => [
            String(b.id),
            `${b.lotNumber ?? `#${b.id}`} — ${b.quantity} ${item.unit}`,
          ]) ?? []
        }
      />
    </FormDialog>
  );
}

function CategoryDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const categories = trpc.inventory.categories.list.useQuery();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [remove, setRemove] = useState<any>(null);
  const create = trpc.inventory.categories.create.useMutation({
    onSuccess: () => {
      toast.success("Category saved.");
      setName("");
      setDescription("");
      void categories.refetch();
      onSaved();
    },
    onError: error => toast.error(errorText(error)),
  });
  const deleteMutation = trpc.inventory.categories.remove.useMutation({
    onSuccess: () => {
      toast.success("Category deleted.");
      setRemove(null);
      void categories.refetch();
      onSaved();
    },
    onError: error => toast.error(errorText(error)),
  });
  return (
    <>
      {/*
        A form dialog with the existing catalogue listed underneath. "Add
        category" is the footer action like every other form dialog, and the list
        keeps its own bounded scroll so a long catalogue cannot push the header
        or footer out of the dialog.
      */}
      <FormDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Inventory categories"
        description="Categories organize stock and cannot be deleted while an active item still uses them."
        onSubmit={event => {
          event.preventDefault();
          if (!name.trim()) return toast.error("Enter a category name.");
          create.mutate({
            name: name.trim(),
            description: description.trim() || null,
          });
        }}
        submitLabel="Add category"
        submitPending={create.isPending}
        submitDisabled={!name.trim()}
        isDirty={name.trim() !== "" || description.trim() !== ""}
        formClassName="gap-3"
      >
        <Field label="New category" value={name} onChange={setName} />
        <label>
          <span className="mb-1 block text-[11px] font-bold text-[#66594F]">
            Description (for new category)
          </span>
          <Input
            value={description}
            onChange={event => setDescription(event.target.value)}
            className="border-[#DCCFC2] bg-white text-xs"
          />
        </label>
        <div className="scrollbar-none max-h-64 divide-y divide-[#E7DED4] overflow-y-auto rounded-xl border border-[#E7DED4]">
          {categories.isLoading ? (
            <LoadingPanel />
          ) : categories.data?.length ? (
            categories.data.map(category => (
              <div
                key={category.id}
                className="flex items-center justify-between p-3"
              >
                <div>
                  <p className="text-xs font-bold">{category.name}</p>
                  <p className="text-[11px] text-[#8B7E71]">
                    {category.description ?? "—"}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setRemove(category)}
                  className="h-7 w-7 text-[#B83D29]"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          ) : (
            <p className="p-4 text-center text-xs text-[#827568]">
              No categories yet.
            </p>
          )}
        </div>
      </FormDialog>
      <ConfirmDialog
        open={Boolean(remove)}
        onOpenChange={o => !o && setRemove(null)}
        title={`Delete ${remove?.name}?`}
        description="This will permanently delete the category if no active material uses it."
        confirmLabel="Delete"
        destructive
        pending={deleteMutation.isPending}
        onConfirm={() => {
          if (remove) deleteMutation.mutate({ id: remove.id });
        }}
      />
    </>
  );
}

function PreparedItemsView({
  outletId,
  canManage,
}: {
  outletId: number | null;
  canManage: boolean;
}) {
  const list = trpc.inventory.preparedItems.list.useQuery(
    outletId ? { outletId } : undefined
  );
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    sku: "",
    unit: "units" as any,
    quantity: "0",
    minQuantity: "0",
    shelfLifeHours: "24",
  });
  const create = trpc.inventory.preparedItems.create.useMutation({
    onSuccess: () => {
      toast.success("Prepared item created");
      setOpen(false);
      void list.refetch();
    },
    onError: e => toast.error(errorText(e)),
  });
  return (
    <>
      <InventoryHeading
        kicker="Prepared items"
        title="Prepared in batch, consumed by recipes."
        detail="Pizza dough, sauces, patties — tracked with batch number, produced time, expiry and remaining quantity per outlet."
        action={
          canManage ? (
            <Button
              onClick={() => setOpen(true)}
              className="bg-[#E2533C] text-xs text-white"
            >
              <Plus className="mr-1 h-4 w-4" />
              Add prepared item
            </Button>
          ) : undefined
        }
      />
      {list.isLoading ? (
        <LoadingPanel />
      ) : list.isError ? (
        <ErrorPanel error={list.error} retry={() => list.refetch()} />
      ) : !list.data?.length ? (
        <div className="grid min-h-[280px] place-items-center rounded-[14px] border border-dashed border-[#D5C8BA] bg-[#FCFAF6] p-6 text-center">
          <Factory className="mx-auto h-8 w-8 text-[#A39486]" />
          <h3 className="mt-3 text-sm font-extrabold">
            No prepared items yet.
          </h3>
          <p className="mt-2 max-w-sm text-xs leading-5 text-[#827568]">
            Create items prepared inside the café in batches (e.g., Pizza Dough,
            Tomato Sauce). They are consumed by menu recipes.
          </p>
          {canManage && (
            <Button
              onClick={() => setOpen(true)}
              className="mt-4 bg-[#211B18] text-xs text-white"
            >
              Add prepared item
            </Button>
          )}
        </div>
      ) : (
        <section className="overflow-hidden rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6]">
          <div className="overflow-x-auto">
            <table className="min-w-[900px] w-full text-left">
              <thead className="border-b bg-[#F7F2EB]">
                <tr>
                  {[
                    "Prepared Item",
                    "SKU",
                    "Quantity",
                    "Unit",
                    "Min",
                    "Outlet",
                    "Status",
                    "Last Prepared",
                    "Expiry",
                  ].map(h => (
                    <th
                      key={h}
                      className="px-3 py-3 font-mono text-[9px] uppercase tracking-[0.11em] text-[#87796C]"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {list.data.map((it: any) => (
                  <tr key={it.id}>
                    <td className="px-3 py-3 text-xs font-bold flex items-center gap-2">
                      <FlaskConical className="h-4 w-4 text-[#8E8174]" />
                      {it.name}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">{it.sku}</td>
                    <td className="px-3 py-3 text-xs font-bold">
                      {it.quantity} {it.unit}
                    </td>
                    <td className="px-3 py-3 text-xs">{it.unit}</td>
                    <td className="px-3 py-3 text-xs">
                      {it.minQuantity} {it.unit}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {it.outletName ??
                        (it.outletId ? `Outlet #${it.outletId}` : "Global")}
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge status={it.status} />
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {dateText(it.lastPreparedAt)}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {it.shelfLifeHours ? `${it.shelfLifeHours}h` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Add prepared item"
        description="Batch-tracked component for recipes."
        onSubmit={event => {
          event.preventDefault();
          if (!form.name.trim() || !form.sku.trim())
            return toast.error("Name & SKU required");
          create.mutate({
            outletId,
            categoryId: null,
            name: form.name.trim(),
            sku: form.sku.trim(),
            description: null,
            quantity: Number(form.quantity),
            unit: form.unit,
            minQuantity: Number(form.minQuantity),
            maxStockLevel: null,
            shelfLifeHours: form.shelfLifeHours
              ? Number(form.shelfLifeHours)
              : null,
            unitCost: 0,
          });
        }}
        submitLabel="Create"
        submitPending={create.isPending}
        formClassName="grid gap-3"
      >
        <Field
          label="Name"
          value={form.name}
          onChange={v => setForm({ ...form, name: v })}
          required
        />
        <Field
          label="SKU"
          value={form.sku}
          onChange={v => setForm({ ...form, sku: v })}
          required
        />
        <SelectField
          label="Unit"
          value={form.unit}
          onChange={v => setForm({ ...form, unit: v as any })}
          options={units.map(u => [u, u])}
          empty={false}
        />
        <Field
          label="Quantity"
          value={form.quantity}
          onChange={v => setForm({ ...form, quantity: v })}
          type="number"
        />
        <Field
          label="Min quantity"
          value={form.minQuantity}
          onChange={v => setForm({ ...form, minQuantity: v })}
          type="number"
        />
        <Field
          label="Shelf life (hours)"
          value={form.shelfLifeHours}
          onChange={v => setForm({ ...form, shelfLifeHours: v })}
          type="number"
        />
      </FormDialog>
    </>
  );
}

function RecipesView({
  outletId,
  canManage,
}: {
  outletId: number | null;
  canManage: boolean;
}) {
  const list = trpc.inventory.recipes.list.useQuery(
    outletId ? { outletId } : undefined
  );
  const menu = trpc.admin.menu.list.useQuery({ limit: 100 } as any);
  const materials = trpc.inventory.list.useQuery({ limit: 200 } as any);
  const prepared = trpc.inventory.preparedItems.list.useQuery(
    outletId ? { outletId } : undefined
  );
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [form, setForm] = useState({
    name: "",
    menuItemId: "",
    yieldQuantity: "1",
    yieldUnit: "unit",
    components: [] as Array<{
      componentType: "material" | "prepared_item";
      componentId: string;
      quantity: string;
      unit: string;
    }>,
  });
  const create = trpc.inventory.recipes.create.useMutation({
    onSuccess: () => {
      toast.success("Recipe created");
      setOpen(false);
      setForm({
        name: "",
        menuItemId: "",
        yieldQuantity: "1",
        yieldUnit: "unit",
        components: [],
      });
      void list.refetch();
    },
    onError: e => toast.error(errorText(e)),
  });
  const byId = trpc.inventory.recipes.byId.useQuery(
    { id: detail?.id ?? 0 },
    { enabled: Boolean(detail) }
  );
  return (
    <>
      <InventoryHeading
        kicker="Recipes"
        title="Menu → Recipe → Materials / Prepared Items → Inventory"
        detail="Recipes bridge sellable products and consumable stock. Versioned, costed, and nestable without circular dependencies."
        action={
          canManage ? (
            <Button
              onClick={() => setOpen(true)}
              className="bg-[#211B18] text-xs text-white"
            >
              <Plus className="mr-1 h-4 w-4" />
              Create recipe
            </Button>
          ) : undefined
        }
      />
      {list.isLoading ? (
        <LoadingPanel />
      ) : list.isError ? (
        <ErrorPanel error={list.error} retry={() => list.refetch()} />
      ) : !list.data?.length ? (
        <div className="grid min-h-[280px] place-items-center rounded-[14px] border border-dashed border-[#D5C8BA] bg-[#FCFAF6] p-6 text-center">
          <ClipboardList className="mx-auto h-8 w-8 text-[#A39486]" />
          <h3 className="mt-3 text-sm font-extrabold">
            No recipes configured.
          </h3>
          <p className="mt-2 max-w-sm text-xs leading-5 text-[#827568]">
            Link your menu products to materials through recipes to enable
            inventory consumption.
          </p>
          {canManage && (
            <Button
              onClick={() => setOpen(true)}
              className="mt-4 bg-[#211B18] text-xs text-white"
            >
              Create Recipe
            </Button>
          )}
        </div>
      ) : (
        <section className="overflow-hidden rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6]">
          <div className="overflow-x-auto">
            <table className="min-w-[900px] w-full text-left">
              <thead className="border-b bg-[#F7F2EB]">
                <tr>
                  {[
                    "Recipe",
                    "Linked Product",
                    "Ingredients",
                    "Yield",
                    "Cost",
                    "Status",
                    "Updated",
                    "",
                  ].map(h => (
                    <th
                      key={h}
                      className="px-3 py-3 font-mono text-[9px] uppercase tracking-[0.11em] text-[#87796C]"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {list.data.map((r: any) => (
                  <tr key={r.id} className="hover:bg-[#FFFDF9]">
                    <td className="px-3 py-3 text-xs font-bold">{r.name}</td>
                    <td className="px-3 py-3 text-xs">
                      {r.menuItemName ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {r.ingredientsCount} ingredients
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {r.yieldQuantity} {r.yieldUnit}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {inr(r.estimatedCost)}
                    </td>
                    <td className="px-3 py-3">
                      <Badge
                        className={
                          r.status === "active"
                            ? "bg-[#E5F2E9] text-[#2F6947]"
                            : "bg-[#F6F0E8]"
                        }
                      >
                        {r.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-xs text-[#6F6257]">
                      {dateText(r.updatedAt)}
                    </td>
                    <td className="px-3 py-3">
                      <Button
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => setDetail(r)}
                      >
                        View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        size="2xl"
        title="Create recipe"
        description="Yield quantity and unit are required for batch costing."
        onSubmit={event => {
          event.preventDefault();
          if (!form.name.trim() || form.components.length === 0)
            return toast.error("Name and at least one ingredient required");
          const comps = form.components.map(c => ({
            componentType: c.componentType,
            componentId: Number(c.componentId),
            quantity: Number(c.quantity),
            unit: c.unit.trim() || "g",
          }));
          if (
            comps.some(
              c =>
                !c.componentId ||
                !Number.isFinite(c.quantity) ||
                c.quantity <= 0
            )
          )
            return toast.error("Check ingredients");
          create.mutate({
            name: form.name.trim(),
            menuItemId: form.menuItemId ? Number(form.menuItemId) : null,
            outletId,
            yieldQuantity: Number(form.yieldQuantity),
            yieldUnit: form.yieldUnit.trim() || "unit",
            status: "active",
            components: comps,
          });
        }}
        submitLabel="Create"
        submitPending={create.isPending}
        formClassName="gap-4"
      >
        <Field
          label="Recipe name"
          value={form.name}
          onChange={v => setForm({ ...form, name: v })}
          required
        />
        <SelectField
          label="Linked menu product"
          value={form.menuItemId}
          onChange={v => setForm({ ...form, menuItemId: v })}
          options={
            menu.data?.items.map((m: any) => [String(m.id), m.name]) ?? []
          }
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Yield qty"
            value={form.yieldQuantity}
            onChange={v => setForm({ ...form, yieldQuantity: v })}
            type="number"
          />
          <Field
            label="Yield unit"
            value={form.yieldUnit}
            onChange={v => setForm({ ...form, yieldUnit: v })}
          />
        </div>
        <div className="rounded-xl border bg-white p-3">
          <p className="text-xs font-bold">
            Ingredients (material or prepared item)
          </p>
          {form.components.map((c, idx) => (
            <div
              key={idx}
              className="mt-2 grid grid-cols-[110px_1fr_90px_90px_auto] gap-2 items-center"
            >
              <select
                value={c.componentType}
                onChange={e =>
                  setForm({
                    ...form,
                    components: form.components.map((x, i) =>
                      i === idx
                        ? { ...x, componentType: e.target.value as any }
                        : x
                    ),
                  })
                }
                className="h-9 rounded-md border bg-white px-2 text-xs"
              >
                <option value="material">Material</option>
                <option value="prepared_item">Prepared</option>
              </select>
              <select
                value={c.componentId}
                onChange={e =>
                  setForm({
                    ...form,
                    components: form.components.map((x, i) =>
                      i === idx ? { ...x, componentId: e.target.value } : x
                    ),
                  })
                }
                className="h-9 rounded-md border bg-white px-2 text-xs"
              >
                <option value="">Select</option>
                {(c.componentType === "material"
                  ? (materials.data?.items ?? [])
                  : (prepared.data ?? [])
                ).map((m: any) => (
                  <option key={m.id} value={String(m.id)}>
                    {m.name} ({m.sku})
                  </option>
                ))}
              </select>
              <Input
                value={c.quantity}
                onChange={e =>
                  setForm({
                    ...form,
                    components: form.components.map((x, i) =>
                      i === idx ? { ...x, quantity: e.target.value } : x
                    ),
                  })
                }
                placeholder="Qty"
                className="h-9 text-xs"
              />
              <Input
                value={c.unit}
                onChange={e =>
                  setForm({
                    ...form,
                    components: form.components.map((x, i) =>
                      i === idx ? { ...x, unit: e.target.value } : x
                    ),
                  })
                }
                placeholder="unit"
                className="h-9 text-xs"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  setForm({
                    ...form,
                    components: form.components.filter((_, i) => i !== idx),
                  })
                }
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            className="mt-3 h-8 text-xs"
            onClick={() =>
              setForm({
                ...form,
                components: [
                  ...form.components,
                  {
                    componentType: "material",
                    componentId: "",
                    quantity: "",
                    unit: "g",
                  },
                ],
              })
            }
          >
            <Plus className="mr-1 h-4 w-4" />
            Add ingredient
          </Button>
        </div>
      </FormDialog>
      <ViewDialog
        open={Boolean(detail)}
        onOpenChange={o => !o && setDetail(null)}
        size="xl"
        title={detail?.name ?? "Recipe"}
        description={`${
          detail?.menuItemName
            ? `Linked to ${detail.menuItemName}`
            : "Unlinked recipe"
        } • Yield ${detail?.yieldQuantity} ${detail?.yieldUnit} • Cost ${
          detail ? inr(detail.estimatedCost) : "—"
        }`}
        footer={
          <Button variant="outline" onClick={() => setDetail(null)}>
            Close
          </Button>
        }
      >
        {byId.isLoading ? (
          <LoadingPanel />
        ) : !byId.data ? (
          <p className="text-xs text-[#827568]">No detail.</p>
        ) : (
          <div className="space-y-2">
            {byId.data.components.map((c: any) => (
              <div
                key={c.id}
                className="flex justify-between rounded-xl border bg-white p-3"
              >
                <span className="text-xs font-bold">
                  {c.name} • {c.quantity} {c.unit}
                </span>
                <Badge className="text-[10px]">{c.componentType}</Badge>
              </div>
            ))}
            <p className="text-xs font-bold">
              Estimated cost: {inr(byId.data.estimatedCost)} • Selling price:{" "}
              {byId.data.menuItemPrice ? inr(byId.data.menuItemPrice) : "—"} •
              Gross margin:{" "}
              {byId.data.menuItemPrice
                ? inr(byId.data.menuItemPrice - byId.data.estimatedCost)
                : "—"}
            </p>
            <p className="text-[11px] text-[#8B7E71]">
              Version {byId.data.version} • Status {byId.data.status}
            </p>
          </div>
        )}
      </ViewDialog>
    </>
  );
}

function TransactionsView() {
  const [type, setType] = useState("");
  const query = trpc.inventory.transactions.useQuery(
    type ? { type: type as any } : undefined
  );
  return (
    <>
      <InventoryHeading
        kicker="Stock Movements"
        title="Immutable inventory ledger."
        detail="Every stock change has a reason — purchase, consumption, wastage, adjustment, transfer, production. Never modify stock silently."
        action={
          <select
            value={type}
            onChange={event => setType(event.target.value)}
            aria-label="Filter transaction type"
            className="h-10 rounded-md border border-[#DCCFC2] bg-[#FCFAF6] px-3 text-xs"
          >
            <option value="">All movement types</option>
            {[
              "purchase",
              "consumption",
              "waste",
              "adjustment",
              "correction",
              "transfer",
              "return",
            ].map(entry => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        }
      />
      {query.isLoading ? (
        <LoadingPanel />
      ) : query.isError ? (
        <ErrorPanel error={query.error} retry={() => query.refetch()} />
      ) : query.data?.length ? (
        <section className="overflow-hidden rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6]">
          <div className="overflow-x-auto">
            <table className="min-w-[900px] w-full text-left">
              <thead className="border-b border-[#E8DED3] bg-[#F7F2EB]">
                <tr>
                  {[
                    "Date",
                    "Material / Prepared",
                    "Movement",
                    "Qty",
                    "Before",
                    "After",
                    "Outlet",
                    "Reference",
                    "By",
                  ].map(label => (
                    <th
                      key={label}
                      className="px-4 py-3 font-mono text-[9px] uppercase tracking-[0.11em] text-[#87796C]"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EDE4DA]">
                {query.data.map((row: any) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3 text-xs text-[#6F6257]">
                      {dateText(row.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-xs font-bold">
                      {row.itemName}
                      {row.referenceType ? ` • ${row.referenceType}` : ""}
                    </td>
                    <td className="px-4 py-3">
                      <Badge className="text-[10px] capitalize">
                        {row.type}
                      </Badge>
                    </td>
                    <td
                      className={`px-4 py-3 text-xs font-bold ${row.quantityChange < 0 ? "text-[#A83825]" : "text-[#2F6947]"}`}
                    >
                      {row.quantityChange > 0 ? "+" : ""}
                      {row.quantityChange} {row.unit}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {row.previousQuantity}
                    </td>
                    <td className="px-4 py-3 text-xs">{row.newQuantity}</td>
                    <td className="px-4 py-3 text-xs">
                      {row.referenceId ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {row.referenceId ? `#${row.referenceId}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {row.createdBy ?? "System"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <div className="grid min-h-[280px] place-items-center rounded-[14px] border border-dashed border-[#D5C8BA] bg-[#FCFAF6] p-6 text-center">
          <PackageSearch className="mx-auto h-8 w-8 text-[#A39486]" />
          <h3 className="mt-3 text-sm font-extrabold">
            No stock movements yet.
          </h3>
          <p className="mt-2 text-xs text-[#827568]">
            Movements are created by purchases, consumption, transfers and
            wastage — never by silent stock edits.
          </p>
        </div>
      )}
    </>
  );
}

function TransfersView({
  outletId,
  canManage,
}: {
  outletId: number | null;
  canManage: boolean;
}) {
  const list = trpc.inventory.transfers.list.useQuery(
    outletId ? { outletId } : undefined
  );
  const outlets = trpc.outlets.list.useQuery({ limit: 100 } as any);
  const materials = trpc.inventory.list.useQuery({ limit: 200 } as any);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    fromOutletId: outletId ? String(outletId) : "",
    toOutletId: "",
    items: [] as Array<{ inventoryItemId: string; quantity: string }>,
  });
  const create = trpc.inventory.transfers.create.useMutation({
    onSuccess: () => {
      toast.success("Transfer requested");
      setOpen(false);
      setForm({
        fromOutletId: outletId ? String(outletId) : "",
        toOutletId: "",
        items: [],
      });
      void list.refetch();
    },
    onError: e => toast.error(errorText(e)),
  });
  const update = trpc.inventory.transfers.updateStatus.useMutation({
    onSuccess: () => {
      toast.success("Transfer updated");
      void list.refetch();
    },
    onError: e => toast.error(errorText(e)),
  });
  return (
    <>
      <InventoryHeading
        kicker="Stock Transfers"
        title="Move stock between outlets atomically."
        detail="Transfer out and transfer in are paired movements — either both succeed or nothing changes."
        action={
          canManage ? (
            <Button
              onClick={() => setOpen(true)}
              className="bg-[#211B18] text-xs text-white"
            >
              <Truck className="mr-1 h-4 w-4" />
              New transfer
            </Button>
          ) : undefined
        }
      />
      {list.isLoading ? (
        <LoadingPanel />
      ) : list.isError ? (
        <ErrorPanel error={list.error} retry={() => list.refetch()} />
      ) : !list.data?.length ? (
        <div className="grid min-h-[280px] place-items-center rounded-[14px] border border-dashed border-[#D5C8BA] bg-[#FCFAF6] p-6 text-center">
          <Truck className="mx-auto h-8 w-8 text-[#A39486]" />
          <h3 className="mt-3 text-sm font-extrabold">No transfers yet.</h3>
          <p className="mt-2 text-xs text-[#827568]">
            Transfer stock from Outlet A to Outlet B. Paired ledger entries
            guarantee reconciliation.
          </p>
          {canManage && (
            <Button
              onClick={() => setOpen(true)}
              className="mt-4 bg-[#211B18] text-xs text-white"
            >
              Create transfer
            </Button>
          )}
        </div>
      ) : (
        <section className="overflow-hidden rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6]">
          <div className="overflow-x-auto">
            <table className="min-w-[900px] w-full text-left">
              <thead className="border-b bg-[#F7F2EB]">
                <tr>
                  {[
                    "Transfer",
                    "From",
                    "To",
                    "Items",
                    "Status",
                    "Created",
                    "Actions",
                  ].map(h => (
                    <th
                      key={h}
                      className="px-3 py-3 font-mono text-[9px] uppercase tracking-[0.11em] text-[#87796C]"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {list.data.map((t: any) => (
                  <tr key={t.id}>
                    <td className="px-3 py-3 font-mono text-xs font-bold">
                      {t.transferNumber}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      Outlet #{t.fromOutletId}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      Outlet #{t.toOutletId}
                    </td>
                    <td className="px-3 py-3 text-xs">{t.itemsCount}</td>
                    <td className="px-3 py-3">
                      <Badge
                        className={
                          t.status === "received"
                            ? "bg-[#E5F2E9] text-[#2F6947]"
                            : t.status === "requested"
                              ? "bg-[#FBF0D5] text-[#8A5D10]"
                              : "bg-[#F6F0E8]"
                        }
                      >
                        {t.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-xs text-[#6F6257]">
                      {dateText(t.createdAt)}
                    </td>
                    <td className="px-3 py-3 flex gap-1">
                      {t.status === "requested" && (
                        <Button
                          className="h-7 bg-[#211B18] px-2 text-[10px] text-white"
                          onClick={() =>
                            update.mutate({ id: t.id, status: "approved" })
                          }
                        >
                          Approve
                        </Button>
                      )}
                      {t.status === "approved" && (
                        <Button
                          className="h-7 bg-[#D5962A] px-2 text-[10px] text-white"
                          onClick={() =>
                            update.mutate({ id: t.id, status: "in_transit" })
                          }
                        >
                          In Transit
                        </Button>
                      )}
                      {["approved", "in_transit", "requested"].includes(
                        t.status
                      ) && (
                        <Button
                          className="h-7 bg-[#468A61] px-2 text-[10px] text-white"
                          onClick={() =>
                            update.mutate({ id: t.id, status: "received" })
                          }
                        >
                          Receive
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        size="xl"
        title="New stock transfer"
        description="Atomic: source −qty and destination +qty happen together or not at all."
        onSubmit={event => {
          event.preventDefault();
          if (!form.fromOutletId || !form.toOutletId)
            return toast.error("Select outlets");
          if (form.items.length === 0)
            return toast.error("Add at least one item");
          const items = form.items.map(it => ({
            inventoryItemId: it.inventoryItemId
              ? Number(it.inventoryItemId)
              : null,
            preparedItemId: null,
            quantity: Number(it.quantity),
          }));
          if (
            items.some(
              i =>
                !i.inventoryItemId ||
                !Number.isFinite(i.quantity) ||
                i.quantity <= 0
            )
          )
            return toast.error("Check items");
          create.mutate({
            fromOutletId: Number(form.fromOutletId),
            toOutletId: Number(form.toOutletId),
            notes: null,
            items: items as any,
          });
        }}
        submitLabel="Request transfer"
        submitPending={create.isPending}
        formClassName="grid gap-3 sm:grid-cols-2"
      >
        <SelectField
          label="From outlet"
          value={form.fromOutletId}
          onChange={v => setForm({ ...form, fromOutletId: v })}
          options={
            outlets.data?.items.map((o: any) => [String(o.id), o.name]) ?? []
          }
        />
        <SelectField
          label="To outlet"
          value={form.toOutletId}
          onChange={v => setForm({ ...form, toOutletId: v })}
          options={
            outlets.data?.items.map((o: any) => [String(o.id), o.name]) ?? []
          }
        />
        <div className="rounded-xl border bg-white p-3">
          <p className="text-xs font-bold">Items</p>
          {form.items.map((it, idx) => (
            <div
              key={idx}
              className="mt-2 grid grid-cols-[1fr_110px_auto] gap-2 items-center"
            >
              <select
                value={it.inventoryItemId}
                onChange={e =>
                  setForm({
                    ...form,
                    items: form.items.map((x, i) =>
                      i === idx ? { ...x, inventoryItemId: e.target.value } : x
                    ),
                  })
                }
                className="h-9 rounded-md border bg-white px-2 text-xs"
              >
                <option value="">Material</option>
                {materials.data?.items.map((m: any) => (
                  <option key={m.id} value={String(m.id)}>
                    {m.name} ({m.quantity} {m.unit})
                  </option>
                ))}
              </select>
              <Input
                value={it.quantity}
                onChange={e =>
                  setForm({
                    ...form,
                    items: form.items.map((x, i) =>
                      i === idx ? { ...x, quantity: e.target.value } : x
                    ),
                  })
                }
                placeholder="Qty"
                className="h-9 text-xs"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  setForm({
                    ...form,
                    items: form.items.filter((_, i) => i !== idx),
                  })
                }
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            className="mt-3 h-8 text-xs"
            onClick={() =>
              setForm({
                ...form,
                items: [...form.items, { inventoryItemId: "", quantity: "" }],
              })
            }
          >
            <Plus className="mr-1 h-4 w-4" />
            Add item
          </Button>
        </div>
      </FormDialog>
    </>
  );
}

function WastageView({
  outletId,
  canManage,
}: {
  outletId: number | null;
  canManage: boolean;
}) {
  const list = trpc.inventory.wastage.list.useQuery(
    outletId ? { outletId } : undefined
  );
  const analytics = trpc.inventory.wastage.analytics.useQuery(
    outletId ? { outletId } : undefined
  );
  const materials = trpc.inventory.list.useQuery({ limit: 200 } as any);
  const prepared = trpc.inventory.preparedItems.list.useQuery(
    outletId ? { outletId } : undefined
  );
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    inventoryItemId: "",
    preparedItemId: "",
    quantity: "",
    unit: "kg",
    reason: "spoiled" as any,
    notes: "",
  });
  const create = trpc.inventory.wastage.create.useMutation({
    onSuccess: () => {
      toast.success("Wastage recorded — stock reduced and ledger updated");
      setOpen(false);
      void list.refetch();
      void analytics.refetch();
    },
    onError: e => toast.error(errorText(e)),
  });
  return (
    <>
      <InventoryHeading
        kicker="Wastage"
        title="Waste is inventory truth."
        detail="Expired, spoiled, burned, dropped — every waste reduces stock and creates a movement with reason and outlet."
        action={
          canManage ? (
            <Button
              onClick={() => setOpen(true)}
              className="bg-[#B83D29] text-xs text-white hover:bg-[#962C20]"
            >
              <Trash2 className="mr-1 h-4 w-4" />
              Record wastage
            </Button>
          ) : undefined
        }
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric
          label="Wastage This Month"
          value={inr(analytics.data?.totalCost ?? 0)}
          detail={`${analytics.data?.count ?? 0} records`}
          tone="red"
        />
        <Metric
          label="Top Wasted"
          value={analytics.data?.top[0] ? inr(analytics.data.top[0].cost) : "—"}
          detail={analytics.data?.top[0]?.key ?? "No data"}
          tone="amber"
        />
        <Metric
          label="Outlet"
          value={outletId ? `Outlet #${outletId}` : "All Outlets"}
          detail="Filtered scope"
          tone="ink"
        />
      </div>
      {list.isLoading ? (
        <div className="mt-5">
          <LoadingPanel />
        </div>
      ) : list.isError ? (
        <div className="mt-5">
          <ErrorPanel error={list.error} retry={() => list.refetch()} />
        </div>
      ) : !list.data?.length ? (
        <div className="mt-5 grid min-h-[280px] place-items-center rounded-[14px] border border-dashed border-[#D5C8BA] bg-[#FCFAF6] p-6 text-center">
          <ReceiptText className="mx-auto h-8 w-8 text-[#A39486]" />
          <h3 className="mt-3 text-sm font-extrabold">No wastage yet.</h3>
          <p className="mt-2 text-xs text-[#827568]">
            Wastage records quantify expired and spoiled materials with
            estimated cost.
          </p>
        </div>
      ) : (
        <section className="mt-5 overflow-hidden rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6]">
          <div className="overflow-x-auto">
            <table className="min-w-[900px] w-full text-left">
              <thead className="border-b bg-[#F7F2EB]">
                <tr>
                  {[
                    "Date",
                    "Material / Prepared",
                    "Qty",
                    "Reason",
                    "Outlet",
                    "Cost",
                    "By",
                  ].map(h => (
                    <th
                      key={h}
                      className="px-3 py-3 font-mono text-[9px] uppercase tracking-[0.11em] text-[#87796C]"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {list.data.map((w: any) => (
                  <tr key={w.id}>
                    <td className="px-3 py-3 text-xs text-[#6F6257]">
                      {dateText(w.createdAt)}
                    </td>
                    <td className="px-3 py-3 text-xs font-bold">
                      {w.materialName ?? w.preparedName ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {w.quantity} {w.unit}
                    </td>
                    <td className="px-3 py-3">
                      <Badge className="text-[10px] capitalize">
                        {w.reason}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {w.outletName ??
                        (w.outletId ? `Outlet #${w.outletId}` : "—")}
                    </td>
                    <td className="px-3 py-3 text-xs font-mono">
                      {inr(w.estimatedCost)}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {w.createdBy ?? "System"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Record wastage"
        description="Reduces stock and creates waste movement + wastage record."
        onSubmit={event => {
          event.preventDefault();
          const qty = Number(form.quantity);
          if (!Number.isFinite(qty) || qty <= 0)
            return toast.error("Enter quantity");
          if (!form.inventoryItemId && !form.preparedItemId)
            return toast.error("Select material or prepared item");
          create.mutate({
            inventoryItemId: form.inventoryItemId
              ? Number(form.inventoryItemId)
              : null,
            preparedItemId: form.preparedItemId
              ? Number(form.preparedItemId)
              : null,
            outletId,
            quantity: qty,
            unit: form.unit.trim() || "unit",
            reason: form.reason,
            notes: form.notes.trim() || null,
          });
        }}
        submitLabel="Record wastage"
        submitPending={create.isPending}
        destructive
        formClassName="grid gap-3"
      >
        <div className="grid grid-cols-2 gap-3">
          <SelectField
            label="Material"
            value={form.inventoryItemId}
            onChange={v =>
              setForm({ ...form, inventoryItemId: v, preparedItemId: "" })
            }
            options={
              materials.data?.items.map((m: any) => [
                String(m.id),
                `${m.name} (${m.quantity} ${m.unit})`,
              ]) ?? []
            }
          />
          <SelectField
            label="Prepared item"
            value={form.preparedItemId}
            onChange={v =>
              setForm({ ...form, preparedItemId: v, inventoryItemId: "" })
            }
            options={
              prepared.data?.map((p: any) => [
                String(p.id),
                `${p.name} (${p.quantity} ${p.unit})`,
              ]) ?? []
            }
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field
            label="Quantity"
            value={form.quantity}
            onChange={v => setForm({ ...form, quantity: v })}
            type="number"
            required
          />
          <Field
            label="Unit"
            value={form.unit}
            onChange={v => setForm({ ...form, unit: v })}
          />
          <SelectField
            label="Reason"
            value={form.reason}
            onChange={v => setForm({ ...form, reason: v as any })}
            options={[
              ["expired", "Expired"],
              ["spoiled", "Spoiled"],
              ["damaged", "Damaged"],
              ["burned", "Burned"],
              ["preparation_error", "Preparation Error"],
              ["dropped", "Dropped"],
              ["quality_issue", "Quality Issue"],
              ["other", "Other"],
            ]}
            empty={false}
          />
        </div>
        <Field
          label="Notes"
          value={form.notes}
          onChange={v => setForm({ ...form, notes: v })}
        />
      </FormDialog>
    </>
  );
}

function LowStockView({
  outletId,
  onNavigate,
}: {
  outletId: number | null;
  onNavigate: (href: string) => void;
}) {
  const low = trpc.inventory.lowStock.useQuery(
    outletId ? { outletId, limit: 50 } : { limit: 50 }
  );
  if (low.isLoading) return <LoadingPanel />;
  if (low.isError)
    return <ErrorPanel error={low.error} retry={() => low.refetch()} />;
  if (!low.data?.length)
    return (
      <div className="grid min-h-[320px] place-items-center rounded-[14px] border border-dashed border-[#D5C8BA] bg-[#FCFAF6] p-8 text-center">
        <PackagePlus className="mx-auto h-8 w-8 text-[#A39486]" />
        <h3 className="mt-3 text-sm font-extrabold">No low stock.</h3>
        <p className="mt-2 text-xs text-[#827568]">
          All materials are above their reorder levels in the selected outlet
          scope.
        </p>
      </div>
    );
  return (
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {low.data.map((item: any) => (
        <article
          key={item.id}
          className="rounded-[14px] border border-[#F3C5B9] bg-[#FFF8F5] p-4 shadow-[0_2px_8px_rgba(55,38,25,0.04)]"
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-extrabold">{item.name}</p>
              <p className="text-xs text-[#8B7E71]">
                {item.sku} • {item.categoryName ?? "—"}
              </p>
              <p className="mt-1 text-xs text-[#A83825]">
                {item.outletName ??
                  (item.outletId ? `Outlet #${item.outletId}` : "Global")}{" "}
                • Current {item.quantity} {item.unit} / Min {item.reorderLevel}{" "}
                {item.unit}
              </p>
            </div>
            <StatusBadge status={item.status} />
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              variant="outline"
              className="h-8 flex-1 border-[#E8B9AC] bg-white text-xs"
              onClick={() => onNavigate(`/inventory/materials/${item.id}`)}
            >
              View Material
            </Button>
            <Button
              className="h-8 flex-1 bg-[#211B18] text-xs text-white"
              onClick={() => onNavigate("/inventory/purchases")}
            >
              Create PO
            </Button>
          </div>
        </article>
      ))}
    </section>
  );
}

function SuppliersView({ canManage }: { canManage: boolean }) {
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState(false);
  const [current, setCurrent] = useState<any>(null);
  const list = trpc.inventory.suppliers.list.useQuery({
    search: search.trim() || undefined,
  });
  return (
    <>
      <InventoryHeading
        kicker="Suppliers"
        title="Keep your sources close."
        detail="Supplier records are connected to stock and purchasing. Deactivation preserves historic links."
        action={
          canManage ? (
            <Button
              onClick={() => {
                setCurrent(null);
                setDialog(true);
              }}
              className="bg-[#E2533C] text-xs text-white"
            >
              <Plus className="mr-1 h-4 w-4" />
              Add supplier
            </Button>
          ) : undefined
        }
      />
      <div className="mb-4 max-w-sm">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[#8E8174]" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search suppliers"
            className="h-10 border-[#DCCFC2] bg-[#FCFAF6] pl-9 text-xs"
          />
        </div>
      </div>
      {list.isLoading ? (
        <LoadingPanel />
      ) : list.isError ? (
        <ErrorPanel error={list.error} retry={() => list.refetch()} />
      ) : !list.data?.length ? (
        <div className="grid min-h-[280px] place-items-center rounded-[14px] border border-dashed border-[#D5C8BA] bg-[#FCFAF6] p-6 text-center">
          <h3 className="mt-3 text-sm font-extrabold">
            No suppliers added yet.
          </h3>
          <Button
            onClick={() => setDialog(true)}
            className="mt-3 bg-[#211B18] text-xs text-white"
          >
            Add Supplier
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.data.map((s: any) => (
            <article
              key={s.id}
              className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-extrabold">{s.name}</p>
                  <p className="text-xs text-[#776A5E]">
                    {s.contactName ?? "No contact"}
                  </p>
                </div>
                <Badge
                  className={
                    s.active
                      ? "border-[#BDE0C8] bg-[#E5F2E9] text-[#2F6947]"
                      : "border-[#E3D9CE] bg-[#F6F0E8] text-[#706356]"
                  }
                >
                  {s.active ? "Active" : "Inactive"}
                </Badge>
              </div>
              <p className="mt-3 text-xs text-[#776A5E]">
                {s.phone ?? "—"} • {s.email ?? "—"}
              </p>
              <Button
                variant="outline"
                className="mt-3 h-7 text-xs"
                onClick={() => {
                  setCurrent(s);
                  setDialog(true);
                }}
              >
                Edit
              </Button>
            </article>
          ))}
        </div>
      )}
      <SupplierDialog
        open={dialog}
        current={current}
        onOpenChange={setDialog}
        onSaved={() => {
          setDialog(false);
          void list.refetch();
        }}
      />
    </>
  );
}
function SupplierDialog({
  open,
  current,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  current?: any;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    contactName: "",
    phone: "",
    email: "",
    address: "",
    notes: "",
    active: true,
  });
  const create = trpc.inventory.suppliers.create.useMutation({
    onSuccess: () => {
      toast.success("Supplier saved.");
      onSaved();
    },
    onError: e => toast.error(errorText(e)),
  });
  const update = trpc.inventory.suppliers.update.useMutation({
    onSuccess: () => {
      toast.success("Supplier updated.");
      onSaved();
    },
    onError: e => toast.error(errorText(e)),
  });
  useEffect(() => {
    setForm(
      current
        ? {
            name: current.name,
            contactName: current.contactName ?? "",
            phone: current.phone ?? "",
            email: current.email ?? "",
            address: current.address ?? "",
            notes: current.notes ?? "",
            active: current.active,
          }
        : {
            name: "",
            contactName: "",
            phone: "",
            email: "",
            address: "",
            notes: "",
            active: true,
          }
    );
  }, [current, open]);
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={current ? "Edit supplier" : "Add supplier"}
      description="Suppliers are outlet-scoped and referenced by purchase orders."
      onSubmit={event => {
        event.preventDefault();
        if (!form.name.trim()) return toast.error("Name required");
        const payload: any = {
          name: form.name.trim(),
          contactName: form.contactName.trim() || null,
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          address: form.address.trim() || null,
          notes: form.notes.trim() || null,
          suppliedCategories: [],
        };
        if (current) {
          update.mutate({ ...payload, id: current.id, active: form.active });
        } else {
          create.mutate(payload);
        }
      }}
      submitLabel="Save"
      submitPending={create.isPending || update.isPending}
      formClassName="gap-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Name *"
          value={form.name}
          onChange={v => setForm({ ...form, name: v })}
          required
        />
        <Field
          label="Contact"
          value={form.contactName}
          onChange={v => setForm({ ...form, contactName: v })}
        />
        <Field
          label="Phone"
          value={form.phone}
          onChange={v => setForm({ ...form, phone: v })}
        />
        <Field
          label="Email"
          value={form.email}
          onChange={v => setForm({ ...form, email: v })}
        />
      </div>
      <Field
        label="Address"
        value={form.address}
        onChange={v => setForm({ ...form, address: v })}
      />
      <Field
        label="Notes"
        value={form.notes}
        onChange={v => setForm({ ...form, notes: v })}
      />
    </FormDialog>
  );
}
// Override missing components by aliasing

function PurchaseOrdersView({ canManage }: { canManage: boolean }) {
  const utils = trpc.useUtils();
  const [createOpen, setCreateOpen] = useState(false);
  const [receive, setReceive] = useState<any>(null);
  const [confirmOrder, setConfirmOrder] = useState<any>(null);
  const [confirmCancel, setConfirmCancel] = useState<any>(null);
  const list = trpc.inventory.purchaseOrders.list.useQuery();
  const status = trpc.inventory.purchaseOrders.updateStatus.useMutation({
    onSuccess: (_: any, v: any) => {
      toast.success(v.status === "cancelled" ? "Cancelled" : "Marked ordered");
      setConfirmOrder(null);
      setConfirmCancel(null);
      void utils.inventory.purchaseOrders.invalidate();
      void utils.inventory.dashboard.invalidate();
    },
    onError: e => toast.error(errorText(e)),
  });
  return (
    <>
      <InventoryHeading
        kicker="Purchase Orders"
        title="Order the next service with intent."
        detail="Receipts update stock and create a purchase movement exactly once per received quantity."
        action={
          canManage ? (
            <Button
              onClick={() => setCreateOpen(true)}
              className="bg-[#E2533C] text-xs text-white"
            >
              <Plus className="mr-1 h-4 w-4" />
              Create purchase order
            </Button>
          ) : undefined
        }
      />
      {list.isLoading ? (
        <LoadingPanel />
      ) : list.isError ? (
        <ErrorPanel error={list.error} retry={() => list.refetch()} />
      ) : !list.data?.length ? (
        <div className="grid min-h-[280px] place-items-center rounded-[14px] border border-dashed border-[#D5C8BA] bg-[#FCFAF6] p-6 text-center">
          <ShoppingCart className="mx-auto h-8 w-8 text-[#A39486]" />
          <h3 className="mt-3 text-sm font-extrabold">
            No purchase orders yet.
          </h3>
          <p className="mt-2 text-xs text-[#827568]">
            Create a purchase order — goods received will add inventory.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6]">
          <div className="overflow-x-auto">
            <table className="min-w-[760px] w-full text-left">
              <thead className="border-b bg-[#F7F2EB]">
                <tr>
                  {[
                    "PO",
                    "Supplier",
                    "Status",
                    "Subtotal",
                    "Created",
                    "Actions",
                  ].map(h => (
                    <th
                      key={h}
                      className="px-4 py-3 font-mono text-[9px] uppercase tracking-[0.11em] text-[#87796C]"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {list.data.map((o: any) => (
                  <tr key={o.id}>
                    <td className="px-4 py-4 font-mono text-xs font-bold">
                      {o.poNumber}
                    </td>
                    <td className="px-4 py-4 text-xs">{o.supplierName}</td>
                    <td className="px-4 py-4">
                      <Badge className="text-[10px]">{o.status}</Badge>
                    </td>
                    <td className="px-4 py-4 text-xs">{inr(o.subtotal)}</td>
                    <td className="px-4 py-3 text-xs text-[#6F6257]">
                      {dateText(o.createdAt)}
                    </td>
                    <td className="px-4 py-3 flex gap-1">
                      {canManage && o.status === "draft" ? (
                        <>
                          <Button
                            onClick={() => setConfirmOrder(o)}
                            className="h-7 bg-[#211B18] px-2 text-[10px] text-white"
                          >
                            Mark ordered
                          </Button>
                          <Button
                            variant="outline"
                            className="h-7 border-[#E8B9AC] px-2 text-[10px] text-[#A83825]"
                            onClick={() => setConfirmCancel(o)}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : canManage &&
                        (o.status === "ordered" ||
                          o.status === "partially_received") ? (
                        <>
                          <Button
                            onClick={() => setReceive(o)}
                            className="h-7 bg-[#E2533C] px-2 text-[10px] text-white"
                          >
                            Receive
                          </Button>
                          <Button
                            variant="outline"
                            className="h-7 px-2 text-[10px]"
                            onClick={() => setConfirmCancel(o)}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <span className="text-[11px] text-[#827568]">
                          No action
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <PurchaseOrderDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={() => {
          setCreateOpen(false);
          void utils.inventory.purchaseOrders.invalidate();
        }}
      />
      <ReceiveDialog
        open={Boolean(receive)}
        orderId={receive?.id}
        onOpenChange={o => !o && setReceive(null)}
        onSaved={() => {
          setReceive(null);
          void utils.inventory.purchaseOrders.invalidate();
          void utils.inventory.list.invalidate();
        }}
      />
      <ConfirmDialog
        open={Boolean(confirmOrder)}
        onOpenChange={o => !o && setConfirmOrder(null)}
        title={`Mark ${confirmOrder?.poNumber} as ordered?`}
        description="Does not change stock; only receipt does."
        confirmLabel="Mark ordered"
        size="md"
        pending={status.isPending}
        onConfirm={() =>
          status.mutate({ id: confirmOrder.id, status: "ordered" })
        }
      />
      <ConfirmDialog
        open={Boolean(confirmCancel)}
        onOpenChange={o => !o && setConfirmCancel(null)}
        title={`Cancel ${confirmCancel?.poNumber}?`}
        description="Stops future receiving."
        confirmLabel="Cancel PO"
        cancelLabel="Keep"
        destructive
        size="md"
        pending={status.isPending}
        onConfirm={() =>
          status.mutate({ id: confirmCancel.id, status: "cancelled" })
        }
      />
    </>
  );
}
function PurchaseOrderDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const suppliers = trpc.inventory.suppliers.list.useQuery();
  const inventory = trpc.inventory.list.useQuery({ limit: 200 } as any);
  const [poNumber, setPoNumber] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<
    Array<{
      inventoryItemId: number;
      quantity: number;
      unitCost: number;
      name: string;
    }>
  >([]);
  const create = trpc.inventory.purchaseOrders.create.useMutation({
    onSuccess: () => {
      toast.success("Purchase order created as draft.");
      setLines([]);
      setPoNumber("");
      setSupplierId("");
      onSaved();
    },
    onError: e => toast.error(errorText(e)),
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title="Create purchase order"
      description="Draft until marked ordered. Receipt adds inventory."
      onSubmit={event => {
        event.preventDefault();
        if (!poNumber.trim() || !supplierId)
          return toast.error("PO number & supplier required");
        if (!lines.length) return toast.error("Add at least one line");
        create.mutate({
          poNumber: poNumber.trim(),
          supplierId: Number(supplierId),
          notes: notes.trim() || null,
          lines: lines.map(l => ({
            inventoryItemId: l.inventoryItemId,
            quantity: l.quantity,
            unitCost: l.unitCost,
          })),
        });
      }}
      submitLabel="Create draft"
      submitPending={create.isPending}
      formClassName="grid gap-3 sm:grid-cols-2"
    >
      <Field
        label="PO number *"
        value={poNumber}
        onChange={setPoNumber}
        required
      />
      <SelectField
        label="Supplier *"
        value={supplierId}
        onChange={setSupplierId}
        options={suppliers.data?.map((s: any) => [String(s.id), s.name]) ?? []}
      />
      <div className="rounded-xl border bg-white p-3">
        <p className="text-xs font-bold">Add line</p>
        <div className="mt-2 grid grid-cols-[1fr_90px_90px_auto] gap-2">
          <select
            value={itemId}
            onChange={e => setItemId(e.target.value)}
            className="h-9 rounded-md border bg-white px-2 text-xs"
          >
            <option value="">Material</option>
            {inventory.data?.items.map((m: any) => (
              <option key={m.id} value={String(m.id)}>
                {m.name}
              </option>
            ))}
          </select>
          <Input
            value={quantity}
            onChange={e => setQuantity(e.target.value)}
            placeholder="Qty"
            className="h-9 text-xs"
          />
          <Input
            value={unitCost}
            onChange={e => setUnitCost(e.target.value)}
            placeholder="Cost"
            className="h-9 text-xs"
          />
          <Button
            onClick={() => {
              const item = inventory.data?.items.find(
                (x: any) => String(x.id) === itemId
              );
              const qty = Number(quantity);
              const cost = Number(unitCost);
              if (
                !item ||
                !Number.isFinite(qty) ||
                qty <= 0 ||
                !Number.isFinite(cost)
              )
                return toast.error("Check line");
              setLines([
                ...lines,
                {
                  inventoryItemId: item.id,
                  quantity: qty,
                  unitCost: cost,
                  name: item.name,
                },
              ]);
              setItemId("");
              setQuantity("");
              setUnitCost("");
            }}
            className="h-9 bg-[#211B18] px-3 text-xs text-white"
          >
            Add
          </Button>
        </div>
        {lines.length ? (
          <ul className="mt-3 divide-y rounded-xl border">
            {lines.map((l, i) => (
              <li key={i} className="flex justify-between p-2 text-xs">
                <span>
                  {l.name} × {l.quantity}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => setLines(lines.filter((_, idx) => idx !== i))}
                >
                  <X className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <Field label="Notes" value={notes} onChange={setNotes} />
    </FormDialog>
  );
}
function ReceiveDialog({
  open,
  orderId,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  orderId?: number;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const detail = trpc.inventory.purchaseOrders.byId.useQuery(
    { id: orderId ?? 0 },
    { enabled: Boolean(orderId) }
  );
  const receive = trpc.inventory.purchaseOrders.receive.useMutation({
    onSuccess: () => {
      toast.success("Receipt recorded");
      onSaved();
    },
    onError: e => toast.error(errorText(e)),
  });
  const [receipts, setReceipts] = useState<
    Record<
      number,
      {
        quantity: string;
        unitCost: string;
        lotNumber: string;
        expiryDate: string;
      }
    >
  >({});
  // This used to be `if (!detail.data) return <spinner/>` with no error branch,
  // so a failed `purchaseOrders.byId` — or an open dialog with no orderId —
  // produced a spinner that never resolved and no way out. Each distinct cause
  // now gets its own honest state.
  if (detail.isError)
    return (
      <ViewDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Couldn't load the purchase order"
        description="The purchase order request failed. Nothing was changed."
        footer={
          <Button variant="outline" onClick={() => detail.refetch()}>
            Try again
          </Button>
        }
      >
        <p className="text-sm text-[#776A5E]">{errorText(detail.error)}</p>
      </ViewDialog>
    );
  if (!orderId)
    return (
      <ViewDialog
        open={open}
        onOpenChange={onOpenChange}
        title="No purchase order selected"
        description="Close this dialog and pick an order to receive against."
      />
    );
  if (!detail.data)
    return (
      <ViewDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Loading purchase order…"
        description="Fetching the ordered lines."
      >
        <div className="grid place-items-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
        </div>
      </ViewDialog>
    );
  const order = detail.data as any;
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title={`Receive ${order.poNumber}`}
      description="Partial receiving supported. Verify quantity before confirming."
      onSubmit={event => {
        event.preventDefault();
        const lines = Object.entries(receipts)
          .map(([lineId, v]: any) => ({
            lineId: Number(lineId),
            quantity: Number(v.quantity),
            unitCost: Number(v.unitCost),
            lotNumber: v.lotNumber.trim() || null,
            expiryDate: v.expiryDate || null,
          }))
          .filter(l => l.quantity > 0);
        if (!lines.length) return toast.error("Enter at least one quantity");
        receive.mutate({ id: order.id, notes: null, lines });
      }}
      submitLabel="Confirm receipt"
      submitPending={receive.isPending}
      formClassName="space-y-3"
    >
      {order.lines.map((line: any) => (
        <div key={line.id} className="rounded-xl border bg-white p-3">
          <p className="text-xs font-bold">
            {line.itemName} — ordered {line.orderedQuantity} {line.unit},
            received {line.receivedQuantity}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Input
              placeholder="Qty"
              value={receipts[line.id]?.quantity ?? ""}
              onChange={e =>
                setReceipts({
                  ...receipts,
                  [line.id]: {
                    quantity: e.target.value,
                    unitCost:
                      receipts[line.id]?.unitCost ?? String(line.unitCost),
                    lotNumber: receipts[line.id]?.lotNumber ?? "",
                    expiryDate: receipts[line.id]?.expiryDate ?? "",
                  },
                })
              }
              className="h-8 text-xs"
            />
            <Input
              placeholder="Cost"
              value={receipts[line.id]?.unitCost ?? String(line.unitCost)}
              onChange={e =>
                setReceipts({
                  ...receipts,
                  [line.id]: {
                    quantity: receipts[line.id]?.quantity ?? "",
                    unitCost: e.target.value,
                    lotNumber: receipts[line.id]?.lotNumber ?? "",
                    expiryDate: receipts[line.id]?.expiryDate ?? "",
                  },
                })
              }
              className="h-8 text-xs"
            />
            <Input
              placeholder="Lot"
              value={receipts[line.id]?.lotNumber ?? ""}
              onChange={e =>
                setReceipts({
                  ...receipts,
                  [line.id]: {
                    quantity: receipts[line.id]?.quantity ?? "",
                    unitCost:
                      receipts[line.id]?.unitCost ?? String(line.unitCost),
                    lotNumber: e.target.value,
                    expiryDate: receipts[line.id]?.expiryDate ?? "",
                  },
                })
              }
              className="h-8 text-xs"
            />
            <Input
              type="date"
              value={receipts[line.id]?.expiryDate ?? ""}
              onChange={e =>
                setReceipts({
                  ...receipts,
                  [line.id]: {
                    quantity: receipts[line.id]?.quantity ?? "",
                    unitCost:
                      receipts[line.id]?.unitCost ?? String(line.unitCost),
                    lotNumber: receipts[line.id]?.lotNumber ?? "",
                    expiryDate: e.target.value,
                  },
                })
              }
              className="h-8 text-xs"
            />
          </div>
        </div>
      ))}
    </FormDialog>
  );
}
