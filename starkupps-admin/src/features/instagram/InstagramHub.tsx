import { apiError } from "@/utils/errors";
/**
 * Admin > Instagram — content control for the storefront marquee section.
 *
 * Mirrors the structure of the other hubs (Content / Marketing): a header
 * block, then a primary card and a settings card. Everything is served by
 * `instagram.*` tRPC procedures, so permission checks and audit logging match
 * the rest of the panel.
 *
 * Reordering uses dnd-kit with optimistic local state; the new order is
 * persisted through `instagram.posts.reorder`, which writes every row inside a
 * single transaction so the storefront never sees a half-applied order.
 */
import { ConfirmDialog, FormDialog } from "@/components/shared/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  InstagramGlyph,
  PostThumb,
  TypeBadge,
} from "@/features/instagram/InstagramPreview";
import { cn } from "@/utils/cn";
import { trpc } from "@/api/trpc";
import {
  INSTAGRAM_LIMITS,
  isInstagramProfileUrl,
  parseInstagramUrl,
  sanitizeProfileHandle,
  type InstagramPost,
  type InstagramScrollSpeed,
} from "@shared/instagram";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  CircleAlert,
  ExternalLink,
  Film,
  GripVertical,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

// ── Settings form ────────────────────────────────────────────────────────
const settingsSchema = z.object({
  enabled: z.boolean(),
  eyebrow: z
    .string()
    .trim()
    .max(INSTAGRAM_LIMITS.eyebrow, "Keep it short.")
    .min(1, "Required"),
  heading: z
    .string()
    .trim()
    .max(INSTAGRAM_LIMITS.heading, "Keep it short.")
    .min(1, "Required"),
  subheading: z
    .string()
    .trim()
    .max(INSTAGRAM_LIMITS.subheading, "Keep it short."),
  profileHandle: z
    .string()
    .trim()
    .min(1, "Required")
    .refine(
      v => sanitizeProfileHandle(v).length > 0,
      "Letters, numbers, dots only."
    ),
  profileUrl: z
    .string()
    .trim()
    .refine(
      v => !v || isInstagramProfileUrl(v),
      "Must be an instagram.com link."
    ),
  followButtonLabel: z
    .string()
    .trim()
    .max(INSTAGRAM_LIMITS.followButtonLabel, "Keep it short.")
    .min(1, "Required"),
  scrollSpeed: z.enum(["slow", "normal", "fast"]),
  // Kept as a string so the number input round-trips cleanly through
  // react-hook-form; validated + converted on submit.
  maxItems: z
    .string()
    .trim()
    .regex(/^\d{1,2}$/, "Whole number only.")
    .refine(
      v =>
        Number(v) >= INSTAGRAM_LIMITS.minItems &&
        Number(v) <= INSTAGRAM_LIMITS.maxItems,
      `Between ${INSTAGRAM_LIMITS.minItems} and ${INSTAGRAM_LIMITS.maxItems}.`
    ),
  pauseOnHover: z.boolean(),
});
type SettingsForm = z.infer<typeof settingsSchema>;

const SETTINGS_DEFAULTS: SettingsForm = {
  enabled: true,
  eyebrow: "Follow along",
  heading: "Follow the froth",
  subheading: "",
  profileHandle: "starkupps",
  profileUrl: "https://www.instagram.com/starkupps/",
  followButtonLabel: "Follow",
  scrollSpeed: "normal",
  maxItems: String(INSTAGRAM_LIMITS.maxItems / 3),
  pauseOnHover: true,
};

export default function InstagramHub() {
  return (
    <>
      <section className="mb-6">
        <p className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#A83825]">
          <span className="h-px w-7 bg-[#E2533C]" />
          Instagram
        </p>
        <h2 className="text-3xl font-extrabold tracking-[-0.055em]">
          The feed the storefront scrolls.
        </h2>
        <p className="mt-2 text-sm leading-6 text-[#75695E]">
          Paste post and reel permalinks, set the order they appear in, and
          control the heading. Add an optional short MP4 teaser to a reel; the
          storefront previews it muted for 2.5 seconds and links to Instagram.
        </p>
      </section>

      <AddPostCard />

      <div className="mt-5">
        <PostListCard />
      </div>

      <div className="mt-5">
        <SettingsCard />
      </div>
    </>
  );
}

// ── Add post ─────────────────────────────────────────────────────────────
function AddPostCard() {
  const utils = trpc.useUtils();
  const posts = trpc.instagram.posts.list.useQuery();
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");

  // Live validation on every keystroke, using the same parser the server uses.
  const parsed = useMemo(() => parseInstagramUrl(url), [url]);
  const trimmed = url.trim().length > 0;
  const duplicate = useMemo(() => {
    if (!parsed.ok) return false;
    return (posts.data ?? []).some(p => p.shortcode === parsed.shortcode);
  }, [parsed, posts.data]);

  const create = trpc.instagram.posts.create.useMutation({
    onSuccess: result => {
      toast.success("Post added to the feed", {
        description:
          result.post.type === "reel"
            ? "Detected as a reel."
            : "Detected as a post.",
      });
      setUrl("");
      setCaption("");
      void utils.instagram.posts.list.invalidate();
    },
    onError: error =>
      toast.error("Post could not be added", { description: apiError(error) }),
  });

  const canSubmit = parsed.ok && !duplicate && !create.isPending;

  const submit = () => {
    if (!parsed.ok) {
      toast.error("Check that link", { description: parsed.error });
      return;
    }
    if (duplicate) {
      toast.error("Already in the feed", {
        description: "That permalink is already listed below.",
      });
      return;
    }
    create.mutate({
      url: parsed.url,
      caption: caption.trim() ? caption.trim() : null,
    });
  };

  return (
    <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5 shadow-[0_8px_20px_rgba(55,38,25,0.04)]">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-extrabold">Add a post</h3>
        {trimmed ? (
          parsed.ok ? (
            <TypeBadge type={parsed.type} />
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-[#E8B9AC] bg-[#FCE8E1] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-[#9A3627]">
              <CircleAlert className="h-2.5 w-2.5" />
              Invalid
            </span>
          )
        ) : null}
      </div>
      <p className="mt-1 text-xs text-[#827568]">
        Open a post or reel on Instagram, tap share, then paste the link here.
      </p>

      <div className="mt-4 grid gap-3">
        <div className="space-y-1.5">
          <label
            htmlFor="instagram-url"
            className="text-xs font-bold text-[#5A4E45]"
          >
            Instagram link
          </label>
          <Input
            id="instagram-url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="https://www.instagram.com/p/…"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={trimmed && !parsed.ok}
            aria-describedby="instagram-url-help"
            className="bg-white"
          />
          <p
            id="instagram-url-help"
            className={cn(
              "text-[11px]",
              trimmed && !parsed.ok
                ? "text-[#B83D29]"
                : duplicate
                  ? "text-[#8A5D10]"
                  : "text-[#827568]"
            )}
          >
            {duplicate
              ? "That permalink is already in the feed below."
              : trimmed && !parsed.ok
                ? parsed.error
                : parsed.ok
                  ? `Will be saved as ${parsed.type} · ${parsed.url}`
                  : "Posts (/p/), reels (/reel/) and IGTV (/tv/) are supported."}
          </p>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="instagram-caption"
            className="text-xs font-bold text-[#5A4E45]"
          >
            Note for the team (optional)
          </label>
          <Textarea
            id="instagram-caption"
            value={caption}
            onChange={e => setCaption(e.target.value)}
            maxLength={INSTAGRAM_LIMITS.caption}
            rows={2}
            placeholder="e.g. Winter menu launch — keep the pinned story too"
            className="bg-white"
          />
        </div>

        <div>
          <Button
            onClick={submit}
            disabled={!canSubmit}
            className="bg-[#211B18] text-xs text-white hover:bg-[#3A2D27]"
          >
            {create.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-1 h-4 w-4" />
            )}
            Add post
          </Button>
        </div>
      </div>
    </section>
  );
}

// ── Post list + reorder ──────────────────────────────────────────────────
function PostListCard() {
  const utils = trpc.useUtils();
  const posts = trpc.instagram.posts.list.useQuery();
  const [items, setItems] = useState<InstagramPost[]>([]);
  const [editing, setEditing] = useState<InstagramPost | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [removeId, setRemoveId] = useState<number | null>(null);

  // Mirror server order into local state; local state is then mutated
  // optimistically by drag-and-drop until the mutation settles.
  useEffect(() => {
    setItems(posts.data ?? []);
  }, [posts.data]);

  // Resolve poster frames in one batch. The gateway only reads Instagram's
  // redirect; the browser then loads the image straight from the CDN.
  const thumbs = trpc.instagram.thumbnails.useQuery(
    { shortcodes: items.map(p => p.shortcode) },
    { enabled: items.length > 0, staleTime: 30 * 60 * 1000 }
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const setActive = trpc.instagram.posts.setActive.useMutation({
    onSuccess: (_data, variables) => {
      setItems(prev =>
        prev.map(p =>
          p.id === variables.id ? { ...p, isActive: variables.isActive } : p
        )
      );
      void utils.instagram.posts.list.invalidate();
    },
    onError: error => {
      void utils.instagram.posts.list.invalidate();
      toast.error("Visibility was not changed", {
        description: apiError(error),
      });
    },
  });

  const reorder = trpc.instagram.posts.reorder.useMutation({
    onSuccess: () => {
      toast.success("Order saved");
      void utils.instagram.posts.list.invalidate();
    },
    onError: error => {
      setItems(posts.data ?? []);
      toast.error("New order was not saved", {
        description: apiError(error),
      });
    },
  });

  const remove = trpc.instagram.posts.remove.useMutation({
    onSuccess: () => {
      toast.success("Post removed");
      setRemoveId(null);
      void utils.instagram.posts.list.invalidate();
    },
    onError: error => {
      setRemoveId(null);
      toast.error("Post could not be removed", {
        description: apiError(error),
      });
    },
  });

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setPendingId(Number(active.id));
    const oldIndex = items.findIndex(p => p.id === active.id);
    const newIndex = items.findIndex(p => p.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(items, oldIndex, newIndex);
    setItems(next);
    reorder.mutate({ ids: next.map(p => p.id) });
  };

  const target = items.find(p => p.id === removeId) ?? null;
  const activeCount = items.filter(p => p.isActive).length;

  return (
    <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5 shadow-[0_8px_20px_rgba(55,38,25,0.04)]">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-extrabold">
          Feed order
          <span className="ml-2 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#8B7E71]">
            {activeCount} live / {items.length} total
          </span>
        </h3>
        <Button
          variant="outline"
          onClick={() => void posts.refetch()}
          className="h-8 border-[#DCCFC2] bg-white text-xs"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </Button>
      </div>

      {posts.isLoading ? (
        <div className="mt-4 space-y-2">
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-xl border border-[#E7DED4] bg-white p-3"
            >
              <Skeleton className="h-[60px] w-[48px] rounded-lg bg-[#F1EAE1]" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-32 bg-[#F1EAE1]" />
                <Skeleton className="h-3 w-52 bg-[#F1EAE1]" />
              </div>
            </div>
          ))}
        </div>
      ) : posts.isError ? (
        <div className="mt-4 rounded-xl border border-[#F1C9BD] bg-[#FFF8F5] p-4">
          <p className="flex items-center gap-2 text-xs font-bold text-[#6D3025]">
            <CircleAlert className="h-4 w-4" />
            Posts could not be loaded
          </p>
          <p className="mt-1 text-[11px] leading-5 text-[#8D5145]">
            {apiError(posts.error)}
          </p>
          <Button
            variant="outline"
            onClick={() => void posts.refetch()}
            className="mt-3 h-8 border-[#E8B9AC] bg-white text-xs text-[#8E392A] hover:bg-[#FFF2EE]"
          >
            Try again
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div className="mt-4 grid min-h-[180px] place-items-center rounded-xl border border-dashed border-[#D5C8BA] bg-white p-6 text-center">
          <div className="max-w-sm">
            <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-[#EEE7DE] text-[#8E8174]">
              <InstagramGlyph className="h-5 w-5" />
            </div>
            <p className="mt-4 text-sm font-extrabold">No posts yet</p>
            <p className="mt-1 text-xs text-[#827568]">
              Paste your first Instagram link above and it will appear on the
              storefront immediately.
            </p>
          </div>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={items.map(p => p.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="mt-4 space-y-2">
              {items.map(post => (
                <SortableRow
                  key={post.id}
                  post={post}
                  busy={pendingId === post.id || reorder.isPending}
                  onToggleActive={next =>
                    setActive.mutate({ id: post.id, isActive: next })
                  }
                  onRemove={() => setRemoveId(post.id)}
                  onEdit={() => setEditing(post)}
                  thumbSrc={thumbs.data?.[post.shortcode]}
                  thumbsLoading={thumbs.isFetching && !thumbs.data}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {reorder.isPending ? (
        <p className="mt-3 flex items-center gap-2 text-[11px] text-[#827568]">
          <Loader2 className="h-3 w-3 animate-spin" />
          Saving the new order…
        </p>
      ) : null}

      <EditPostDialog
        post={editing}
        open={Boolean(editing)}
        onOpenChange={open => {
          if (!open) setEditing(null);
        }}
        onSaved={() => setEditing(null)}
      />

      <ConfirmDialog
        open={Boolean(target)}
        onOpenChange={open => {
          if (!open) setRemoveId(null);
        }}
        title={`Remove this ${target?.type === "reel" ? "reel" : "post"}?`}
        description="It disappears from the storefront feed. You can add the same link again later."
        confirmLabel="Remove"
        cancelLabel="Keep it"
        destructive
        pending={remove.isPending}
        onConfirm={() => {
          if (target) remove.mutate({ id: target.id });
        }}
      />
    </section>
  );
}

/**
 * Icon-only row action. Every control in the cluster is the same size and gets
 * an explicit label, so the row stays compact but remains fully accessible.
 */
function RowAction({
  icon: Icon,
  label,
  onClick,
  tone = "neutral",
}: {
  icon: typeof ExternalLink;
  label: string;
  onClick: () => void;
  tone?: "neutral" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-lg border transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E2533C]",
        tone === "danger"
          ? "border-[#E8D9CF] bg-white text-[#B83D29] hover:bg-[#FFF2EE]"
          : "border-[#DCCFC2] bg-white text-[#5A4E45] hover:bg-[#F8F3ED]"
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}

function SortableRow({
  post,
  busy,
  onToggleActive,
  onRemove,
  onEdit,
  thumbSrc,
  thumbsLoading,
}: {
  post: InstagramPost;
  busy: boolean;
  onToggleActive: (next: boolean) => void;
  onRemove: () => void;
  onEdit: () => void;
  thumbSrc?: string | null;
  thumbsLoading: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: post.id });
  const kind = post.type === "reel" ? "reel" : "post";

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "rounded-xl border border-[#E7DED4] bg-white transition-shadow",
        isDragging && "z-10 shadow-[0_12px_28px_rgba(55,38,25,0.16)]",
        busy && "opacity-60",
        !post.isActive && "bg-[#FCFAF6]"
      )}
    >
      <div className="flex items-center gap-3 p-3">
        <button
          type="button"
          aria-label={`Reorder ${kind} ${post.shortcode}`}
          title="Drag to reorder"
          className="cursor-grab touch-none rounded-lg p-1 text-[#A99C8E] transition-colors hover:bg-[#F1EAE1] hover:text-[#5A4E45] active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E2533C]"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" aria-hidden />
        </button>

        {thumbsLoading ? (
          <span
            aria-hidden
            className="h-[60px] w-[48px] shrink-0 animate-pulse rounded-lg border border-[#E6DDD2] bg-[#F1EAE1]"
          />
        ) : (
          <PostThumb post={post} src={thumbSrc} />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold text-[#211B18]">
              {post.shortcode}
            </span>
            <TypeBadge type={post.type} />
          </div>
          {post.caption ? (
            <p className="mt-1 truncate text-[11px] text-[#5A4E45]">
              {post.caption}
            </p>
          ) : null}
          <a
            href={post.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 block truncate text-[11px] text-[#8B7E71] underline-offset-2 hover:text-[#A83825] hover:underline"
          >
            {post.url}
          </a>
        </div>

        {/* Visibility is a labelled control of its own, kept outside the action
            cluster so it never reads as one of the row's buttons. */}
        <label className="hidden w-[46px] shrink-0 flex-col items-center gap-1 sm:flex">
          <Switch
            checked={post.isActive}
            onCheckedChange={onToggleActive}
            aria-label={`Show ${kind} ${post.shortcode} on the storefront`}
          />
          <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-[#8F8275]">
            {post.isActive ? "Live" : "Off"}
          </span>
        </label>

        <div className="flex shrink-0 items-center gap-1.5 border-l border-[#EFE7DD] pl-3">
          <a
            href={post.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${kind} ${post.shortcode} on Instagram in a new tab`}
            title="Open on Instagram"
            className="grid size-8 shrink-0 place-items-center rounded-lg border border-[#DCCFC2] bg-white text-[#5A4E45] transition-colors hover:bg-[#F8F3ED] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E2533C]"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
          <RowAction
            icon={Pencil}
            label={`Edit ${kind} ${post.shortcode}`}
            onClick={onEdit}
          />
          <RowAction
            icon={Trash2}
            label={`Remove ${kind} ${post.shortcode}`}
            onClick={onRemove}
            tone="danger"
          />
        </div>
      </div>
    </li>
  );
}

/**
 * Edit an existing post: swap the permalink and/or edit the team note.
 *
 * Changing the URL re-runs the shared parser, so the same validation and
 * duplicate rules apply as on create — the server is the real gate, this just
 * gives immediate feedback.
 */
function EditPostDialog({
  post,
  open,
  onOpenChange,
  onSaved,
}: {
  post: InstagramPost | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const utils = trpc.useUtils();
  // The duplicate-permalink guard below reads `all.data`. This query used to be
  // `enabled: false`, so `all.data` was permanently undefined, `clash` was
  // permanently false, and a second post could be saved against a permalink that
  // already existed. The unique index on `instagram_posts.shortcode` would then
  // reject it with a raw database error. Enabling it costs nothing: React Query
  // dedupes by key, so this shares the in-flight request the list behind the
  // dialog already has.
  const all = trpc.instagram.posts.list.useQuery();
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);
  const previewVideoInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!post) return;
    setUrl(post.url);
    setCaption(post.caption ?? "");
    setPreviewVideoUrl(post.previewVideoUrl ?? null);
  }, [post]);

  const parsed = useMemo(() => parseInstagramUrl(url), [url]);
  const unchanged = post
    ? url.trim() === post.url &&
      caption.trim() === (post.caption ?? "") &&
      previewVideoUrl === (post.previewVideoUrl ?? null)
    : true;
  const clash =
    post && parsed.ok
      ? (all.data ?? []).some(
          p => p.shortcode === parsed.shortcode && p.id !== post.id
        )
      : false;

  const save = trpc.instagram.posts.update.useMutation({
    onSuccess: () => {
      toast.success("Post updated");
      void utils.instagram.posts.list.invalidate();
      // A swapped permalink has a different poster frame.
      void utils.instagram.thumbnails.invalidate();
      onSaved();
    },
    onError: error =>
      toast.error("Post could not be updated", {
        description: apiError(error),
      }),
  });

  const uploadVideo = trpc.instagram.uploadPreviewVideo.useMutation({
    onSuccess: result => {
      setPreviewVideoUrl(result.url);
      toast.success("Preview uploaded", {
        description: "Save changes to attach the teaser to this reel.",
      });
    },
    onError: error =>
      toast.error("Preview could not be uploaded", {
        description: apiError(error),
      }),
  });

  const onPreviewVideo = (file: File) => {
    if (file.type !== "video/mp4") {
      toast.error("Choose an MP4 video");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Preview video must be 5 MB or smaller");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const data = result.includes(",") ? result.split(",")[1] : result;
      if (!data) {
        toast.error("Could not read video file");
        return;
      }
      uploadVideo.mutate({
        filename: file.name,
        contentType: "video/mp4",
        data,
      });
    };
    reader.onerror = () => toast.error("Could not read video file");
    reader.readAsDataURL(file);
  };

  const submit = () => {
    if (!post) return;
    if (!parsed.ok) {
      toast.error("Check that link", { description: parsed.error });
      return;
    }
    if (clash) {
      toast.error("Already in the feed", {
        description: "Another post already uses that permalink.",
      });
      return;
    }
    save.mutate({
      id: post.id,
      url: parsed.url,
      caption: caption.trim() ? caption.trim() : null,
      previewVideoUrl,
    });
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title="Edit post"
      description={
        post ? (
          <>
            {post.type === "reel" ? "Reel" : "Post"} ·{" "}
            <span className="font-mono">{post.shortcode}</span>
          </>
        ) : (
          "Permalink, caption and reel preview."
        )
      }
      onSubmit={event => {
        event.preventDefault();
        submit();
      }}
      submitLabel={
        <>
          {save.isPending ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : null}
          Save changes
        </>
      }
      submitDisabled={!parsed.ok || clash || unchanged}
      submitPending={save.isPending || uploadVideo.isPending}
      isDirty={!unchanged}
      formClassName="grid gap-3"
    >
      <div className="space-y-1.5">
        <Label htmlFor="edit-ig-url">Instagram link</Label>
        <Input
          id="edit-ig-url"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://www.instagram.com/p/…"
          inputMode="url"
          spellCheck={false}
          aria-invalid={!!url.trim() && !parsed.ok}
          className="bg-white"
        />
        <p
          className={cn(
            "text-[11px]",
            url.trim() && !parsed.ok
              ? "text-[#B83D29]"
              : clash
                ? "text-[#8A5D10]"
                : "text-[#827568]"
          )}
        >
          {clash
            ? "Another post already uses that permalink."
            : url.trim() && !parsed.ok
              ? parsed.error
              : parsed.ok
                ? `Will be saved as ${parsed.type}`
                : "Posts (/p/), reels (/reel/) and IGTV (/tv/) are supported."}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-ig-caption">Note for the team</Label>
        <Textarea
          id="edit-ig-caption"
          value={caption}
          onChange={e => setCaption(e.target.value)}
          maxLength={INSTAGRAM_LIMITS.caption}
          rows={2}
          className="bg-white"
        />
      </div>

      {parsed.ok && parsed.type === "reel" ? (
        <div className="space-y-2 rounded-xl border border-[#E7DED4] bg-white p-3">
          <div>
            <p className="flex items-center gap-2 text-xs font-bold text-[#352A24]">
              <Film className="h-4 w-4 text-[#A83825]" />
              Short reel preview
            </p>
            <p className="mt-1 text-[11px] leading-5 text-[#827568]">
              Optional MP4, up to 5 MB. The storefront plays it muted for 2.5
              seconds, then opens the original Reel when tapped.
            </p>
          </div>
          <input
            ref={previewVideoInput}
            type="file"
            accept="video/mp4,.mp4"
            className="sr-only"
            onChange={event => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) onPreviewVideo(file);
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={uploadVideo.isPending}
              onClick={() => previewVideoInput.current?.click()}
              className="h-8 border-[#DCCFC2] bg-white text-xs"
            >
              {uploadVideo.isPending ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="mr-1 h-3.5 w-3.5" />
              )}
              {previewVideoUrl ? "Replace preview" : "Upload preview clip"}
            </Button>
            {previewVideoUrl ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setPreviewVideoUrl(null)}
                className="h-8 px-2 text-xs text-[#8D5145]"
              >
                <X className="mr-1 h-3.5 w-3.5" />
                Remove
              </Button>
            ) : null}
          </div>
          {previewVideoUrl ? (
            <video
              src={previewVideoUrl}
              controls
              muted
              playsInline
              preload="metadata"
              className="max-h-48 w-full rounded-lg bg-black object-contain"
            />
          ) : null}
        </div>
      ) : null}
    </FormDialog>
  );
}

// ── Settings ─────────────────────────────────────────────────────────────
function SettingsCard() {
  const utils = trpc.useUtils();
  const settings = trpc.instagram.settings.get.useQuery();
  const hydrated = useRef(false);

  const form = useForm<SettingsForm>({
    resolver: zodResolver(settingsSchema),
    defaultValues: SETTINGS_DEFAULTS,
    mode: "onBlur",
  });

  const { control, handleSubmit, reset, watch, setValue } = form;
  const enabled = watch("enabled");

  // Reset the form once the server row arrives, then never again — otherwise
  // every background refetch would clobber in-progress edits.
  useEffect(() => {
    if (hydrated.current) return;
    if (settings.isLoading) return;
    hydrated.current = true;
    const s = settings.data;
    if (s) {
      reset({
        enabled: s.enabled,
        eyebrow: s.eyebrow,
        heading: s.heading,
        subheading: s.subheading ?? "",
        profileHandle: s.profileHandle,
        profileUrl: s.profileUrl,
        followButtonLabel: s.followButtonLabel,
        scrollSpeed: s.scrollSpeed,
        maxItems: String(s.maxItems),
        pauseOnHover: s.pauseOnHover,
      });
    } else {
      reset(SETTINGS_DEFAULTS);
    }
  }, [settings.data, settings.isLoading, reset]);

  const save = trpc.instagram.settings.update.useMutation({
    onSuccess: () => {
      toast.success("Section settings saved");
      void utils.instagram.settings.get.invalidate();
    },
    onError: error =>
      toast.error("Settings were not saved", { description: apiError(error) }),
  });

  const onSubmit = handleSubmit(values => {
    save.mutate({
      enabled: values.enabled,
      eyebrow: values.eyebrow,
      heading: values.heading,
      subheading: values.subheading.trim() ? values.subheading.trim() : null,
      profileHandle: sanitizeProfileHandle(values.profileHandle),
      profileUrl: values.profileUrl.trim() ? values.profileUrl.trim() : null,
      followButtonLabel: values.followButtonLabel,
      scrollSpeed: values.scrollSpeed as InstagramScrollSpeed,
      maxItems: Number(values.maxItems),
      pauseOnHover: values.pauseOnHover,
    });
  });

  // Never render `SETTINGS_DEFAULTS` as though it were the live configuration.
  // Without this guard the form showed a plausible-looking profile handle and
  // heading for as long as the request took, and an owner could save the
  // defaults over their real values without noticing.
  if (settings.isLoading) {
    return (
      <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5">
        <div className="space-y-3">
          <div className="h-4 w-40 animate-pulse rounded bg-[#EDE6DC]" />
          <div className="h-9 w-full animate-pulse rounded bg-[#EDE6DC]" />
          <div className="h-9 w-full animate-pulse rounded bg-[#EDE6DC]" />
        </div>
      </section>
    );
  }

  if (settings.isError) {
    return (
      <section className="rounded-[14px] border border-[#F1C9BD] bg-[#FFF8F5] p-5">
        <p className="flex items-center gap-2 text-sm font-extrabold text-[#6D3025]">
          <CircleAlert className="h-4 w-4" />
          Settings could not be loaded
        </p>
        <p className="mt-1 text-xs leading-5 text-[#8D5145]">
          {apiError(settings.error)}
        </p>
        <Button
          variant="outline"
          onClick={() => void settings.refetch()}
          className="mt-3 h-8 border-[#E8B9AC] bg-white text-xs text-[#8E392A] hover:bg-[#FFF2EE]"
        >
          Try again
        </Button>
      </section>
    );
  }

  return (
    <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5 shadow-[0_8px_20px_rgba(55,38,25,0.04)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-extrabold">Section settings</h3>
          <p className="mt-1 text-xs text-[#827568]">
            Turn the whole section off without deleting any posts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            className={
              enabled
                ? "border-[#BDE0C8] bg-[#E5F2E9] text-[#2F6947]"
                : "border-[#E6DDD2] bg-[#F1EAE1] text-[#827568]"
            }
          >
            {enabled ? "Live on site" : "Hidden"}
          </Badge>
          <Switch
            checked={enabled}
            onCheckedChange={next =>
              setValue("enabled", next, { shouldDirty: true })
            }
            aria-label="Show the Instagram section on the storefront"
          />
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={onSubmit} className="mt-5 grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={control}
              name="eyebrow"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Eyebrow</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      maxLength={INSTAGRAM_LIMITS.eyebrow}
                      className="bg-white"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name="heading"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Heading</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      maxLength={INSTAGRAM_LIMITS.heading}
                      className="bg-white"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={control}
            name="subheading"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Subheading</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    rows={2}
                    maxLength={INSTAGRAM_LIMITS.subheading}
                    className="bg-white"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={control}
              name="profileHandle"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Username</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="starkupps"
                      className="bg-white"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name="profileUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Profile link</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="https://www.instagram.com/starkupps/"
                      className="bg-white"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <FormField
              control={control}
              name="followButtonLabel"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Button label</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      maxLength={INSTAGRAM_LIMITS.followButtonLabel}
                      className="bg-white"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name="scrollSpeed"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Scroll speed</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="bg-white">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="slow">Slow</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="fast">Fast</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name="maxItems"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Maximum posts</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="number"
                      inputMode="numeric"
                      min={INSTAGRAM_LIMITS.minItems}
                      max={INSTAGRAM_LIMITS.maxItems}
                      className="bg-white"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="flex items-center justify-between rounded-xl border border-[#E6DDD2] bg-[#F7F2EB] p-4">
            <div className="pr-4">
              <p className="text-xs font-extrabold">Pause while hovering</p>
              <p className="mt-1 text-[11px] text-[#83766A]">
                The row stops scrolling as soon as a visitor points at it, so a
                reel can be watched.
              </p>
            </div>
            <FormField
              control={control}
              name="pauseOnHover"
              render={({ field }) => (
                <FormItem className="shrink-0">
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      aria-label="Pause the marquee while hovering"
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="submit"
              disabled={save.isPending}
              className="bg-[#211B18] text-xs text-white hover:bg-[#3A2D27]"
            >
              {save.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : null}
              Save settings
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                hydrated.current = true;
                reset(
                  settings.data
                    ? {
                        enabled: settings.data.enabled,
                        eyebrow: settings.data.eyebrow,
                        heading: settings.data.heading,
                        subheading: settings.data.subheading ?? "",
                        profileHandle: settings.data.profileHandle,
                        profileUrl: settings.data.profileUrl,
                        followButtonLabel: settings.data.followButtonLabel,
                        scrollSpeed: settings.data.scrollSpeed,
                        maxItems: String(settings.data.maxItems),
                        pauseOnHover: settings.data.pauseOnHover,
                      }
                    : SETTINGS_DEFAULTS
                );
              }}
              className="border-[#DCCFC2] bg-white text-xs"
            >
              Discard changes
            </Button>
          </div>
        </form>
      </Form>
    </section>
  );
}
