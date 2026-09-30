import { inr } from "@/utils/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/api/trpc";
import {
  Building2,
  Clock3,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { nanoid } from "nanoid";
import { IndiaStateCitySelect } from "@/components/shared/IndiaStateCitySelect";
import { LocationPicker } from "@/components/shared/LocationPicker";

const days = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export default function OutletsHub({ detailId }: { detailId?: number }) {
  const [, setLocation] = useLocation();
  if (detailId)
    return (
      <OutletDetail id={detailId} onBack={() => setLocation("/outlets")} />
    );
  return <OutletList onSelect={id => setLocation(`/outlets/${id}`)} />;
}

function OutletList({ onSelect }: { onSelect: (id: number) => void }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [cursor, setCursor] = useState<number | undefined>();
  const [history, setHistory] = useState<Array<number | undefined>>([]);
  useEffect(() => {
    setCursor(undefined);
    setHistory([]);
  }, [search, status]);
  const q = trpc.outlets.list.useQuery({
    search: search.trim() || undefined,
    status: (status as any) || undefined,
    limit: 50,
    cursor,
  });
  return (
    <>
      <section className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#A83825]">
            <span className="h-px w-7 bg-[#E2533C]" />
            All outlets
          </p>
          <h2 className="text-3xl font-extrabold tracking-[-0.055em] md:text-[38px]">
            Every room, one control plane.
          </h2>
          <p className="mt-3 max-w-2xl text-sm font-medium leading-6 text-[#75695E]">
            Create and operate outlets with outlet-scoped inventory, orders,
            staff, and delivery coverage — no duplication of master catalogue
            records.
          </p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          className="bg-[#211B18] text-xs font-bold text-white hover:bg-[#3A2D27]"
        >
          <Plus className="mr-1 h-4 w-4" />
          Add outlet
        </Button>
      </section>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[#8E8174]" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search outlet, code, city"
            className="h-10 border-[#DCCFC2] bg-[#FCFAF6] pl-9 text-xs"
          />
        </div>
        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="h-10 rounded-md border border-[#DCCFC2] bg-white px-3 text-xs"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="temporarily_closed">Temporarily closed</option>
          <option value="maintenance">Maintenance</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>
      {q.isLoading ? (
        <div className="grid min-h-[240px] place-items-center">
          <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
        </div>
      ) : q.isError ? (
        <div className="rounded-[14px] border border-[#F1C9BD] bg-[#FFF8F5] p-5 text-sm text-[#8D5145]">
          {String((q.error as any)?.message ?? "Unable to load outlets.")}{" "}
          <Button
            onClick={() => q.refetch()}
            variant="outline"
            className="ml-2 h-7 text-xs"
          >
            Retry
          </Button>
        </div>
      ) : !q.data?.items.length ? (
        <div className="grid min-h-[240px] place-items-center rounded-[14px] border border-dashed border-[#D5C8BA] bg-[#FCFAF6] p-6 text-center">
          <div>
            <Building2 className="mx-auto h-8 w-8 text-[#A39486]" />
            <h3 className="mt-3 text-sm font-extrabold">
              No outlets have been created yet.
            </h3>
            <p className="mt-2 text-xs leading-5 text-[#827568]">
              Add your first outlet to scope orders, inventory, POS, and
              delivery. Aggregations will use real persisted records.
            </p>
            <Button
              onClick={() => setCreateOpen(true)}
              className="mt-4 bg-[#E2533C] text-xs text-white"
            >
              Add outlet
            </Button>
          </div>
        </div>
      ) : (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {q.data.items.map((o: any) => (
            <article
              key={o.id}
              onClick={() => onSelect(o.id)}
              className="cursor-pointer rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5 shadow-[0_5px_15px_rgba(55,38,25,0.04)] hover:bg-white"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-extrabold">{o.name}</h3>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[#A83825]">
                    {o.code} · {o.city || "No city"}
                  </p>
                </div>
                <Badge
                  className={
                    o.status === "active"
                      ? "border-[#BDE0C8] bg-[#E5F2E9] text-[#2F6947]"
                      : "border-[#E3D9CE] bg-[#F6F0E8] text-[#706356]"
                  }
                >
                  {o.status}
                </Badge>
              </div>
              <p className="mt-3 flex items-center gap-1 text-xs text-[#75695E]">
                <MapPin className="h-3.5 w-3.5" />
                {o.address || "No address"} · {o.pincode || ""}
              </p>
              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-[#E7DED4] pt-3">
                <span className="text-center">
                  <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#87796C]">
                    Today
                  </p>
                  <p className="text-xs font-bold">{inr(o.todayRevenue)}</p>
                </span>
                <span className="text-center">
                  <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#87796C]">
                    Staff
                  </p>
                  <p className="text-xs font-bold">{o.staffCount}</p>
                </span>
                <span className="text-center">
                  <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#87796C]">
                    Riders
                  </p>
                  <p className="text-xs font-bold">{o.riderCount}</p>
                </span>
              </div>
            </article>
          ))}
        </section>
      )}
      {(q.data?.nextCursor !== undefined || history.length > 0) && (
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="outline"
            className="h-9 text-xs"
            disabled={!history.length}
            onClick={() => {
              const prev = history.at(-1);
              setHistory(h => h.slice(0, -1));
              setCursor(prev);
            }}
          >
            Newer
          </Button>
          <Button
            variant="outline"
            className="h-9 text-xs"
            disabled={!q.data?.nextCursor}
            onClick={() => {
              if (q.data?.nextCursor) {
                setHistory(h => [...h, cursor]);
                setCursor(q.data.nextCursor);
              }
            }}
          >
            Older
          </Button>
        </div>
      )}
      <OutletCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

function generateOutletCode() {
  return `SK-${nanoid(6).toUpperCase()}`;
}

function OutletCreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [, setLocation] = useLocation();
  const [form, setForm] = useState({
    code: "",
    name: "",
    ownerId: null as number | null,
    status: "active" as "active" | "inactive",
    address: "",
    city: "",
    state: "",
    pincode: "",
    latitude: null as number | null,
    longitude: null as number | null,
    phone: "",
    email: "",
    deliveryEnabled: true,
    staffIds: [] as number[],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [staffSearch, setStaffSearch] = useState("");
  const utils = trpc.useUtils();
  // Eligible staff for owner / appointed — active staff only, owner can read staff
  const staffQ = trpc.staff.list.useQuery(
    { limit: 100, status: "active" as any },
    { enabled: open }
  );
  const eligibleStaff: any[] =
    (staffQ.data as any)?.items ?? (staffQ.data as any) ?? [];
  const filteredStaff = eligibleStaff.filter((s: any) => {
    if (!staffSearch.trim()) return true;
    const q = staffSearch.toLowerCase();
    return (
      String(s.name).toLowerCase().includes(q) ||
      String(s.email).toLowerCase().includes(q) ||
      String(s.role).toLowerCase().includes(q)
    );
  });

  const create = trpc.outlets.create.useMutation({
    onSuccess: r => {
      toast.success("Outlet created");
      void utils.outlets.list.invalidate();
      onOpenChange(false);
      setForm({
        code: generateOutletCode(),
        name: "",
        ownerId: null,
        status: "active" as any,
        address: "",
        city: "",
        state: "",
        pincode: "",
        latitude: null,
        longitude: null,
        phone: "",
        email: "",
        deliveryEnabled: true,
        staffIds: [],
      });
      setErrors({});
      setStaffSearch("");
      setLocation(`/outlets/${r.id}`);
    },
    onError: e => toast.error(e.message || "Could not create outlet"),
  });

  useEffect(() => {
    if (open) setForm(f => ({ ...f, code: generateOutletCode() }));
  }, [open]);

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    const name = form.name.trim();
    if (!name) e.name = "Outlet name is required";
    else if (name.length < 2) e.name = "Name must be at least 2 characters";
    else if (name.length > 160) e.name = "Name must be ≤160 characters";
    if (!form.address.trim()) e.address = "Address is required";
    else if (form.address.trim().length < 5)
      e.address = "Address must be at least 5 characters";
    if (!form.state.trim()) e.state = "State is required";
    if (!form.city.trim()) e.city = "City is required";
    if (
      form.email.trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())
    )
      e.email = "Invalid email address";
    if (form.phone.trim() && form.phone.trim().length > 32)
      e.phone = "Phone must be ≤32 characters";
    if (form.pincode.trim() && !/^\d{4,12}$/.test(form.pincode.trim()))
      e.pincode = "Pincode must be 4–12 digits";
    if (
      form.latitude != null &&
      (isNaN(form.latitude) || form.latitude < -90 || form.latitude > 90)
    )
      e.latitude = "Latitude must be between -90 and 90";
    if (
      form.longitude != null &&
      (isNaN(form.longitude) || form.longitude < -180 || form.longitude > 180)
    )
      e.longitude = "Longitude must be between -180 and 180";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = () => {
    if (!validate()) return toast.error("Please fix the highlighted fields");
    const code = form.code.trim() || generateOutletCode();
    create.mutate({
      code,
      name: form.name.trim(),
      ownerId: form.ownerId,
      status: form.status,
      address: form.address.trim(),
      state: form.state.trim(),
      city: form.city.trim(),
      pincode: form.pincode.trim() || null,
      latitude: form.latitude,
      longitude: form.longitude,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      deliveryEnabled: form.deliveryEnabled,
      staffIds: form.staffIds,
    } as any);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden bg-[#FCFAF6] p-0 sm:max-w-2xl gap-0">
        <DialogHeader className="sticky top-0 z-10 shrink-0 border-b border-[#E4DCD1] bg-[#FCFAF6] px-6 py-4">
          <DialogTitle className="text-[15px]">Add outlet</DialogTitle>
          <DialogDescription className="text-xs">
            Establish the branch — essential info only. Operational settings are
            configured after creation.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {/* Basic Information */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="h-px flex-1 bg-[#E4DCD1]" />
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[#A83825]">
                Basic Information
              </span>
              <span className="h-px flex-1 bg-[#E4DCD1]" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 sm:col-span-2">
                <span className="text-xs font-bold">Outlet name *</span>
                <Input
                  value={form.name}
                  onChange={e => {
                    const v = e.target.value;
                    setForm(f => ({ ...f, name: v }));
                    if (errors.name) setErrors(prev => ({ ...prev, name: "" }));
                  }}
                  placeholder="StarKupps Koramangala"
                  className={`bg-white h-10 ${errors.name ? "border-red-400" : ""}`}
                />
                {errors.name && (
                  <p className="text-[11px] text-red-600">{errors.name}</p>
                )}
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-bold">
                  Outlet code{" "}
                  <span className="font-normal text-[#87796C]">(auto)</span>
                </span>
                <div className="flex gap-2">
                  <Input
                    value={form.code}
                    readOnly
                    placeholder="SK-XXXXXX"
                    className="bg-[#F6F0E8] font-mono text-xs tracking-widest h-10"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 shrink-0"
                    onClick={() =>
                      setForm(f => ({ ...f, code: generateOutletCode() }))
                    }
                    title="Regenerate code"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-bold">
                  Owner / Outlet Manager
                </span>
                <Select
                  value={form.ownerId ? String(form.ownerId) : "__none__"}
                  onValueChange={v =>
                    setForm(f => ({
                      ...f,
                      ownerId: v === "__none__" ? null : Number(v),
                    }))
                  }
                >
                  <SelectTrigger className="bg-white text-xs h-10">
                    <SelectValue placeholder="Select owner (optional)" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="__none__">— No owner —</SelectItem>
                    {staffQ.isLoading ? (
                      <div className="p-3 text-xs text-[#87796C]">
                        Loading staff…
                      </div>
                    ) : (
                      eligibleStaff.map((s: any) => (
                        <SelectItem key={s.id} value={String(s.id)}>
                          {s.name} — {s.role} · {s.email}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-[#87796C]">
                  Select from existing active staff.
                </p>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-bold">Status</span>
                <Select
                  value={form.status}
                  onValueChange={(v: any) =>
                    setForm(f => ({ ...f, status: v }))
                  }
                >
                  <SelectTrigger className="bg-white h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            </div>
          </div>

          {/* Location */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="h-px flex-1 bg-[#E4DCD1]" />
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[#A83825]">
                Location
              </span>
              <span className="h-px flex-1 bg-[#E4DCD1]" />
            </div>
            <label className="space-y-1.5">
              <span className="text-xs font-bold">Address *</span>
              <Textarea
                value={form.address}
                onChange={e => {
                  const v = e.target.value;
                  setForm(f => ({ ...f, address: v }));
                  if (errors.address)
                    setErrors(prev => ({ ...prev, address: "" }));
                }}
                placeholder="123, MG Road, Koramangala"
                className={`bg-white min-h-[80px] ${errors.address ? "border-red-400" : ""}`}
              />
              {errors.address && (
                <p className="text-[11px] text-red-600">{errors.address}</p>
              )}
            </label>
            <IndiaStateCitySelect
              stateValue={form.state}
              cityValue={form.city}
              onStateChange={v => {
                setForm(f => ({ ...f, state: v }));
                if (errors.state || errors.city)
                  setErrors(prev => ({ ...prev, state: "", city: "" }));
              }}
              onCityChange={v => {
                setForm(f => ({ ...f, city: v }));
                if (errors.city) setErrors(prev => ({ ...prev, city: "" }));
              }}
            />
            {(errors.state || errors.city) && (
              <p className="text-[11px] text-red-600">
                {errors.state || errors.city}
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-bold">Pincode</span>
                <Input
                  value={form.pincode}
                  onChange={e => {
                    const v = e.target.value;
                    setForm(f => ({ ...f, pincode: v }));
                    if (errors.pincode)
                      setErrors(prev => ({ ...prev, pincode: "" }));
                  }}
                  placeholder="560034"
                  className={`bg-white h-10 ${errors.pincode ? "border-red-400" : ""}`}
                />
                {errors.pincode && (
                  <p className="text-[11px] text-red-600">{errors.pincode}</p>
                )}
              </label>
            </div>
            <LocationPicker
              latitude={form.latitude}
              longitude={form.longitude}
              onChange={(lat, lng) =>
                setForm(f => ({ ...f, latitude: lat, longitude: lng }))
              }
            />
            {(errors.latitude || errors.longitude) && (
              <p className="text-[11px] text-red-600">
                {errors.latitude || errors.longitude}
              </p>
            )}
          </div>

          {/* Contact */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="h-px flex-1 bg-[#E4DCD1]" />
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[#A83825]">
                Contact
              </span>
              <span className="h-px flex-1 bg-[#E4DCD1]" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-bold">Phone</span>
                <Input
                  value={form.phone}
                  onChange={e => {
                    const v = e.target.value;
                    setForm(f => ({ ...f, phone: v }));
                    if (errors.phone)
                      setErrors(prev => ({ ...prev, phone: "" }));
                  }}
                  placeholder="+91 98765 43210"
                  className={`bg-white h-10 ${errors.phone ? "border-red-400" : ""}`}
                />
                {errors.phone && (
                  <p className="text-[11px] text-red-600">{errors.phone}</p>
                )}
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-bold">Email</span>
                <Input
                  value={form.email}
                  onChange={e => {
                    const v = e.target.value;
                    setForm(f => ({ ...f, email: v }));
                    if (errors.email)
                      setErrors(prev => ({ ...prev, email: "" }));
                  }}
                  placeholder="koramangala@starkupps.com"
                  className={`bg-white h-10 ${errors.email ? "border-red-400" : ""}`}
                />
                {errors.email && (
                  <p className="text-[11px] text-red-600">{errors.email}</p>
                )}
              </label>
            </div>
          </div>

          {/* Initial Setup */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="h-px flex-1 bg-[#E4DCD1]" />
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[#A83825]">
                Initial Setup
              </span>
              <span className="h-px flex-1 bg-[#E4DCD1]" />
            </div>
            <label className="flex items-center justify-between rounded-xl border border-[#E4DCD1] bg-white px-4 py-3">
              <div>
                <p className="text-xs font-bold">Delivery Enabled</p>
                <p className="text-[11px] text-[#87796C]">
                  Offer delivery from this outlet
                </p>
              </div>
              <Switch
                checked={form.deliveryEnabled}
                onCheckedChange={v =>
                  setForm(f => ({ ...f, deliveryEnabled: v }))
                }
              />
            </label>
            <div className="space-y-2">
              <Label className="text-xs font-bold">Appointed Staff</Label>
              <div className="rounded-xl border border-[#E4DCD1] bg-white">
                <div className="border-b border-[#E7DED4] p-3">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#8E8174]" />
                    <Input
                      value={staffSearch}
                      onChange={e => setStaffSearch(e.target.value)}
                      placeholder="Search staff…"
                      className="h-8 pl-9 text-xs"
                    />
                  </div>
                  <p className="mt-2 text-[11px] text-[#87796C]">
                    {form.staffIds.length} selected · {filteredStaff.length}{" "}
                    shown
                  </p>
                </div>
                <div className="max-h-[180px] overflow-y-auto p-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                  {staffQ.isLoading ? (
                    <div className="grid place-items-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
                    </div>
                  ) : staffQ.isError ? (
                    <div className="p-3 text-xs text-[#8D5145]">
                      Failed to load staff.{" "}
                      <button
                        onClick={() => staffQ.refetch()}
                        className="underline"
                      >
                        Retry
                      </button>
                    </div>
                  ) : !filteredStaff.length ? (
                    <div className="p-3 text-center text-xs text-[#87796C]">
                      {staffSearch
                        ? "No matching staff"
                        : "No eligible staff found"}
                    </div>
                  ) : (
                    filteredStaff.map((s: any) => {
                      const checked = form.staffIds.includes(s.id);
                      const isOwner = form.ownerId === s.id;
                      return (
                        <label
                          key={s.id}
                          className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-[#F6F0E8] ${checked ? "bg-[#F6F0E8]" : ""}`}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={v => {
                              setForm(f => {
                                const set = new Set(f.staffIds);
                                if (v) set.add(s.id);
                                else set.delete(s.id);
                                return { ...f, staffIds: Array.from(set) };
                              });
                            }}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-bold">
                              {s.name}{" "}
                              {isOwner && (
                                <span className="ml-1 rounded-full bg-[#211B18] px-1.5 py-0.5 text-[9px] font-bold text-white">
                                  Owner
                                </span>
                              )}
                            </p>
                            <p className="truncate text-[11px] text-[#87796C]">
                              {s.role} · {s.email}
                            </p>
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
              <p className="text-[11px] text-[#87796C]">
                Creates proper <code>outlet_staff</code> rows — not a CSV. Owner
                is stored separately.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter className="sticky bottom-0 z-10 shrink-0 border-t border-[#E4DCD1] bg-[#FCFAF6] px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={create.isPending}
            className="bg-[#211B18] text-white"
          >
            {create.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Create Outlet"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OutletDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const q = trpc.outlets.byId.useQuery({ id }, { refetchOnWindowFocus: false });
  const [tab, setTab] = useState<
    | "overview"
    | "details"
    | "hours"
    | "delivery"
    | "menu"
    | "staff"
    | "inventory"
    | "payments"
    | "settings"
  >("overview");
  if (q.isLoading)
    return (
      <div className="grid min-h-[240px] place-items-center">
        <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
      </div>
    );
  if (q.isError || !q.data)
    return (
      <div className="rounded-[14px] border border-[#F1C9BD] bg-[#FFF8F5] p-5 text-sm">
        Outlet not found{" "}
        <Button variant="outline" onClick={onBack} className="ml-2 h-7 text-xs">
          Back
        </Button>
      </div>
    );
  const {
    outlet,
    hours,
    zones,
    stats,
    owner,
    assignedStaff,
    menuAvailCount,
    inventoryCount,
  } = q.data as any;
  const checklist = [
    { label: "Outlet created", done: true },
    {
      label: "Location configured",
      done: !!(outlet.address && outlet.latitude && outlet.longitude),
    },
    { label: "Manager assigned", done: !!outlet.ownerId && !!owner },
    { label: "Staff assigned", done: (assignedStaff?.length ?? 0) > 0 },
    { label: "Configure operating hours", done: (hours?.length ?? 0) > 0 },
    {
      label: "Configure delivery",
      done: (zones?.length ?? 0) > 0 || !!outlet.services?.delivery,
    },
    { label: "Configure menu availability", done: (menuAvailCount ?? 0) > 0 },
    { label: "Configure inventory", done: (inventoryCount ?? 0) > 0 },
    {
      label: "Configure payments",
      done: !!outlet.services && Object.values(outlet.services).some(Boolean),
    },
  ];
  return (
    <>
      <Button variant="ghost" onClick={onBack} className="mb-4 px-0 text-xs">
        ← All outlets
      </Button>
      <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#A83825]">
              {outlet.code} · {outlet.city} · {outlet.state}
            </p>
            <h2 className="text-2xl font-extrabold tracking-[-0.04em]">
              {outlet.name}
            </h2>
            <p className="mt-1 text-xs text-[#776A5E]">
              {outlet.address} · {outlet.phone || "No phone"} ·{" "}
              {outlet.email || "No email"}
            </p>
            {owner && (
              <p className="mt-1 text-xs font-bold text-[#211B18]">
                Owner: {owner.name} · {owner.email}
              </p>
            )}
          </div>
          <Badge
            className={
              outlet.status === "active"
                ? "border-[#BDE0C8] bg-[#E5F2E9] text-[#2F6947]"
                : "bg-[#F6F0E8] text-[#706356]"
            }
          >
            {outlet.status}
          </Badge>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-[#E4DCD1] bg-white p-3 text-center">
            <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]">
              Today revenue
            </p>
            <p className="mt-1 text-sm font-extrabold">
              {inr(stats.todayRevenue)}
            </p>
          </div>
          <div className="rounded-xl border border-[#E4DCD1] bg-white p-3 text-center">
            <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]">
              Today orders
            </p>
            <p className="mt-1 text-sm font-extrabold">{stats.todayOrders}</p>
          </div>
          <div className="rounded-xl border border-[#E4DCD1] bg-white p-3 text-center">
            <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]">
              Active
            </p>
            <p className="mt-1 text-sm font-extrabold">{stats.activeOrders}</p>
          </div>
          <div className="rounded-xl border border-[#E4DCD1] bg-white p-3 text-center">
            <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]">
              Staff / Riders
            </p>
            <p className="mt-1 text-sm font-extrabold">
              {stats.currentStaff} / {stats.activeRiders}
            </p>
          </div>
        </div>
        {/* Setup Checklist */}
        <div className="mt-5 rounded-xl border border-[#E4DCD1] bg-white p-4">
          <h3 className="text-xs font-extrabold">Outlet Setup</h3>
          <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {checklist.map(c => (
              <div key={c.label} className="flex items-center gap-2 text-xs">
                <span
                  className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold ${c.done ? "bg-[#E5F2E9] text-[#2F6947]" : "bg-[#F6F0E8] text-[#87796C]"}`}
                >
                  {c.done ? "✓" : "○"}
                </span>
                <span
                  className={
                    c.done ? "font-bold text-[#211B18]" : "text-[#776A5E]"
                  }
                >
                  {c.label}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-5 flex gap-1 overflow-x-auto rounded-xl border border-[#E4DCD1] bg-[#EEE9E1] p-1">
          {(
            [
              "overview",
              "details",
              "hours",
              "delivery",
              "menu",
              "staff",
              "inventory",
              "payments",
              "settings",
            ] as const
          ).map(t => {
            const label =
              t === "hours"
                ? "Operating Hours"
                : t === "delivery"
                  ? "Delivery & Orders"
                  : t.charAt(0).toUpperCase() + t.slice(1);
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-bold capitalize ${tab === t ? "bg-white shadow-sm text-[#211B18]" : "text-[#766A5F]"}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </section>
      <div className="mt-5">
        {tab === "overview" && (
          <OutletOverview
            outlet={outlet}
            stats={stats}
            owner={owner}
            assignedStaff={assignedStaff}
          />
        )}
        {tab === "details" && (
          <OutletDetails
            outlet={outlet}
            owner={owner}
            assignedStaff={assignedStaff}
          />
        )}
        {tab === "hours" && <OutletHours outletId={id} initial={hours} />}
        {tab === "delivery" && (
          <div className="space-y-4">
            <OutletDeliveryInfo outlet={outlet} />
            <OutletZones outletId={id} zones={zones} />
          </div>
        )}
        {tab === "menu" && <OutletMenuTab outletId={id} />}
        {tab === "staff" && (
          <OutletStaffTab outletId={id} assignedStaff={assignedStaff} />
        )}
        {tab === "inventory" && <OutletInventoryTab outletId={id} />}
        {tab === "payments" && (
          <div className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-8 text-center">
            <p className="text-sm font-bold">Payments</p>
            <p className="mt-2 text-xs text-[#776A5E]">
              Configure outlet payment methods, settlement and payout rules.
              Uses existing finance architecture.
            </p>
          </div>
        )}
        {tab === "settings" && (
          <div className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-8 text-center">
            <p className="text-sm font-bold">Settings</p>
            <p className="mt-2 text-xs text-[#776A5E]">
              Outlet-specific settings, timezone and operational flags.
            </p>
          </div>
        )}
      </div>
    </>
  );
}

function OutletOverview({ outlet, stats, owner, assignedStaff }: any) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5">
        <h3 className="text-sm font-extrabold">Operations snapshot</h3>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
          <dt className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]">
            Timezone
          </dt>
          <dd className="font-bold">{outlet.timezone}</dd>
          <dt className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]">
            Hours
          </dt>
          <dd className="font-bold">
            {outlet.openingTime} – {outlet.closingTime}
          </dd>
          <dt className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]">
            Delivery radius
          </dt>
          <dd className="font-bold">{outlet.deliveryRadiusKm} km</dd>
          <dt className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]">
            Low stock
          </dt>
          <dd className="font-bold">{stats.lowStock}</dd>
          <dt className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]">
            Owner
          </dt>
          <dd className="font-bold">{owner?.name || "—"}</dd>
          <dt className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]">
            Staff
          </dt>
          <dd className="font-bold">{assignedStaff?.length ?? 0} assigned</dd>
        </dl>
      </div>
      <div className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5">
        <h3 className="text-sm font-extrabold">Services</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {Object.entries(outlet.services ?? {}).map(([k, v]: any) => (
            <Badge
              key={k}
              className={
                v
                  ? "bg-[#E5F2E9] text-[#2F6947] border-[#BDE0C8]"
                  : "bg-[#F6F0E8] text-[#706356]"
              }
            >
              {k} {v ? "✓" : "✗"}
            </Badge>
          ))}
        </div>
        <p className="mt-4 text-xs text-[#776A5E]">
          Menu catalog remains shared; outlet-specific availability is
          controlled in the Menu tab. Inventory stays outlet-scoped.
        </p>
      </div>
    </div>
  );
}

function OutletDetails({ outlet, owner, assignedStaff }: any) {
  return (
    <div className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5">
      <h3 className="text-sm font-extrabold">Details</h3>
      <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
        <div>
          <dt className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]">
            Code
          </dt>
          <dd className="font-mono font-bold">{outlet.code}</dd>
        </div>
        <div>
          <dt className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]">
            Status
          </dt>
          <dd className="font-bold capitalize">{outlet.status}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]">
            Address
          </dt>
          <dd className="font-bold">
            {outlet.address} — {outlet.city}, {outlet.state} {outlet.pincode}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]">
            Phone
          </dt>
          <dd className="font-bold">{outlet.phone || "—"}</dd>
        </div>
        <div>
          <dt className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]">
            Email
          </dt>
          <dd className="font-bold">{outlet.email || "—"}</dd>
        </div>
        <div>
          <dt className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]">
            Coordinates
          </dt>
          <dd className="font-mono font-bold">
            {outlet.latitude ?? "—"}, {outlet.longitude ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]">
            Owner
          </dt>
          <dd className="font-bold">
            {owner ? `${owner.name} (${owner.role})` : "—"}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#87796C]">
            Appointed Staff
          </dt>
          <dd className="font-bold">
            {assignedStaff?.length
              ? assignedStaff.map((s: any) => s.name).join(", ")
              : "—"}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function OutletDeliveryInfo({ outlet }: any) {
  return (
    <div className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5">
      <h3 className="text-sm font-extrabold">Delivery & Orders</h3>
      <p className="mt-2 text-xs text-[#776A5E]">
        Delivery enabled:{" "}
        <span className="font-bold">
          {outlet.services?.delivery ? "ON" : "OFF"}
        </span>{" "}
        · Radius {outlet.deliveryRadiusKm} km · Min ₹{outlet.minimumOrder} ·
        Prep {outlet.preparationTimeMinutes} min
      </p>
      <p className="mt-2 text-[11px] text-[#87796C]">
        Configure radius, fee, threshold and hours in the Delivery tab. Uses
        existing <code>delivery_zones</code> + <code>outlets.services</code>{" "}
        architecture.
      </p>
    </div>
  );
}

function OutletMenuTab({ outletId }: { outletId: number }) {
  const q = trpc.outlets.menuAvailability.list.useQuery({ outletId });
  return (
    <div className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5">
      <h3 className="text-sm font-extrabold">Menu Availability</h3>
      {q.isLoading ? (
        <p className="mt-3 text-xs">Loading…</p>
      ) : q.isError ? (
        <p className="mt-3 text-xs text-[#B83D29]">
          Could not load availability.{" "}
          <button className="underline" onClick={() => q.refetch()}>
            Retry
          </button>
        </p>
      ) : (
        <p className="mt-2 text-xs text-[#776A5E]">
          {q.data?.length ?? 0} overrides. Catalog remains shared;
          outlet-specific availability is controlled here. Configure in Menu
          hub.
        </p>
      )}
    </div>
  );
}

function OutletStaffTab({ outletId, assignedStaff }: any) {
  const q = trpc.staff.list.useQuery({ outletId, limit: 50 } as any);
  const staff = (q.data as any)?.items ?? assignedStaff ?? [];
  return (
    <div className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5">
      <h3 className="text-sm font-extrabold">Staff</h3>
      {q.isLoading ? (
        <p className="mt-3 text-xs">Loading…</p>
      ) : q.isError ? (
        <p className="mt-3 text-xs text-[#B83D29]">
          Could not load staff.{" "}
          <button className="underline" onClick={() => q.refetch()}>
            Retry
          </button>
        </p>
      ) : !staff.length ? (
        <p className="mt-2 text-xs text-[#776A5E]">
          No staff assigned. Use Staff hub to assign.
        </p>
      ) : (
        <div className="mt-3 divide-y divide-[#E7DED4]">
          {staff.map((s: any) => (
            <div key={s.id} className="py-2 text-xs">
              <span className="font-bold">{s.name}</span> · {s.role} · {s.email}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OutletInventoryTab({ outletId }: { outletId: number }) {
  const q = trpc.inventory.list.useQuery({ outletId, limit: 5 } as any);
  return (
    <div className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5">
      <h3 className="text-sm font-extrabold">Inventory</h3>
      <p className="mt-2 text-xs text-[#776A5E]">
        Outlet-scoped materials, prepared items, stock movements and wastage —
        isolated per outlet.
      </p>
      {q.isLoading ? (
        <p className="mt-3 text-xs">Loading…</p>
      ) : q.isError ? (
        <p className="mt-3 text-xs text-[#B83D29]">
          Could not load inventory.{" "}
          <button className="underline" onClick={() => q.refetch()}>
            Retry
          </button>
        </p>
      ) : (
        <p className="mt-2 text-xs">
          {(q.data as any)?.items?.length ?? 0} items in outlet
        </p>
      )}
    </div>
  );
}

function OutletHours({
  outletId,
  initial,
}: {
  outletId: number;
  initial: any[];
}) {
  const [hours, setHours] = useState(() => {
    const map = new Map(initial.map((h: any) => [h.dayOfWeek, h]));
    return days.map((_, idx) => {
      const h = map.get(idx);
      return {
        dayOfWeek: idx,
        isOpen: h?.isOpen ?? true,
        openTime: h?.openTime ?? "09:00",
        closeTime: h?.closeTime ?? "22:00",
      };
    });
  });
  const save = trpc.outlets.hours.save.useMutation({
    onSuccess: () => toast.success("Hours saved"),
    onError: e => toast.error(e.message),
  });
  return (
    <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5">
      <h3 className="text-sm font-extrabold flex items-center gap-2">
        <Clock3 className="h-4 w-4 text-[#A83825]" />
        Weekly hours
      </h3>
      <div className="mt-4 divide-y divide-[#E7DED4]">
        {hours.map((h, idx) => (
          <div
            key={idx}
            className="flex items-center justify-between gap-3 py-3"
          >
            <span className="w-24 text-xs font-bold">{days[idx]}</span>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={h.isOpen}
                onChange={e =>
                  setHours(prev =>
                    prev.map((x, i) =>
                      i === idx ? { ...x, isOpen: e.target.checked } : x
                    )
                  )
                }
              />{" "}
              Open
            </label>
            <Input
              type="time"
              value={h.openTime ?? ""}
              disabled={!h.isOpen}
              onChange={e =>
                setHours(prev =>
                  prev.map((x, i) =>
                    i === idx ? { ...x, openTime: e.target.value } : x
                  )
                )
              }
              className="h-8 w-28 bg-white text-xs"
            />
            <span className="text-xs text-[#87796C]">—</span>
            <Input
              type="time"
              value={h.closeTime ?? ""}
              disabled={!h.isOpen}
              onChange={e =>
                setHours(prev =>
                  prev.map((x, i) =>
                    i === idx ? { ...x, closeTime: e.target.value } : x
                  )
                )
              }
              className="h-8 w-28 bg-white text-xs"
            />
          </div>
        ))}
      </div>
      <Button
        onClick={() => save.mutate({ outletId, hours })}
        disabled={save.isPending}
        className="mt-4 bg-[#211B18] text-white text-xs"
      >
        {save.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          "Save hours"
        )}
      </Button>
    </section>
  );
}

function OutletZones({
  outletId,
  zones: initial,
}: {
  outletId: number;
  zones: any[];
}) {
  const q = trpc.outlets.zones.list.useQuery({ outletId });
  const create = trpc.outlets.zones.create.useMutation({
    onSuccess: () => {
      toast.success("Zone created");
      void q.refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const remove = trpc.outlets.zones.remove.useMutation({
    onSuccess: () => {
      toast.success("Zone removed");
      void q.refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const [form, setForm] = useState({ name: "", radiusKm: "5" });
  const zones = q.data ?? initial;
  return (
    <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5">
      <h3 className="text-sm font-extrabold">Delivery zones</h3>
      <p className="mt-1 text-xs text-[#776A5E]">
        Maximum radius drives eligibility; pincode/polygon extensible via stored
        GeoJSON.
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_120px_auto]">
        <Input
          value={form.name}
          onChange={e => setForm({ ...form, name: e.target.value })}
          placeholder="Zone name (e.g. 5km radius)"
          className="bg-white text-xs"
        />
        <Input
          type="number"
          value={form.radiusKm}
          onChange={e => setForm({ ...form, radiusKm: e.target.value })}
          placeholder="Radius km"
          className="bg-white text-xs"
        />
        <Button
          onClick={() => {
            if (!form.name.trim()) return toast.error("Name required");
            create.mutate({
              outletId,
              name: form.name.trim(),
              radiusKm: Number(form.radiusKm),
              type: "radius",
              active: true,
              pincodes: null,
              geoJson: null,
            });
            setForm({ name: "", radiusKm: "5" });
          }}
          disabled={create.isPending}
          className="bg-[#211B18] text-white text-xs"
        >
          <Plus className="mr-1 h-3 w-3" />
          Add zone
        </Button>
      </div>
      {q.isLoading ? (
        <p className="mt-4 text-xs text-[#87796C]">Loading…</p>
      ) : q.isError ? (
        <p className="mt-4 text-xs text-[#B83D29]">
          Could not load zones.{" "}
          <button className="underline" onClick={() => q.refetch()}>
            Retry
          </button>
        </p>
      ) : !zones.length ? (
        <p className="mt-4 rounded-xl border border-dashed border-[#D5C8BA] bg-white p-4 text-center text-xs text-[#87796C]">
          No zones configured. Customers will be served within the outlet&apos;s
          delivery radius.
        </p>
      ) : (
        <div className="mt-4 divide-y divide-[#E7DED4] rounded-xl border border-[#E7DED4] bg-white">
          {zones.map((z: any) => (
            <div key={z.id} className="flex items-center justify-between p-3">
              <div>
                <p className="text-xs font-bold">{z.name}</p>
                <p className="text-[11px] text-[#87796C]">
                  {z.type} {z.radiusKm ? `· ${Number(z.radiusKm)} km` : ""} ·{" "}
                  {z.active ? "Active" : "Inactive"}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                disabled={remove.isPending}
                aria-label={`Delete zone ${z.name}`}
                onClick={() => {
                  if (confirm(`Delete zone "${z.name}"?`))
                    remove.mutate({ id: z.id });
                }}
                className="h-8 w-8 text-[#B83D29]"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
