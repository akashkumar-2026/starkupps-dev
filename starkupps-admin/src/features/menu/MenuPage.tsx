import { trpc } from "@/api/trpc";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { FilterButton } from "@/components/shared/FilterButton";
import { PageHeading } from "@/components/shared/PageHeading";
import {
  EmptyPanel,
  ErrorPanel,
  PageLoading,
} from "@/components/shared/StatePanels";
import { apiError } from "@/utils/errors";
import { inr } from "@/utils/format";
import { Edit3, MoreHorizontal, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { CategoryDialog } from "./CategoryDialog";
import { MenuItemDialog } from "./MenuItemDialog";

export default function MenuPage() {
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<number | undefined>();
  const [dialog, setDialog] = useState<"item" | "category" | null>(null);
  const [editing, setEditing] = useState<any>(null);
  const [removeItem, setRemoveItem] = useState<any>(null);
  const [removeCategory, setRemoveCategory] = useState<any>(null);
  const [editingCategory, setEditingCategory] = useState<any>(null);
  const input = useMemo(
    () => ({ limit: 50, search: search.trim() || undefined, categoryId }),
    [search, categoryId]
  );
  const query = trpc.admin.menu.list.useQuery(input);
  const utils = trpc.useUtils();
  const availability = trpc.admin.menu.setAvailability.useMutation({
    onSuccess: () => void utils.admin.menu.list.invalidate(),
    onError: e => toast.error(apiError(e)),
  });
  const itemComingSoonMut = trpc.admin.menu.setComingSoon.useMutation({
    onSuccess: () => void utils.admin.menu.list.invalidate(),
    onError: e => toast.error(apiError(e)),
  });
  const remove = trpc.admin.menu.remove.useMutation({
    onSuccess: () => {
      toast.success("Item removed");
      setRemoveItem(null);
    },
    onError: e => toast.error(apiError(e)),
    onSettled: () => {
      void utils.admin.menu.list.invalidate();
      void query.refetch();
    },
  });
  const removeCategoryMut = trpc.admin.menu.removeCategory.useMutation({
    onMutate: async ({ id }) => {
      await utils.admin.menu.list.cancel();
      const prev = utils.admin.menu.list.getData(input);
      if (prev) {
        utils.admin.menu.list.setData(input, {
          ...prev,
          categories: prev.categories.filter((c: any) => c.id !== id),
        } as any);
        // also patch any cached list variants (different input)
        utils.admin.menu.list.setData(undefined as any, undefined as any);
      }
      return { prev };
    },
    onSuccess: () => {
      toast.success("Category removed");
      setRemoveCategory(null);
      setCategoryId(undefined);
    },
    onError: (e, _vars, ctx) => {
      if ((ctx as any)?.prev)
        utils.admin.menu.list.setData(input, (ctx as any).prev);
      toast.error(apiError(e), {
        description:
          "Move or delete items in this category first. Only owners can delete categories. Check console → Network → admin.menu.removeCategory for 403/400.",
      });
      console.error("[removeCategory] failed", e);
    },
    onSettled: () => {
      void utils.admin.menu.list.invalidate();
      void query.refetch();
    },
  });
  const categories = query.data?.categories ?? [];
  return (
    <>
      <PageHeading
        kicker="Menu control"
        title="Run the menu with intent."
        detail="Create categories and catalogue items with saved availability."
        action={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setEditingCategory(null);
                setDialog("category");
              }}
              className="border-[#D8CDC0] text-xs"
            >
              <Plus className="mr-1 h-4 w-4" />
              Category
            </Button>
            <Button
              onClick={() => {
                setEditing(null);
                setDialog("item");
              }}
              disabled={!categories.length}
              className="bg-[#211B18] text-xs text-white hover:bg-[#3A2D27]"
            >
              <Plus className="mr-1 h-4 w-4" />
              Menu item
            </Button>
          </div>
        }
      />
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-[#E4DCD1] bg-[#EEE9E1] p-1">
          <FilterButton
            label="All"
            active={!categoryId}
            onClick={() => setCategoryId(undefined)}
          />
          {categories.map((c: any) => (
            <div
              key={c.id}
              className="flex items-center gap-0.5 rounded-lg bg-white/0 pr-0.5"
            >
              <FilterButton
                label={c.comingSoon ? `${c.name} · Coming Soon` : c.name}
                active={categoryId === c.id}
                onClick={() => setCategoryId(c.id)}
              />
              {c.comingSoon && (
                <span className="rounded-full bg-[#E2533C] px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wide text-white">
                  Soon
                </span>
              )}
              <button
                onClick={() => {
                  setEditingCategory(c);
                  setDialog("category");
                }}
                title={`Edit ${c.name}`}
                className="grid h-7 w-7 place-items-center rounded-lg text-[#8E8174] hover:bg-white hover:text-[#211B18]"
              >
                <Edit3 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setRemoveCategory(c)}
                title={`Remove ${c.name}`}
                className="grid h-7 w-7 place-items-center rounded-lg text-[#8E8174] hover:bg-white hover:text-[#B83D29]"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        <div className="relative w-full lg:w-72">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[#8E8174]" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search menu"
            className="h-10 border-[#DCCFC2] bg-[#FCFAF6] pl-9 text-xs"
          />
        </div>
      </div>
      {query.isLoading ? (
        <PageLoading />
      ) : query.isError ? (
        <ErrorPanel
          detail={apiError(query.error)}
          retry={() => query.refetch()}
        />
      ) : !categories.length ? (
        <EmptyPanel
          title="Set up your first category"
          detail="Categories organise items at the counter."
          action={
            <Button
              onClick={() => setDialog("category")}
              className="bg-[#211B18] text-xs text-white"
            >
              Add category
            </Button>
          }
        />
      ) : query.data?.items.length === 0 ? (
        <EmptyPanel
          title="No menu items match this view"
          detail="Create a menu item."
          action={
            <Button
              onClick={() => {
                setEditing(null);
                setDialog("item");
              }}
              className="bg-[#211B18] text-xs text-white"
            >
              <Plus className="mr-1 h-4 w-4" />
              Add menu item
            </Button>
          }
        />
      ) : (
        <section className="overflow-hidden rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] shadow-[0_8px_20px_rgba(55,38,25,0.04)]">
          <div className="divide-y divide-[#E7DED4]">
            {query.data?.items.map((item: any) => {
              const cat = categories.find((c: any) => c.id === item.categoryId);
              const effectiveComingSoon =
                Boolean(item.comingSoon) || Boolean(cat?.comingSoon);
              return (
                <article
                  key={item.id}
                  className="flex items-center gap-3 px-5 py-4 hover:bg-[#FCF8F2]"
                >
                  <img
                    src={
                      item.imageUrl ||
                      "https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=200&q=80"
                    }
                    alt=""
                    className="h-14 w-14 rounded-xl object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-extrabold">
                        {item.name}
                      </h3>
                      <Badge className="border-[#E6DDD2] bg-[#F5F0E8] text-[9px] text-[#75695E]">
                        {item.categoryName}
                      </Badge>
                      {(item.variants?.length ?? 0) > 0 && (
                        <Badge className="border-[#D6CABD] bg-[#FFF4E8] text-[9px] text-[#8A5D10]">
                          {item.variants.length} sizes
                        </Badge>
                      )}
                      {effectiveComingSoon && (
                        <Badge className="border-[#E8B9AC] bg-[#FCE8E1] text-[9px] font-bold uppercase tracking-wide text-[#9A3627]">
                          Coming Soon
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 truncate text-[11px] text-[#827568]">
                      {item.description || "No description saved."}
                      {item.variants?.length
                        ? ` · ${item.variants.map((v: any) => `${v.name} ${v.quantity ? v.quantity + (v.unit || "") : ""} ${inr(v.price)}`.trim()).join(" · ")}`
                        : ""}
                    </p>
                  </div>
                  <span className="hidden font-mono text-xs font-semibold text-[#554A41] sm:block">
                    {item.variants?.length
                      ? item.variants.length === 1
                        ? inr(Number(item.variants[0].price))
                        : `${inr(Math.min(...item.variants.map((v: any) => Number(v.price))))} – ${inr(Math.max(...item.variants.map((v: any) => Number(v.price))))}`
                      : "—"}
                  </span>
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col items-center gap-1">
                      <Switch
                        checked={item.available}
                        onCheckedChange={v =>
                          availability.mutate({ id: item.id, available: v })
                        }
                      />
                      <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-[#8F8275]">
                        {item.available ? "Live" : "Off"}
                      </span>
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <Switch
                        checked={Boolean(item.comingSoon)}
                        onCheckedChange={v =>
                          itemComingSoonMut.mutate({
                            id: item.id,
                            comingSoon: v,
                          })
                        }
                      />
                      <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-[#8F8275]">
                        {item.comingSoon ? "Soon" : "Ready"}
                      </span>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="grid h-8 w-8 place-items-center rounded-lg text-[#8E8174] hover:bg-[#F1EAE1]">
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => {
                          setEditing(item);
                          setDialog("item");
                        }}
                      >
                        <Edit3 className="mr-2 h-4 w-4" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-[#B83D29]"
                        onClick={() => setRemoveItem(item)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Remove
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </article>
              );
            })}
          </div>
        </section>
      )}
      <MenuItemDialog
        open={dialog === "item"}
        onOpenChange={o => !o && setDialog(null)}
        categories={categories}
        current={editing}
        onSaved={() => {
          setDialog(null);
          void utils.admin.menu.list.invalidate();
        }}
      />
      <CategoryDialog
        open={dialog === "category"}
        onOpenChange={o => {
          if (!o) {
            setEditingCategory(null);
            setDialog(null);
          }
        }}
        editingCategory={editingCategory}
        onSaved={() => {
          setEditingCategory(null);
          setDialog(null);
          void utils.admin.menu.list.invalidate();
        }}
      />
      <AlertDialog
        open={Boolean(removeItem)}
        onOpenChange={o => !o && setRemoveItem(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeItem?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the item.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep item</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[#B83D29] hover:bg-[#962C20]"
              onClick={() => removeItem && remove.mutate({ id: removeItem.id })}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={Boolean(removeCategory)}
        onOpenChange={o => !o && setRemoveCategory(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove category {removeCategory?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the category. Categories containing
              items cannot be deleted — move or delete those items first. Only
              owners can delete categories.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep category</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[#B83D29] hover:bg-[#962C20]"
              onClick={() => {
                const c = removeCategory;
                if (c) removeCategoryMut.mutate({ id: c.id });
              }}
            >
              {removeCategoryMut.isPending ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
