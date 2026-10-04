import { trpc } from "@/api/trpc";
import { FormField } from "@/components/shared/FormField";
import { FormDialog } from "@/components/shared/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/utils/cn";
import { apiError } from "@/utils/errors";
import { Image as ImageIcon, Loader2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export function CategoryDialog({
  open,
  onOpenChange,
  editingCategory,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editingCategory?: any;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [comingSoon, setComingSoon] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const isEdit = Boolean(editingCategory);
  useEffect(() => {
    if (open) {
      setName(editingCategory?.name ?? "");
      setDescription(editingCategory?.description ?? "");
      setImageUrl(editingCategory?.imageUrl ?? "");
      setComingSoon(Boolean(editingCategory?.comingSoon));
    } else {
      setName("");
      setDescription("");
      setImageUrl("");
      setComingSoon(false);
    }
  }, [open, editingCategory]);
  const utils = trpc.useUtils();
  const create = trpc.admin.menu.createCategory.useMutation({
    onSuccess: () => {
      toast.success("Category created");
      setName("");
      setDescription("");
      setImageUrl("");
      setComingSoon(false);
      onSaved();
      void utils.admin.menu.list.invalidate();
    },
    onError: e => {
      console.error("[createCategory]", e);
      toast.error(apiError(e));
    },
  });
  const update = trpc.admin.menu.updateCategory.useMutation({
    onMutate: async () => {
      await utils.admin.menu.list.cancel();
      const prev = utils.admin.menu.list.getData(undefined as any);
      return { prev };
    },
    onSuccess: () => {
      toast.success("Category updated");
      setName("");
      setDescription("");
      setImageUrl("");
      setComingSoon(false);
      onSaved();
    },
    onError: (e, _v, ctx) => {
      console.error("[updateCategory]", e);
      toast.error(apiError(e));
      if ((ctx as any)?.prev)
        utils.admin.menu.list.setData(
          undefined as any,
          (ctx as any).prev as any
        );
    },
    onSettled: () => {
      void utils.admin.menu.list.invalidate();
    },
  });
  const doUpload = trpc.admin.storage.uploadCategoryImage.useMutation({
    onSuccess: res => {
      if (!res?.url) {
        setUploadProgress(0);
        toast.error("Upload failed — no URL returned");
        return;
      }
      setImageUrl(res.url);
      setUploadProgress(100);
      toast.success("Category image uploaded — category-images bucket");
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
  const busy = create.isPending || update.isPending;
  const submit = () => {
    if (name.trim().length < 2) return toast.error("Name too short");
    if (description.trim().length > 500)
      return toast.error("Description too long (max 500)");
    if (imageUrl.trim()) {
      try {
        const u = new URL(imageUrl.trim());
        if (!["http:", "https:", "data:"].includes(u.protocol))
          throw new Error("bad");
      } catch (_e) {
        return toast.error(
          "Image URL is not valid — must be https://… or data:image/…"
        );
      }
    }
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      imageUrl: imageUrl.trim() || null,
      comingSoon,
    } as any;
    if (isEdit) {
      const c = editingCategory;
      if (!c?.id) return toast.error("No category selected");
      update.mutate({ id: c.id, ...payload });
    } else create.mutate(payload);
  };
  /*
   * The dialog resets itself to the record's stored values whenever it opens,
   * so comparing against those values is an exact dirty check rather than a
   * guess. It is what stops Escape from silently discarding a half-typed
   * category, including an in-flight image upload.
   */
  const isDirty =
    name !== (editingCategory?.name ?? "") ||
    description !== (editingCategory?.description ?? "") ||
    imageUrl !== (editingCategory?.imageUrl ?? "") ||
    comingSoon !== Boolean(editingCategory?.comingSoon);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title={isEdit ? "Edit category" : "New category"}
      description={`${
        isEdit
          ? `Update “${editingCategory?.name}”`
          : "Categories organise items."
      } Add a name, optional description, image and coming soon status.`}
      onSubmit={event => {
        event.preventDefault();
        submit();
      }}
      submitLabel={
        busy ? (isEdit ? "Saving…" : "Creating…") : isEdit ? "Save" : "Create"
      }
      submitPending={busy}
      isDirty={isDirty}
      formClassName="grid gap-4"
    >
      <FormField label="Name *">
        <Input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Cold Coffee"
          maxLength={100}
        />
      </FormField>
      <FormField label="Description">
        <Textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Chilled and creamy coffee beverages."
          maxLength={500}
          rows={3}
          className="bg-white"
        />
        <span className="text-[10px] text-[#8B7E71]">
          {description.length}/500
        </span>
      </FormField>
      <FormField label="Image">
        <div className="grid gap-3">
          <Input
            value={imageUrl}
            onChange={e => setImageUrl(e.target.value)}
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
                  5 MB max · category-images bucket
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
          {imageUrl ? (
            <div className="overflow-hidden rounded-xl border border-[#E4DCD1] bg-white shadow-sm">
              <img
                src={imageUrl}
                alt="Preview"
                className="h-36 w-full object-cover"
                onError={e =>
                  ((e.target as HTMLImageElement).style.display = "none")
                }
              />
              <div className="flex items-center justify-between gap-3 bg-[#FCFAF6] px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-[11px] text-[#5A4E45]">
                  {imageUrl}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-xs text-[#B83D29] hover:bg-[#FFF0EA]"
                  onClick={() => setImageUrl("")}
                >
                  Remove
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </FormField>
      <label className="flex items-center justify-between rounded-xl border border-[#E4DCD1] bg-[#F8F4EE] px-4 py-3">
        <div>
          <p className="text-sm font-bold">Coming Soon</p>
          <p className="text-[11px] text-[#827568]">
            Visible but blurred; ordering blocked server-side
          </p>
        </div>
        <Switch checked={comingSoon} onCheckedChange={setComingSoon} />
      </label>
    </FormDialog>
  );
}
