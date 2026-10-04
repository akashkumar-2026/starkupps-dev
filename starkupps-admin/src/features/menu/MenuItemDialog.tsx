import { trpc } from "@/api/trpc";
import { FormField } from "@/components/shared/FormField";
import { FormDialog } from "@/components/shared/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/utils/cn";
import { apiError } from "@/utils/errors";
import { Image as ImageIcon, Loader2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const UNIT_OPTIONS = [
  "ml",
  "L",
  "g",
  "kg",
  "piece",
  "cup",
  "plate",
  "serving",
  "inch",
  "units",
  "packs",
  "boxes",
  "bottles",
  "slice",
  "portion",
  "",
] as const;

export function MenuItemDialog({
  open,
  onOpenChange,
  categories,
  current,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  categories: any[];
  current: any;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    categoryId: "",
    name: "",
    description: "",
    veg: true,
    available: true,
    comingSoon: false,
    imageUrl: "",
  });
  const [variants, setVariants] = useState<
    Array<{
      id?: number;
      name: string;
      quantity: string;
      unit: string;
      price: string;
      sku: string;
      available: boolean;
      isDefault: boolean;
    }>
  >([]);
  /*
   * The seeded state doubles as the dirty baseline.
   *
   * It is captured on every reset so Escape can be blocked while the form holds
   * work the user would not get back. `defaultCategoryId` is a primitive on
   * purpose: this effect used to depend on the `categories` array itself, whose
   * identity changes on every background refetch, so a refetch could wipe a
   * half-typed item.
   */
  const defaultCategoryId = categories[0] ? String(categories[0].id) : "";
  const baseline = useRef("");
  useEffect(() => {
    if (current) {
      const next = {
        categoryId: String(current.categoryId),
        name: current.name,
        description: current.description || "",
        veg: current.veg,
        available: current.available,
        comingSoon: Boolean(current.comingSoon),
        imageUrl: current.imageUrl || "",
      };
      const vs = (current.variants ?? []).map((v: any) => ({
        id: v.id,
        name: v.name,
        quantity: v.quantity != null ? String(v.quantity) : "",
        unit: v.unit || "",
        price: String(v.price),
        sku: v.sku || "",
        available: Boolean(v.available),
        isDefault: Boolean(v.isDefault),
      }));
      setForm(next);
      setVariants(vs);
      baseline.current = JSON.stringify([next, vs]);
    } else {
      const next = {
        categoryId: defaultCategoryId,
        name: "",
        description: "",
        veg: true,
        available: true,
        comingSoon: false,
        imageUrl: "",
      };
      setForm(next);
      setVariants([]);
      baseline.current = JSON.stringify([next, []]);
    }
  }, [current, open, defaultCategoryId]);
  const addVariant = () => {
    const baseName =
      variants.length === 0
        ? "Regular"
        : variants.length === 1
          ? "Medium"
          : variants.length === 2
            ? "Large"
            : `Size ${variants.length + 1}`;
    setVariants(v => [
      ...v,
      {
        name: baseName,
        quantity: "",
        unit: "ml",
        price: "",
        sku: "",
        available: true,
        isDefault: v.length === 0,
      },
    ]);
  };
  const updateVariant = (
    idx: number,
    patch: Partial<(typeof variants)[number]>
  ) =>
    setVariants(vs => vs.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  const removeVariant = (idx: number) =>
    setVariants(vs => {
      const next = vs.filter((_, i) => i !== idx);
      if (next.length && !next.some(x => x.isDefault)) next[0].isDefault = true;
      return next;
    });
  const setDefault = (idx: number) =>
    setVariants(vs => vs.map((x, i) => ({ ...x, isDefault: i === idx })));
  const moveVariant = (idx: number, dir: -1 | 1) =>
    setVariants(vs => {
      const next = [...vs];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return vs;
      const tmp = next[idx];
      next[idx] = next[j];
      next[j] = tmp;
      return next;
    });
  const create = trpc.admin.menu.create.useMutation({
    onSuccess: () => {
      toast.success("Menu item created");
      onSaved();
    },
    onError: e => toast.error(apiError(e)),
  });
  const update = trpc.admin.menu.update.useMutation({
    onSuccess: () => {
      toast.success("Menu item updated");
      onSaved();
    },
    onError: e => toast.error(apiError(e)),
  });
  const [uploadProgress, setUploadProgress] = useState(0);
  const doUpload = trpc.admin.storage.uploadProductImage.useMutation({
    onSuccess: res => {
      if (!res?.url) {
        setUploadProgress(0);
        toast.error("Upload failed — no URL returned");
        return;
      }
      setForm(f => ({ ...f, imageUrl: res.url }));
      setUploadProgress(100);
      toast.success("Image uploaded");
      setTimeout(() => setUploadProgress(0), 800);
    },
    onError: e => {
      setUploadProgress(0);
      toast.error(apiError(e));
    },
  });
  useEffect(() => {
    if (!doUpload.isPending) return;
    setUploadProgress(10);
    const id = setInterval(
      () =>
        setUploadProgress(p =>
          p >= 90 ? p : Math.min(90, p + Math.random() * 12 + 4)
        ),
      320
    );
    return () => clearInterval(id);
  }, [doUpload.isPending]);
  const onFile = async (file: File) => {
    const allowed = new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/avif",
      "image/jpg",
    ]);
    if (!allowed.has(file.type.toLowerCase()))
      return toast.error("Only JPEG, PNG, WebP, GIF, AVIF allowed");
    if (file.size > 5 * 1024 * 1024)
      return toast.error(
        `Image too large — max 5 MB (got ${(file.size / 1024 / 1024).toFixed(2)} MB)`
      );
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const b64 = result.includes(",") ? result.split(",")[1]! : result;
      if (!b64) return toast.error("Could not read file");
      doUpload.mutate({
        filename: file.name,
        contentType: file.type,
        data: b64,
      });
    };
    reader.onerror = () => toast.error("Could not read file");
    reader.readAsDataURL(file);
  };
  const submit = () => {
    if (!form.name.trim() || !form.categoryId)
      return toast.error("Check item details — name and category are required");
    if (!variants.length)
      return toast.error(
        "Add at least one size/variant with its price (e.g. Regular 180 ml ₹140)"
      );
    for (const v of variants) {
      if (!v.name.trim()) return toast.error("Each size needs a name");
      const vp = Number(v.price);
      if (!Number.isFinite(vp) || vp <= 0)
        return toast.error(`Check price for "${v.name}"`);
      if (v.quantity && (isNaN(Number(v.quantity)) || Number(v.quantity) <= 0))
        return toast.error(`Invalid quantity for "${v.name}"`);
    }
    const names = variants.map(v => v.name.trim().toLowerCase());
    if (new Set(names).size !== names.length)
      return toast.error("Duplicate size names are not allowed");
    const skus = variants.map(v => v.sku.trim().toLowerCase()).filter(Boolean);
    if (new Set(skus).size !== skus.length)
      return toast.error("Duplicate SKUs are not allowed");
    const variantPayload = variants.map((v, i) => ({
      id: v.id,
      name: v.name.trim(),
      quantity: v.quantity ? Number(v.quantity) : null,
      unit: v.unit.trim() || null,
      price: Number(v.price),
      sku: v.sku.trim() || null,
      available: v.available,
      isDefault: v.isDefault,
      sortOrder: i,
    }));
    const data = {
      categoryId: Number(form.categoryId),
      name: form.name.trim(),
      description: form.description.trim() || null,
      imageUrl: form.imageUrl.trim() || null,
      veg: form.veg,
      available: form.available,
      comingSoon: form.comingSoon,
      variants: variantPayload,
    };
    if (current) {
      update.mutate({ id: current.id, ...data });
    } else {
      create.mutate(data as any);
    }
  };
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="2xl"
      title={current ? "Edit menu item" : "New menu item"}
      description={
        <>
          Each product is sold by its sizes — e.g.{" "}
          <span className="font-semibold text-[#211B18]">
            Cappuccino Regular 180 ml ₹140
          </span>{" "}
          · Medium 250 ml ₹180 · Large 350 ml ₹220. Add at least one size.
        </>
      }
      onSubmit={event => {
        event.preventDefault();
        submit();
      }}
      submitLabel="Save"
      submitPending={create.isPending || update.isPending}
      isDirty={baseline.current !== JSON.stringify([form, variants])}
      formClassName="grid gap-5"
    >
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#8B7E71]">
          Basic information
        </p>
        <div className="mt-3 grid gap-3">
          <FormField label="Category">
            <Select
              value={form.categoryId}
              onValueChange={v => setForm({ ...form, categoryId: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c: any) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Name">
            <Input
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              maxLength={160}
              placeholder="e.g. Cappuccino"
              className="bg-white"
            />
          </FormField>
          <FormField label="Description">
            <Textarea
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              maxLength={1000}
              placeholder="Short description (optional)"
              className="bg-white"
            />
          </FormField>
          <FormField label="Product image">
            <div className="grid gap-3">
              <Input
                value={form.imageUrl}
                onChange={e => setForm({ ...form, imageUrl: e.target.value })}
                placeholder="Paste image URL — https://..."
                className="bg-white"
              />
              <div className="flex flex-col gap-3 rounded-xl border border-dashed border-[#D5C8BA] bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#F8F4EE] text-[#8E8174]">
                    <ImageIcon className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-[#211B18]">
                      Upload to CDN
                    </p>
                    <p className="text-[11px] text-[#8B7E71]">
                      5 MB max · product-images bucket
                    </p>
                  </div>
                </div>
                <label
                  className={cn(
                    "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-xl border bg-white px-3 text-xs font-bold shadow-sm hover:bg-[#FCFAF6]",
                    doUpload.isPending
                      ? "pointer-events-none opacity-60 border-[#D8CDC0]"
                      : "border-[#D8CDC0]"
                  )}
                >
                  {doUpload.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  {doUpload.isPending ? "Uploading…" : "Choose file"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/jpg"
                    className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0];
                      if (f) onFile(f);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>
              {(doUpload.isPending || uploadProgress > 0) && (
                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-[#5A4E45]">
                      {uploadProgress >= 100 ? "Done" : "Uploading…"}
                    </span>
                    <span className="font-mono text-[11px] font-bold text-[#211B18]">
                      {Math.round(uploadProgress)}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#F0E6D8]">
                    <div
                      className="h-full bg-[#211B18] transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}
              {form.imageUrl ? (
                <div className="overflow-hidden rounded-xl border border-[#E4DCD1] bg-white shadow-sm">
                  <img
                    src={form.imageUrl}
                    alt="Preview"
                    className="h-36 w-full object-cover"
                    onError={e =>
                      ((e.target as HTMLImageElement).style.display = "none")
                    }
                  />
                  <div className="flex items-center justify-between gap-3 bg-[#FCFAF6] px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-[11px] text-[#5A4E45]">
                      {form.imageUrl}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 shrink-0 px-2 text-xs text-[#B83D29] hover:bg-[#FFF0EA]"
                      onClick={() => setForm(f => ({ ...f, imageUrl: "" }))}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </FormField>
          <div className="flex gap-3 pt-1">
            <label className="flex items-center gap-2 text-xs font-bold">
              <Switch
                checked={form.veg}
                onCheckedChange={v => setForm({ ...form, veg: v })}
              />{" "}
              Veg
            </label>
            <label className="flex items-center gap-2 text-xs font-bold">
              <Switch
                checked={form.available}
                onCheckedChange={v => setForm({ ...form, available: v })}
              />{" "}
              Available
            </label>
          </div>
          <label className="flex items-center justify-between rounded-xl border border-[#E4DCD1] bg-[#F8F4EE] px-4 py-3">
            <div>
              <p className="text-sm font-bold">Coming Soon</p>
              <p className="text-[11px] text-[#827568]">
                Visible but blurred; ordering blocked server-side
              </p>
            </div>
            <Switch
              checked={form.comingSoon}
              onCheckedChange={v => setForm({ ...form, comingSoon: v })}
            />
          </label>
        </div>
      </div>

      <div className="rounded-xl border border-[#E4DCD1] bg-[#F8F4EE] p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-extrabold tracking-[-0.02em]">
              Sizes &amp; Pricing
            </p>
            <p className="mt-1 text-xs leading-4 text-[#75695E]">
              Add sizes like Regular / Medium / Large, or custom labels like 8
              inch. Each size is a sellable variant with its own quantity, unit,
              price and availability.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={addVariant}
            className="h-8 shrink-0 border-[#D8CDC0] bg-white text-xs"
          >
            + Add Size
          </Button>
        </div>
        {variants.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-[#D5C8BA] bg-white p-4 text-center">
            <p className="text-xs font-bold text-[#5A4E45]">No sizes yet</p>
            <p className="mt-1 text-[11px] text-[#827568]">
              Leave empty for a single-price product (e.g. Espresso ₹120), or
              add sizes for cappuccino, pizza, cake etc.
            </p>
            <Button
              onClick={addVariant}
              variant="outline"
              className="mt-3 h-8 border-[#D8CDC0] bg-[#FCFAF6] text-xs"
            >
              Add Regular
            </Button>
          </div>
        ) : (
          <div className="mt-4 grid gap-3">
            {variants.map((v, idx) => (
              <div
                key={idx}
                className="rounded-xl border border-[#E6DDD2] bg-[#FCFAF6] p-3 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <label className="text-[11px] font-bold text-[#5A4E45]">
                      Size name
                    </label>
                    <Input
                      value={v.name}
                      onChange={e =>
                        updateVariant(idx, { name: e.target.value })
                      }
                      maxLength={120}
                      placeholder="Regular"
                      className="mt-1 h-8 text-xs"
                    />
                  </div>
                  <div className="flex items-center gap-1 pt-5">
                    <button
                      onClick={() => moveVariant(idx, -1)}
                      disabled={idx === 0}
                      className="grid h-7 w-7 place-items-center rounded-md border border-[#E6DDD2] bg-white text-xs disabled:opacity-40"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => moveVariant(idx, 1)}
                      disabled={idx === variants.length - 1}
                      className="grid h-7 w-7 place-items-center rounded-md border border-[#E6DDD2] bg-white text-xs disabled:opacity-40"
                    >
                      ↓
                    </button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeVariant(idx)}
                      className="h-7 px-2 text-xs text-[#B83D29] hover:bg-[#FFF0EA]"
                    >
                      Remove
                    </Button>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-[96px_96px_1fr] gap-2">
                  <label className="space-y-1">
                    <span className="text-[11px] font-bold text-[#5A4E45]">
                      Quantity
                    </span>
                    <Input
                      value={v.quantity}
                      onChange={e =>
                        updateVariant(idx, { quantity: e.target.value })
                      }
                      inputMode="decimal"
                      placeholder="250"
                      className="h-8 text-xs"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] font-bold text-[#5A4E45]">
                      Unit
                    </span>
                    <select
                      value={v.unit}
                      onChange={e =>
                        updateVariant(idx, { unit: e.target.value })
                      }
                      className="h-8 w-full rounded-md border border-[#DCCFC2] bg-white px-2 text-xs"
                    >
                      <option value="">—</option>
                      {UNIT_OPTIONS.filter(Boolean).map(u => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                      <option value="custom">custom…</option>
                    </select>
                    {v.unit && !UNIT_OPTIONS.includes(v.unit as any) && (
                      <Input
                        value={v.unit}
                        onChange={e =>
                          updateVariant(idx, { unit: e.target.value })
                        }
                        placeholder="custom unit"
                        className="mt-1 h-7 text-xs"
                      />
                    )}
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] font-bold text-[#5A4E45]">
                      Price (₹)
                    </span>
                    <Input
                      value={v.price}
                      onChange={e =>
                        updateVariant(idx, { price: e.target.value })
                      }
                      inputMode="decimal"
                      placeholder="180"
                      className="h-8 text-xs"
                    />
                  </label>
                </div>
                <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
                  <label className="space-y-1">
                    <span className="text-[11px] font-bold text-[#5A4E45]">
                      SKU (optional)
                    </span>
                    <Input
                      value={v.sku}
                      onChange={e =>
                        updateVariant(idx, { sku: e.target.value })
                      }
                      maxLength={80}
                      placeholder="CAP-REG"
                      className="h-8 text-xs"
                    />
                  </label>
                  <div className="flex items-end gap-2 pb-1">
                    <label className="flex items-center gap-1.5 text-xs font-bold">
                      <Switch
                        checked={v.available}
                        onCheckedChange={val =>
                          updateVariant(idx, { available: val })
                        }
                      />{" "}
                      <span className="text-[11px]">
                        {v.available ? "Available" : "Off"}
                      </span>
                    </label>
                    <label className="flex items-center gap-1.5 text-xs font-bold cursor-pointer">
                      <input
                        type="radio"
                        name="defaultVariant"
                        checked={v.isDefault}
                        onChange={() => setDefault(idx)}
                        className="h-3 w-3 accent-[#211B18]"
                      />{" "}
                      <span className="text-[11px]">Default</span>
                    </label>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {variants.length > 0 && (
          <p className="mt-3 text-[11px] text-[#8B7E71]">
            Tip: Regular / Small / Medium / Large are suggestions — you can use
            any label like <em>8 inch</em> or <em>Family</em>.
          </p>
        )}
      </div>
    </FormDialog>
  );
}
