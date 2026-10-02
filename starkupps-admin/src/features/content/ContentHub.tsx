import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/api/trpc";
import { Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function ContentHub() {
  const [tab, setTab] = useState<"blocks" | "faqs" | "testimonials">("blocks");
  return (
    <>
      <section className="mb-6">
        <p className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#A83825]">
          <span className="h-px w-7 bg-[#E2533C]" />
          Content
        </p>
        <h2 className="text-3xl font-extrabold tracking-[-0.055em]">
          Customer-facing content, without deploying code.
        </h2>
        <p className="mt-2 text-sm leading-6 text-[#75695E]">
          Homepage hero, featured products, banners, FAQs, testimonials, outlet
          locations — draft/published/scheduled/archived.
        </p>
        <div className="mt-4 flex gap-1 rounded-xl border border-[#E4DCD1] bg-[#EEE9E1] p-1 w-fit">
          {(["blocks", "faqs", "testimonials"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold capitalize ${tab === t ? "bg-white shadow-sm" : "text-[#766A5F]"}`}
            >
              {t}
            </button>
          ))}
        </div>
      </section>
      {tab === "blocks" && <BlocksTab />}
      {tab === "faqs" && <FaqsTab />}
      {tab === "testimonials" && <TestimonialsTab />}
    </>
  );
}

function BlocksTab() {
  const q = trpc.content.blocks.list.useQuery({});
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    page: "homepage",
    key: "hero_heading",
    title: "",
    description: "",
    imageUrl: "",
    status: "draft" as any,
  });
  const create = trpc.content.blocks.create.useMutation({
    onSuccess: () => {
      toast.success("Content saved");
      setOpen(false);
      void q.refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-extrabold">
          Content blocks — lightweight CMS
        </h3>
        <Button
          onClick={() => setOpen(true)}
          className="bg-[#211B18] text-xs text-white"
        >
          <Plus className="mr-1 h-3 w-3" />
          Add block
        </Button>
      </div>
      {q.isLoading ? (
        <div className="grid place-items-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
        </div>
      ) : q.isError ? (
        <p className="mt-4 text-center text-xs text-[#B83D29]">
          Content blocks could not be loaded.{" "}
          <button className="underline" onClick={() => q.refetch()}>
            Retry
          </button>
        </p>
      ) : !q.data?.length ? (
        <p className="mt-4 text-center text-xs text-[#827568]">
          No content yet. Add hero heading, description, image, CTA, featured
          sections.
        </p>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {q.data.map((b: any) => (
            <article key={b.id} className="rounded-xl border bg-white p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#A83825]">
                {b.page} · {b.key}
              </p>
              <p className="mt-1 text-sm font-bold">{b.title ?? "—"}</p>
              <p className="text-xs text-[#776A5E] line-clamp-2">
                {b.description ?? ""}
              </p>
              <div className="mt-2 flex gap-2">
                <Badge
                  className={
                    b.status === "published"
                      ? "bg-[#E5F2E9] text-[#2F6947]"
                      : b.status === "draft"
                        ? "bg-[#F6F0E8]"
                        : "bg-[#FBF0D5] text-[#8A5D10]"
                  }
                >
                  {b.status}
                </Badge>
                <span className="text-[11px] text-[#87796C]">
                  Pos {b.position}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-[#FCFAF6]">
          <DialogHeader>
            <DialogTitle>New content block</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="space-y-1">
              <span className="text-xs font-bold">Page</span>
              <Input
                value={form.page}
                onChange={e => setForm({ ...form, page: e.target.value })}
                className="bg-white"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-bold">Key</span>
              <Input
                value={form.key}
                onChange={e => setForm({ ...form, key: e.target.value })}
                placeholder="hero_heading"
                className="bg-white"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-bold">Title</span>
              <Input
                value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })}
                className="bg-white"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-bold">Description</span>
              <Textarea
                value={form.description}
                onChange={e =>
                  setForm({ ...form, description: e.target.value })
                }
                className="bg-white"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-bold">Status</span>
              <Select
                value={form.status}
                onValueChange={v => setForm({ ...form, status: v as any })}
              >
                <SelectTrigger className="bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                  <SelectItem value="scheduled">Scheduled</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!form.key.trim() || !form.page.trim())
                  return toast.error("Page & key required");
                create.mutate({
                  page: form.page.trim(),
                  key: form.key.trim(),
                  title: form.title.trim() || null,
                  description: form.description.trim() || null,
                  imageUrl: form.imageUrl.trim() || null,
                  ctaLabel: null,
                  ctaLink: null,
                  position: 0,
                  status: form.status,
                  publishAt: null,
                });
              }}
              disabled={create.isPending}
              className="bg-[#211B18] text-white"
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function FaqsTab() {
  const q = trpc.content.faqs.list.useQuery();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ question: "", answer: "" });
  const [toggleId, setToggleId] = useState<number | null>(null);
  const create = trpc.content.faqs.create.useMutation({
    onSuccess: () => {
      toast.success("FAQ saved");
      setOpen(false);
      void q.refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });

  // `update` requires question + answer, so the current values are resent
  // alongside the new flag rather than the server being widened.
  const toggle = trpc.content.faqs.update.useMutation({
    onSuccess: () => {
      setToggleId(null);
      void utils.content.faqs.list.invalidate();
    },
    onError: (e: any) => {
      setToggleId(null);
      toast.error("Visibility was not changed", {
        description: e?.message ?? "Please try again.",
      });
    },
  });

  const toggleActive = (faq: any, next: boolean) => {
    setToggleId(faq.id);
    toggle.mutate({
      id: faq.id,
      question: faq.question,
      answer: faq.answer,
      active: next,
    });
  };

  return (
    <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-extrabold">FAQs</h3>
        <Button
          onClick={() => setOpen(true)}
          className="bg-[#211B18] text-xs text-white"
        >
          <Plus className="mr-1 h-3 w-3" />
          Add FAQ
        </Button>
      </div>
      {q.isLoading ? (
        <div className="grid place-items-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
        </div>
      ) : q.isError ? (
        <p className="mt-4 text-center text-xs text-[#B83D29]">
          FAQs could not be loaded.{" "}
          <button className="underline" onClick={() => q.refetch()}>
            Retry
          </button>
        </p>
      ) : !q.data?.length ? (
        <p className="mt-4 text-center text-xs text-[#827568]">No FAQs.</p>
      ) : (
        <div className="mt-4 space-y-2">
          {q.data.map((f: any) => (
            <div
              key={f.id}
              className={`rounded-xl border p-4 ${
                f.active
                  ? "border-[#D6CABD] bg-white"
                  : "border-[#E3D9CE] bg-[#F7F2EB]"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <p
                  className={`text-sm font-bold ${f.active ? "text-[#211B18]" : "text-[#6F6257]"}`}
                >
                  {f.question}
                </p>
                {/* Explicit colors on both variants. The shared Badge default is a
                    translucent primary fill whose text disappears against the
                    light row background, so status was unreadable. */}
                <span
                  className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] ${
                    f.active
                      ? "border-[#BDE0C8] bg-[#E5F2E9] text-[#2F6947]"
                      : "border-[#E3D9CE] bg-[#EFE8DF] text-[#6B5F53]"
                  }`}
                >
                  {f.active ? "Live" : "Hidden"}
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-5 text-[#6F6257] line-clamp-3">
                {f.answer}
              </p>
              <label className="mt-3 flex w-fit items-center gap-2 text-[11px] font-bold text-[#5A4E45]">
                <Switch
                  checked={Boolean(f.active)}
                  disabled={toggle.isPending && toggleId === f.id}
                  onCheckedChange={next => toggleActive(f, next)}
                  className="data-[state=checked]:bg-[#2F6947]"
                  aria-label={`Show "${f.question}" on the storefront`}
                />
                {f.active ? "Shown on storefront" : "Hidden from storefront"}
              </label>
            </div>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-[#FCFAF6]">
          <DialogHeader>
            <DialogTitle>New FAQ</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="space-y-1">
              <span className="text-xs font-bold">Question</span>
              <Input
                value={form.question}
                onChange={e => setForm({ ...form, question: e.target.value })}
                className="bg-white"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-bold">Answer</span>
              <Textarea
                value={form.answer}
                onChange={e => setForm({ ...form, answer: e.target.value })}
                className="bg-white"
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!form.question.trim() || !form.answer.trim())
                  return toast.error("Fill fields");
                create.mutate({
                  question: form.question.trim(),
                  answer: form.answer.trim(),
                  position: 0,
                  active: true,
                });
              }}
              disabled={create.isPending}
              className="bg-[#211B18] text-white"
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function TestimonialsTab() {
  const q = trpc.content.testimonials.list.useQuery();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    authorName: "",
    content: "",
    rating: "5",
  });
  const create = trpc.content.testimonials.create.useMutation({
    onSuccess: () => {
      toast.success("Testimonial saved");
      setOpen(false);
      void q.refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-extrabold">Testimonials</h3>
        <Button
          onClick={() => setOpen(true)}
          className="bg-[#211B18] text-xs text-white"
        >
          <Plus className="mr-1 h-3 w-3" />
          Add
        </Button>
      </div>
      {q.isLoading ? (
        <div className="grid place-items-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
        </div>
      ) : q.isError ? (
        <p className="mt-4 text-center text-xs text-[#B83D29]">
          Testimonials could not be loaded.{" "}
          <button className="underline" onClick={() => q.refetch()}>
            Retry
          </button>
        </p>
      ) : !q.data?.length ? (
        <p className="mt-4 text-center text-xs text-[#827568]">
          No testimonials.
        </p>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {q.data.map((t: any) => (
            <article key={t.id} className="rounded-xl border bg-white p-4">
              <p className="text-sm font-bold">
                {t.authorName} · ⭐{t.rating}
              </p>
              <p className="text-xs text-[#6F6257]">{t.content}</p>
            </article>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-[#FCFAF6]">
          <DialogHeader>
            <DialogTitle>New testimonial</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="space-y-1">
              <span className="text-xs font-bold">Author</span>
              <Input
                value={form.authorName}
                onChange={e => setForm({ ...form, authorName: e.target.value })}
                className="bg-white"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-bold">Content</span>
              <Textarea
                value={form.content}
                onChange={e => setForm({ ...form, content: e.target.value })}
                className="bg-white"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-bold">Rating</span>
              <Input
                type="number"
                min={1}
                max={5}
                value={form.rating}
                onChange={e => setForm({ ...form, rating: e.target.value })}
                className="bg-white"
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!form.authorName.trim() || !form.content.trim())
                  return toast.error("Fill fields");
                create.mutate({
                  authorName: form.authorName.trim(),
                  authorRole: null,
                  content: form.content.trim(),
                  rating: Number(form.rating),
                  active: true,
                });
              }}
              disabled={create.isPending}
              className="bg-[#211B18] text-white"
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
