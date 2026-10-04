import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/shared/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/api/trpc";
import { useOutlet } from "@/state/outlet-provider";
import {
  Loader2,
  Plus,
  Search,
  Users,
  LogIn,
  LogOut,
  UserX,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { dateText, dateTimeText } from "@/utils/format";

const staffStatusMeta: Record<string, { label: string; cls: string }> = {
  pending: {
    label: "Pending",
    cls: "border-[#E3D9CE] bg-[#F6F0E8] text-[#706356]",
  },
  active: {
    label: "Active",
    cls: "border-[#BDE0C8] bg-[#E5F2E9] text-[#2F6947]",
  },
  inactive: {
    label: "Inactive",
    cls: "border-[#E3D9CE] bg-[#F6F0E8] text-[#706356]",
  },
  suspended: {
    label: "Suspended",
    cls: "border-[#F3C5B9] bg-[#FBE4DD] text-[#A83825]",
  },
  on_leave: {
    label: "On Leave",
    cls: "border-[#EFD79B] bg-[#FBF0D5] text-[#8A5D10]",
  },
  terminated: {
    label: "Terminated",
    cls: "border-[#F1C9BD] bg-[#FFF0EA] text-[#9A3627]",
  },
};
const employmentLabels: Record<string, string> = {
  full_time: "Full Time",
  part_time: "Part Time",
  contract: "Contract",
  temporary: "Temporary",
};

export default function StaffHub({ staffId }: { staffId?: number }) {
  const [location, setLocation] = useLocation();
  // Determine tab from URL
  const path = location.toLowerCase();
  let tab: string = "overview";
  if (staffId) tab = "profile";
  else if (path.includes("/staff/roles") || path.includes("/roles"))
    tab = "roles";
  else if (path.includes("/staff/attendance")) tab = "attendance";
  else if (path.includes("/staff/shifts") || path.includes("/schedule"))
    tab = "shifts";
  else if (path.includes("/staff/leave")) tab = "leave";
  else if (path.includes("/staff/performance")) tab = "performance";
  else if (path.includes("/staff/activity")) tab = "activity";
  else if (path.includes("/staff/all")) tab = "all";
  else if (path === "/staff" || path === "/staff/") tab = "overview";

  if (staffId)
    return (
      <StaffProfile id={staffId} onBack={() => setLocation("/staff/all")} />
    );

  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-2">
        {[
          ["overview", "Overview", "/staff"],
          ["all", "All Staff", "/staff/all"],
          ["roles", "Roles & Permissions", "/staff/roles"],
          ["attendance", "Attendance", "/staff/attendance"],
          ["shifts", "Shifts & Schedule", "/staff/shifts"],
          ["leave", "Leave", "/staff/leave"],
          ["performance", "Performance", "/staff/performance"],
          ["activity", "Activity", "/staff/activity"],
        ].map(([id, label, href]) => (
          <button
            key={id}
            onClick={() => setLocation(href)}
            className={`rounded-lg px-3 py-2 text-xs font-bold ${tab === id ? "bg-[#211B18] text-white shadow-sm" : "border border-[#DCCFC2] bg-[#FCFAF6] text-[#6C6055] hover:bg-white"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "overview" && <StaffOverview />}
      {tab === "all" && <AllStaff />}
      {tab === "roles" && <RolesView />}
      {tab === "attendance" && <AttendanceView />}
      {tab === "shifts" && <ShiftsView />}
      {tab === "leave" && <LeaveView />}
      {tab === "performance" && <PerformanceView />}
      {tab === "activity" && <ActivityView />}
    </div>
  );
}

function StaffOverview() {
  const { selectedId: outletId } = useOutlet();
  const q = trpc.staff.overview.useQuery(outletId ? { outletId } : undefined);
  const [, setLocation] = useLocation();
  if (q.isLoading)
    return (
      <div className="grid min-h-[240px] place-items-center rounded-[14px] border border-dashed border-[#D5C8BA] bg-[#FCFAF6]">
        <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
      </div>
    );
  if (q.isError)
    return (
      <div className="rounded-[14px] border border-[#F1C9BD] bg-[#FFF8F5] p-5 text-sm text-[#8D5145]">
        {String((q.error as any).message)}{" "}
        <Button
          variant="outline"
          className="ml-2 h-7 text-xs"
          onClick={() => q.refetch()}
        >
          Try Again
        </Button>
      </div>
    );
  const d = q.data as any;
  return (
    <>
      <section className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#A83825]">
            <span className="h-px w-7 bg-[#E2533C]" />
            Staff
          </p>
          <h2 className="text-3xl font-extrabold tracking-[-0.055em]">
            Manage StarKupps workforce across all outlets.
          </h2>
          <p className="mt-2 text-sm font-medium leading-6 text-[#75695E]">
            Real-time attendance, outlet distribution, and workforce KPIs.
          </p>
        </div>
        <Button
          onClick={() => setLocation("/staff/all")}
          className="bg-[#211B18] text-xs text-white"
        >
          <Plus className="mr-1 h-4 w-4" />
          Add Staff
        </Button>
      </section>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[12px] border border-[#DAD0C5] bg-[#FCFAF6] p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#8B7E71]">
            Total Staff
          </p>
          <p className="mt-2 text-2xl font-extrabold">{d.total}</p>
          <p className="text-xs text-[#8B7E71]">
            Active {d.active} • Inactive {d.inactive}
          </p>
        </div>
        <div className="rounded-[12px] border border-[#DAD0C5] bg-[#FCFAF6] p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#8B7E71]">
            Currently Working
          </p>
          <p className="mt-2 text-2xl font-extrabold">{d.working}</p>
          <p className="text-xs text-[#8B7E71]">
            Present {d.present} • Late {d.late}
          </p>
        </div>
        <div className="rounded-[12px] border border-[#DAD0C5] bg-[#FCFAF6] p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#8B7E71]">
            On Leave / Absent
          </p>
          <p className="mt-2 text-2xl font-extrabold">
            {d.onLeave} / {d.absent}
          </p>
          <p className="text-xs text-[#8B7E71]">Scheduled {d.scheduledToday}</p>
        </div>
        <div className="rounded-[12px] border border-[#DAD0C5] bg-[#FCFAF6] p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#8B7E71]">
            Suspended
          </p>
          <p className="mt-2 text-2xl font-extrabold">{d.suspended}</p>
          <p className="text-xs text-[#8B7E71]">Inactive {d.inactive}</p>
        </div>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5">
          <h3 className="text-sm font-extrabold">Today&apos;s Attendance</h3>
          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl border bg-white p-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#8B7E71]">
                Present
              </p>
              <p className="mt-1 text-xl font-extrabold text-[#2F6947]">
                {d.present}
              </p>
            </div>
            <div className="rounded-xl border bg-white p-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#8B7E71]">
                Late
              </p>
              <p className="mt-1 text-xl font-extrabold text-[#8A5D10]">
                {d.late}
              </p>
            </div>
            <div className="rounded-xl border bg-white p-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#8B7E71]">
                Absent
              </p>
              <p className="mt-1 text-xl font-extrabold text-[#A83825]">
                {d.absent}
              </p>
            </div>
          </div>
          <div className="mt-4 rounded-xl border border-dashed border-[#D5C8BA] bg-white p-4">
            <p className="text-xs font-bold">Staff Status</p>
            <div className="mt-2 space-y-1 text-xs">
              <div className="flex justify-between">
                <span>🟢 Working</span>
                <span className="font-bold">{d.working}</span>
              </div>
              <div className="flex justify-between">
                <span>🟡 On Break</span>
                <span className="font-bold">{d.onBreak ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span>⚪ Not Started</span>
                <span className="font-bold">
                  {Math.max(0, d.total - d.present - d.onLeave)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>🔴 Absent</span>
                <span className="font-bold">{d.absent}</span>
              </div>
            </div>
          </div>
        </section>
        <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5">
          <h3 className="text-sm font-extrabold">Staff by Outlet</h3>
          {!d.byOutlet.length ? (
            <p className="mt-4 text-center text-xs text-[#827568]">
              No outlets.
            </p>
          ) : (
            <div className="mt-4 space-y-2">
              {d.byOutlet.map((o: any) => (
                <div
                  key={o.outletId}
                  onClick={() => setLocation(`/staff/all?outlet=${o.outletId}`)}
                  className="flex cursor-pointer items-center justify-between rounded-xl border bg-white p-3 hover:bg-[#FFFDF9]"
                >
                  <span className="text-xs font-bold">{o.outletName}</span>
                  <span className="rounded-full bg-[#211B18] px-2.5 py-1 text-xs font-bold text-white">
                    {o.count} Staff
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      <section className="mt-5 rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-5">
        <h3 className="text-sm font-extrabold">Today&apos;s Staff</h3>
        <p className="text-xs text-[#8B7E71]">
          Staff | Role | Outlet | Status | Today&apos;s Attendance
        </p>
        <div className="mt-3 text-center text-xs text-[#827568]">
          View detailed roster in <span className="font-bold">All Staff</span>{" "}
          and <span className="font-bold">Shifts & Schedule</span>.
        </div>
      </section>
    </>
  );
}

function AllStaff() {
  const { selectedId: outletId } = useOutlet();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [role, setRole] = useState("");
  const [employmentType, setEmploymentType] = useState("");
  const [status, setStatus] = useState("");
  const [cursor, setCursor] = useState<number | undefined>();
  const [history, setHistory] = useState<Array<number | undefined>>([]);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 400);
    return () => clearTimeout(t);
  }, [search]);
  // Changing any filter invalidates the cursor window; start from the first page.
  useEffect(() => {
    setCursor(undefined);
    setHistory([]);
  }, [debounced, role, employmentType, status, outletId]);
  const q = trpc.staff.list.useQuery({
    search: debounced || undefined,
    outletId: outletId ?? undefined,
    role: (role || undefined) as any,
    employmentType: (employmentType || undefined) as any,
    status: (status || undefined) as any,
    limit: 20,
    cursor,
  });
  const [, setLocation] = useLocation();
  const [createOpen, setCreateOpen] = useState(false);
  return (
    <>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:w-80">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[#8E8174]" />
          <Input
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setCursor(undefined);
            }}
            placeholder="Search name, phone, email, employee ID"
            className="h-10 border-[#DCCFC2] bg-[#FCFAF6] pl-9 text-xs"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger className="h-9 w-[140px] bg-white text-xs">
              <SelectValue placeholder="All Roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All Roles</SelectItem>
              <SelectItem value="owner">Owner</SelectItem>
              <SelectItem value="manager">Manager</SelectItem>
              <SelectItem value="staff">Staff</SelectItem>
            </SelectContent>
          </Select>
          <Select value={employmentType} onValueChange={setEmploymentType}>
            <SelectTrigger className="h-9 w-[140px] bg-white text-xs">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All Types</SelectItem>
              <SelectItem value="full_time">Full Time</SelectItem>
              <SelectItem value="part_time">Part Time</SelectItem>
              <SelectItem value="contract">Contract</SelectItem>
              <SelectItem value="temporary">Temporary</SelectItem>
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9 w-[140px] bg-white text-xs">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
              <SelectItem value="on_leave">On Leave</SelectItem>
              <SelectItem value="terminated">Terminated</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
          <Button
            onClick={() => setCreateOpen(true)}
            className="bg-[#211B18] text-xs text-white"
          >
            <Plus className="mr-1 h-4 w-4" />
            Add Staff
          </Button>
        </div>
      </div>
      {q.isLoading ? (
        <div className="grid min-h-[240px] place-items-center rounded-[14px] border border-dashed border-[#D5C8BA] bg-[#FCFAF6]">
          <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
        </div>
      ) : q.isError ? (
        <div className="rounded-[14px] border border-[#F1C9BD] bg-[#FFF8F5] p-5 text-sm text-[#8D5145]">
          {String((q.error as any).message)}{" "}
          <Button
            variant="outline"
            className="ml-2 h-7 text-xs"
            onClick={() => q.refetch()}
          >
            Try Again
          </Button>
        </div>
      ) : !q.data?.items.length ? (
        <div className="grid min-h-[240px] place-items-center rounded-[14px] border border-dashed border-[#D5C8BA] bg-[#FCFAF6] p-6 text-center">
          <Users className="mx-auto h-8 w-8 text-[#A39486]" />
          <h3 className="mt-3 text-sm font-extrabold">No staff members yet.</h3>
          <p className="mt-2 text-xs text-[#827568]">
            Add your first StarKupps team member.
          </p>
          <Button
            onClick={() => setCreateOpen(true)}
            className="mt-3 bg-[#211B18] text-xs text-white"
          >
            Add Staff
          </Button>
        </div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] lg:block">
            <div className="overflow-x-auto">
              <table className="min-w-[900px] w-full text-left">
                <thead className="border-b bg-[#F7F2EB]">
                  <tr>
                    {[
                      "Staff",
                      "Role",
                      "Outlet",
                      "Employment",
                      "Status",
                      "Today's Attendance",
                      "Joined",
                      "",
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
                  {q.data.items.map((s: any) => (
                    <tr key={s.id} className="hover:bg-white">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="grid h-8 w-8 place-items-center rounded-full bg-[#EEE7DE] text-xs font-bold">
                            {s.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-xs font-bold">{s.name}</p>
                            <p className="text-[11px] text-[#8B7E71]">
                              {s.employeeId ?? s.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">{s.role}</td>
                      <td className="px-4 py-3 text-xs">
                        {s.outletName ?? "Unassigned"}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {employmentLabels[s.employmentType] ?? s.employmentType}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${staffStatusMeta[s.status]?.cls ?? staffStatusMeta.active.cls}`}
                        >
                          {staffStatusMeta[s.status]?.label ?? s.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {s.todayAttendance ? (
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${s.todayAttendance.status === "present" ? "bg-[#E5F2E9] text-[#2F6947]" : s.todayAttendance.status === "late" ? "bg-[#FBF0D5] text-[#8A5D10]" : "bg-[#F6F0E8] text-[#706356]"}`}
                          >
                            {s.todayAttendance.status}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-[#6F6257]">
                        {s.joiningDate
                          ? dateText(s.joiningDate)
                          : dateText(s.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => setLocation(`/staff/${s.id}`)}
                        >
                          View
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="grid gap-2 lg:hidden">
            {q.data.items.map((s: any) => (
              <div
                key={s.id}
                className="rounded-[14px] border bg-[#FCFAF6] p-4"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-bold">{s.name}</p>
                    <p className="text-xs text-[#8B7E71]">
                      {s.employeeId ?? s.email} • {s.role}
                    </p>
                    <p className="text-xs text-[#8B7E71]">
                      {s.outletName ?? "Unassigned"} •{" "}
                      {employmentLabels[s.employmentType] ?? s.employmentType}
                    </p>
                  </div>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${staffStatusMeta[s.status]?.cls ?? ""}`}
                  >
                    {staffStatusMeta[s.status]?.label ?? s.status}
                  </span>
                </div>
                <Button
                  variant="outline"
                  className="mt-3 h-7 w-full text-xs"
                  onClick={() => setLocation(`/staff/${s.id}`)}
                >
                  View Profile
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button
              variant="outline"
              className="h-8 text-xs"
              disabled={!history.length}
              onClick={() => {
                const prev = history.at(-1);
                setHistory(h => h.slice(0, -1));
                setCursor(prev);
              }}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              className="h-8 text-xs"
              disabled={!q.data?.nextCursor}
              onClick={() => {
                if (q.data?.nextCursor) {
                  setHistory(h => [...h, cursor]);
                  setCursor(q.data.nextCursor);
                }
              }}
            >
              Next
            </Button>
          </div>
        </>
      )}
      <StaffCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          setCreateOpen(false);
          void q.refetch();
        }}
      />
    </>
  );
}

function StaffCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const managers = trpc.staff.list.useQuery({ limit: 100 } as any);
  const outlets = trpc.outlets.list.useQuery({ limit: 100 } as any);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    role: "staff" as any,
    employmentType: "full_time" as any,
    joiningDate: new Date().toISOString().slice(0, 10),
    primaryOutletId: "",
    additionalOutlets: [] as number[],
    managerId: "",
    profilePhoto: "",
    dateOfBirth: "",
    emergencyContact: "",
    address: "",
  });
  const create = trpc.staff.create.useMutation({
    onSuccess: (r: any) => {
      toast.success(`Staff created ${r.employeeId}`);
      onCreated();
      setForm({
        name: "",
        email: "",
        phone: "",
        role: "staff",
        employmentType: "full_time",
        joiningDate: new Date().toISOString().slice(0, 10),
        primaryOutletId: "",
        additionalOutlets: [],
        managerId: "",
        profilePhoto: "",
        dateOfBirth: "",
        emergencyContact: "",
        address: "",
      });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const submitForm = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.primaryOutletId)
      return toast.error("Name, email, primary outlet required");
    create.mutate({
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || null,
      role: form.role,
      employmentType: form.employmentType,
      joiningDate: form.joiningDate || null,
      primaryOutletId: Number(form.primaryOutletId),
      managerId: form.managerId ? Number(form.managerId) : null,
      additionalOutlets: form.additionalOutlets,
      profilePhoto: form.profilePhoto || null,
      dateOfBirth: form.dateOfBirth || null,
      emergencyContact: form.emergencyContact || null,
      address: form.address || null,
    } as any);
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="2xl"
      title="Create Staff — Onboarding"
      description="Personal → Employment → Role → Outlet → Permissions → Active"
      onSubmit={submitForm}
      submitLabel={
        create.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          "Create Staff"
        )
      }
      submitPending={create.isPending}
      formClassName="space-y-4"
    >
      <section>
        <h4 className="text-xs font-extrabold uppercase tracking-[0.1em] text-[#A83825]">
          Personal Profile
        </h4>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs font-bold">Full Name *</span>
            <Input
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              className="bg-white"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-bold">Email *</span>
            <Input
              value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
              className="bg-white"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-bold">Phone</span>
            <Input
              value={form.phone}
              onChange={e => setForm({ ...form, phone: e.target.value })}
              className="bg-white"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-bold">Date of Birth</span>
            <Input
              type="date"
              value={form.dateOfBirth}
              onChange={e => setForm({ ...form, dateOfBirth: e.target.value })}
              className="bg-white"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-bold">Emergency Contact</span>
            <Input
              value={form.emergencyContact}
              onChange={e =>
                setForm({ ...form, emergencyContact: e.target.value })
              }
              className="bg-white"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-bold">Address</span>
            <Input
              value={form.address}
              onChange={e => setForm({ ...form, address: e.target.value })}
              className="bg-white"
            />
          </label>
        </div>
      </section>
      <section>
        <h4 className="text-xs font-extrabold uppercase tracking-[0.1em] text-[#A83825]">
          Employment
        </h4>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs font-bold">Employment Type</span>
            <Select
              value={form.employmentType}
              onValueChange={v =>
                setForm({ ...form, employmentType: v as any })
              }
            >
              <SelectTrigger className="bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full_time">Full Time</SelectItem>
                <SelectItem value="part_time">Part Time</SelectItem>
                <SelectItem value="contract">Contract</SelectItem>
                <SelectItem value="temporary">Temporary</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-bold">Joining Date</span>
            <Input
              type="date"
              value={form.joiningDate}
              onChange={e => setForm({ ...form, joiningDate: e.target.value })}
              className="bg-white"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-bold">Role *</span>
            <Select
              value={form.role}
              onValueChange={v => setForm({ ...form, role: v as any })}
            >
              <SelectTrigger className="bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="staff">Staff</SelectItem>
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="owner">Owner</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-bold">Manager</span>
            <Select
              value={form.managerId}
              onValueChange={v => setForm({ ...form, managerId: v })}
            >
              <SelectTrigger className="bg-white">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                {(managers.data?.items ?? []).map((m: any) => (
                  <SelectItem key={m.id} value={String(m.id)}>
                    {m.name} — {m.role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
      </section>
      <section>
        <h4 className="text-xs font-extrabold uppercase tracking-[0.1em] text-[#A83825]">
          Outlet Assignment
        </h4>
        <div className="mt-2 grid gap-3">
          <label className="space-y-1">
            <span className="text-xs font-bold">Primary Outlet *</span>
            <Select
              value={form.primaryOutletId}
              onValueChange={v => setForm({ ...form, primaryOutletId: v })}
            >
              <SelectTrigger className="bg-white">
                <SelectValue placeholder="Select outlet" />
              </SelectTrigger>
              <SelectContent>
                {(outlets.data?.items ?? []).map((o: any) => (
                  <SelectItem key={o.id} value={String(o.id)}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <div>
            <span className="text-xs font-bold">
              Additional Allowed Outlets
            </span>
            <div className="scrollbar-none mt-1 max-h-24 overflow-y-auto rounded-md border bg-white p-2">
              {(outlets.data?.items ?? []).map((o: any) => (
                <label key={o.id} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={form.additionalOutlets.includes(o.id)}
                    onChange={e =>
                      setForm({
                        ...form,
                        additionalOutlets: e.target.checked
                          ? [...form.additionalOutlets, o.id]
                          : form.additionalOutlets.filter(id => id !== o.id),
                      })
                    }
                  />
                  {o.name}
                </label>
              ))}
            </div>
          </div>
        </div>
      </section>
    </FormDialog>
  );
}

function StaffProfile({ id, onBack }: { id: number; onBack: () => void }) {
  const q = trpc.staff.byId.useQuery({ id });
  const [tab, setTab] = useState<
    | "overview"
    | "employment"
    | "attendance"
    | "schedule"
    | "leave"
    | "activity"
    | "performance"
    | "permissions"
  >("overview");
  const setStatus = trpc.staff.setStatus.useMutation({
    onSuccess: () => {
      toast.success("Status updated");
      void q.refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const changeRole = trpc.staff.changeRole.useMutation({
    onSuccess: () => {
      toast.success("Role changed");
      void q.refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const [roleChange, setRoleChange] = useState("");
  if (q.isLoading)
    return (
      <div className="grid min-h-[240px] place-items-center rounded-[14px] border border-dashed border-[#D5C8BA] bg-[#FCFAF6]">
        <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
      </div>
    );
  if (q.isError || !q.data)
    return (
      <div className="rounded-[14px] border border-[#F1C9BD] bg-[#FFF8F5] p-5 text-sm">
        Staff not found{" "}
        <Button variant="outline" className="ml-2 h-7 text-xs" onClick={onBack}>
          Back
        </Button>
      </div>
    );
  const { staff, outlets: outletIds, manager, outletName } = q.data as any;
  return (
    <>
      <Button variant="ghost" onClick={onBack} className="mb-4 px-0 text-xs">
        ← All Staff
      </Button>
      <section className="rounded-[14px] border border-[#D6CABD] bg-[#FCFAF6] p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-4">
            <div className="grid h-16 w-16 place-items-center rounded-full bg-[#EEE7DE] text-lg font-extrabold">
              {staff.name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <h2 className="text-2xl font-extrabold">{staff.name}</h2>
              <p className="font-mono text-xs text-[#8B7E71]">
                Employee ID: {staff.employeeId ?? "—"} • {staff.email} •{" "}
                {staff.phone ?? "—"}
              </p>
              <p className="mt-1 text-xs">
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${staffStatusMeta[staff.status]?.cls}`}
                >
                  {staffStatusMeta[staff.status]?.label ?? staff.status}
                </span>{" "}
                <span className="ml-2 text-xs">
                  Outlet: {outletName ?? "Unassigned"} • Role: {staff.role}
                </span>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setTab("employment")}
            >
              Edit
            </Button>
            <Select value={roleChange} onValueChange={setRoleChange}>
              <SelectTrigger className="h-7 w-[140px] bg-white text-xs">
                <SelectValue placeholder="Change Role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="staff">Staff</SelectItem>
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="owner">Owner</SelectItem>
              </SelectContent>
            </Select>
            <Button
              className="h-7 bg-[#211B18] text-xs text-white"
              disabled={!roleChange}
              onClick={() => changeRole.mutate({ id, role: roleChange as any })}
            >
              Apply Role
            </Button>
            <Button
              variant="outline"
              className="h-7 border-[#E8B9AC] text-xs text-[#A83825]"
              onClick={() => {
                if (confirm(`Suspend ${staff.name}? Access will be blocked.`))
                  setStatus.mutate({ id, status: "suspended" });
              }}
            >
              Suspend
            </Button>
            <Button
              variant="outline"
              className="h-7 border-[#F1C9BD] bg-white text-xs text-[#A83825]"
              onClick={() => {
                if (
                  confirm(
                    `Deactivate ${staff.name}? Employment history preserved, access revoked.`
                  )
                )
                  setStatus.mutate({ id, status: "inactive" });
              }}
            >
              Deactivate
            </Button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-1 rounded-xl border bg-[#EEE9E1] p-1">
          {(
            [
              "overview",
              "employment",
              "attendance",
              "schedule",
              "leave",
              "activity",
              "performance",
              "permissions",
            ] as const
          ).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold capitalize ${tab === t ? "bg-white shadow-sm" : "text-[#6C6055]"}`}
            >
              {t}
            </button>
          ))}
        </div>
      </section>
      <div className="mt-5">
        {tab === "overview" && <StaffOverviewTab staffId={id} />}
        {tab === "employment" && (
          <StaffEmploymentTab
            staff={staff}
            outletIds={outletIds}
            manager={manager}
            onSaved={() => void q.refetch()}
          />
        )}
        {tab === "attendance" && <StaffAttendanceTab staffId={id} />}
        {tab === "schedule" && <StaffScheduleTab staffId={id} />}
        {tab === "leave" && <StaffLeaveTab staffId={id} />}
        {tab === "activity" && <StaffActivityTab staffId={id} />}
        {tab === "performance" && <StaffPerformanceTab staffId={id} />}
        {tab === "permissions" && <StaffPermissionsTab staff={staff} />}
      </div>
    </>
  );
}

function StaffOverviewTab({ staffId }: { staffId: number }) {
  const q = trpc.staff.byId.useQuery({ id: staffId });
  const att = trpc.staff.attendance.list.useQuery({ staffId, limit: 5 });
  const leaves = trpc.staff.leave.list.useQuery({ staffId });
  if (q.isLoading)
    return (
      <div className="grid place-items-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
      </div>
    );
  if (q.isError || !(q.data as any)?.staff)
    return (
      <div className="rounded-[14px] border border-[#F1C9BD] bg-[#FFF8F5] p-5 text-sm">
        This staff profile could not be loaded.{" "}
        <Button
          variant="outline"
          className="ml-2 h-7 text-xs"
          onClick={() => q.refetch()}
        >
          Retry
        </Button>
      </div>
    );
  const s = (q.data as any).staff;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-[14px] border bg-[#FCFAF6] p-5">
        <h3 className="text-sm font-extrabold">Personal</h3>
        <p className="mt-2 text-xs">Phone: {s.phone ?? "—"}</p>
        <p className="text-xs">Email: {s.email}</p>
        <p className="text-xs">
          DOB: {s.dateOfBirth ? dateText(s.dateOfBirth) : "—"}
        </p>
        <p className="text-xs">Emergency: {s.emergencyContact ?? "—"}</p>
      </div>
      <div className="rounded-[14px] border bg-[#FCFAF6] p-5">
        <h3 className="text-sm font-extrabold">Employment</h3>
        <p className="mt-2 text-xs">
          Type: {employmentLabels[s.employmentType] ?? s.employmentType}
        </p>
        <p className="text-xs">
          Joined:{" "}
          {s.joiningDate ? dateText(s.joiningDate) : dateText(s.createdAt)}
        </p>
        <p className="text-xs">Status: {s.status}</p>
      </div>
      <div className="rounded-[14px] border bg-[#FCFAF6] p-5">
        <h3 className="text-sm font-extrabold">Recent Attendance</h3>
        {!att.data?.items.length ? (
          <p className="mt-2 text-xs text-[#8B7E71]">No records.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-xs">
            {att.data.items.slice(0, 3).map((a: any) => (
              <li key={a.id} className="flex justify-between">
                <span>
                  {a.date} {a.status}
                </span>
                <span>
                  {a.clockIn ? new Date(a.clockIn).toLocaleTimeString() : "—"} →{" "}
                  {a.clockOut ? new Date(a.clockOut).toLocaleTimeString() : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="rounded-[14px] border bg-[#FCFAF6] p-5">
        <h3 className="text-sm font-extrabold">Leave</h3>
        <p className="mt-2 text-xs">
          {leaves.data?.length ?? 0} requests • Pending{" "}
          {leaves.data?.filter((l: any) => l.status === "pending").length ?? 0}
        </p>
      </div>
    </div>
  );
}
function StaffEmploymentTab({
  staff,
  outletIds,
  manager,
  onSaved,
}: {
  staff: any;
  outletIds: number[];
  manager: any;
  onSaved: () => void;
}) {
  const outlets = trpc.outlets.list.useQuery({ limit: 100 } as any);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({
    name: staff.name,
    phone: staff.phone ?? "",
    employmentType: staff.employmentType,
    joiningDate: staff.joiningDate
      ? new Date(staff.joiningDate).toISOString().slice(0, 10)
      : "",
    managerId: staff.managerId ? String(staff.managerId) : "",
    address: staff.address ?? "",
    emergencyContact: staff.emergencyContact ?? "",
    dateOfBirth: staff.dateOfBirth
      ? new Date(staff.dateOfBirth).toISOString().slice(0, 10)
      : "",
  });
  const update = trpc.staff.update.useMutation({
    onSuccess: () => {
      toast.success("Employment updated");
      setEdit(false);
      onSaved();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const assign = trpc.staff.assignOutlet.useMutation({
    onSuccess: () => {
      toast.success("Outlet assigned");
      onSaved();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const [primaryOutlet, setPrimaryOutlet] = useState(
    staff.primaryOutletId ? String(staff.primaryOutletId) : ""
  );
  return (
    <div className="space-y-4">
      <div className="rounded-[14px] border bg-[#FCFAF6] p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-extrabold">Employment Information</h3>
          <Button
            variant="outline"
            className="h-7 text-xs"
            onClick={() => setEdit(!edit)}
          >
            {edit ? "Cancel" : "Edit"}
          </Button>
        </div>
        {!edit ? (
          <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#8B7E71]">
                Employee ID
              </dt>
              <dd className="font-bold">{staff.employeeId}</dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#8B7E71]">
                Role
              </dt>
              <dd className="font-bold">{staff.role}</dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#8B7E71]">
                Employment Type
              </dt>
              <dd>{employmentLabels[staff.employmentType]}</dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#8B7E71]">
                Joining Date
              </dt>
              <dd>
                {staff.joiningDate
                  ? new Date(staff.joiningDate).toLocaleDateString()
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#8B7E71]">
                Manager
              </dt>
              <dd>{manager?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#8B7E71]">
                Status
              </dt>
              <dd>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${staffStatusMeta[staff.status]?.cls}`}
                >
                  {staffStatusMeta[staff.status]?.label}
                </span>
              </dd>
            </div>
          </dl>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-bold">Full Name</span>
              <Input
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                className="bg-white"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-bold">Phone</span>
              <Input
                value={form.phone}
                onChange={e => setForm({ ...form, phone: e.target.value })}
                className="bg-white"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-bold">Employment Type</span>
              <Select
                value={form.employmentType}
                onValueChange={v =>
                  setForm({ ...form, employmentType: v as any })
                }
              >
                <SelectTrigger className="bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full_time">Full Time</SelectItem>
                  <SelectItem value="part_time">Part Time</SelectItem>
                  <SelectItem value="contract">Contract</SelectItem>
                  <SelectItem value="temporary">Temporary</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-bold">Joining Date</span>
              <Input
                type="date"
                value={form.joiningDate}
                onChange={e =>
                  setForm({ ...form, joiningDate: e.target.value })
                }
                className="bg-white"
              />
            </label>
            <Button
              className="col-span-2 bg-[#211B18] text-white"
              onClick={() =>
                update.mutate({
                  id: staff.id,
                  name: form.name,
                  phone: form.phone || null,
                  employmentType: form.employmentType as any,
                  joiningDate: form.joiningDate || null,
                  address: form.address || null,
                  emergencyContact: form.emergencyContact || null,
                  dateOfBirth: form.dateOfBirth || null,
                  managerId: form.managerId ? Number(form.managerId) : null,
                } as any)
              }
            >
              Save
            </Button>
          </div>
        )}
      </div>
      <div className="rounded-[14px] border bg-[#FCFAF6] p-5">
        <h3 className="text-sm font-extrabold">Outlet Assignment</h3>
        <p className="mt-1 text-xs text-[#8B7E71]">
          Primary + additional allowed outlets. Permissions + outlet scope both
          evaluated.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <Select value={primaryOutlet} onValueChange={setPrimaryOutlet}>
            <SelectTrigger className="h-9 w-[200px] bg-white text-xs">
              <SelectValue placeholder="Primary outlet" />
            </SelectTrigger>
            <SelectContent>
              {(outlets.data?.items ?? []).map((o: any) => (
                <SelectItem key={o.id} value={String(o.id)}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            className="h-9 bg-[#211B18] text-xs text-white"
            onClick={() =>
              assign.mutate({
                id: staff.id,
                primaryOutletId: primaryOutlet ? Number(primaryOutlet) : null,
              })
            }
          >
            Save Primary
          </Button>
        </div>
        <p className="mt-2 text-xs">
          Additional: {outletIds.length ? outletIds.join(", ") : "None"} • Use
          edit to manage via API (additionalOutlets array).
        </p>
      </div>
    </div>
  );
}
function StaffAttendanceTab({ staffId }: { staffId: number }) {
  const q = trpc.staff.attendance.list.useQuery({ staffId, limit: 20 });
  const clockIn = trpc.staff.attendance.clockIn.useMutation({
    onSuccess: () => {
      toast.success("Clocked in");
      void q.refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const clockOut = trpc.staff.attendance.clockOut.useMutation({
    onSuccess: () => {
      toast.success("Clocked out");
      void q.refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const breakToggle = trpc.staff.attendance.breakToggle.useMutation({
    onSuccess: () => void q.refetch(),
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button
          className="bg-[#2F6947] text-white"
          onClick={() => clockIn.mutate({ staffId })}
        >
          <LogIn className="mr-1 h-4 w-4" />
          Clock In
        </Button>
        <Button
          variant="outline"
          onClick={() => breakToggle.mutate({ staffId, type: "break_start" })}
        >
          Break Start
        </Button>
        <Button
          variant="outline"
          onClick={() => breakToggle.mutate({ staffId, type: "break_end" })}
        >
          Break End
        </Button>
        <Button
          className="bg-[#211B18] text-white"
          onClick={() => clockOut.mutate({ staffId })}
        >
          <LogOut className="mr-1 h-4 w-4" />
          Clock Out
        </Button>
      </div>
      {q.isLoading ? (
        <div className="grid place-items-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
        </div>
      ) : q.isError ? (
        <p className="text-center text-xs text-[#B83D29]">
          Could not load attendance.{" "}
          <button className="underline" onClick={() => q.refetch()}>
            Retry
          </button>
        </p>
      ) : !q.data?.items.length ? (
        <p className="text-center text-xs text-[#8B7E71]">
          No attendance records.
        </p>
      ) : (
        <div className="overflow-hidden rounded-[14px] border bg-[#FCFAF6]">
          <div className="overflow-x-auto">
            <table className="min-w-[700px] w-full text-left">
              <thead className="border-b bg-[#F7F2EB]">
                <tr>
                  {["Date", "Clock In", "Clock Out", "Hours", "Status"].map(
                    h => (
                      <th
                        key={h}
                        className="px-3 py-2 font-mono text-[9px] uppercase tracking-[0.11em] text-[#8B7E71]"
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody className="divide-y">
                {q.data.items.map((a: any) => (
                  <tr key={a.id} className="text-xs">
                    <td className="px-3 py-2">{a.date}</td>
                    <td className="px-3 py-2">
                      {a.clockIn
                        ? new Date(a.clockIn).toLocaleTimeString()
                        : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {a.clockOut
                        ? new Date(a.clockOut).toLocaleTimeString()
                        : "—"}
                    </td>
                    <td className="px-3 py-2">{a.totalHours ?? "—"}</td>
                    <td className="px-3 py-2">
                      <Badge className="text-[10px]">{a.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
function StaffScheduleTab({ staffId }: { staffId: number }) {
  const list = trpc.staff.schedules.list.useQuery({} as any);
  const my = (list.data ?? []).filter((s: any) => s.staffId === staffId);
  return (
    <div>
      {!my.length ? (
        <p className="text-center text-xs text-[#8B7E71]">
          No schedules. Assign via Shifts & Schedule.
        </p>
      ) : (
        <ul className="space-y-2">
          {my.map((s: any) => (
            <li
              key={s.id}
              className="flex justify-between rounded-xl border bg-white p-3 text-xs"
            >
              <span>
                {s.date} {s.shiftName} {s.shiftStart}-{s.shiftEnd}
              </span>
              <span>{s.outletName}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
function StaffLeaveTab({ staffId }: { staffId: number }) {
  const q = trpc.staff.leave.list.useQuery({ staffId });
  const create = trpc.staff.leave.create.useMutation({
    onSuccess: () => {
      toast.success("Leave requested");
      void q.refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const [form, setForm] = useState({
    leaveType: "casual" as any,
    startDate: "",
    endDate: "",
    reason: "",
  });
  return (
    <div className="space-y-3">
      <div className="rounded-[14px] border bg-[#FCFAF6] p-4">
        <h4 className="text-xs font-extrabold">Request Leave</h4>
        <div className="mt-2 grid gap-2 sm:grid-cols-4">
          <Select
            value={form.leaveType}
            onValueChange={v => setForm({ ...form, leaveType: v as any })}
          >
            <SelectTrigger className="bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="casual">Casual</SelectItem>
              <SelectItem value="sick">Sick</SelectItem>
              <SelectItem value="emergency">Emergency</SelectItem>
              <SelectItem value="unpaid">Unpaid</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={form.startDate}
            onChange={e => setForm({ ...form, startDate: e.target.value })}
            className="bg-white"
          />
          <Input
            type="date"
            value={form.endDate}
            onChange={e => setForm({ ...form, endDate: e.target.value })}
            className="bg-white"
          />
          <Input
            placeholder="Reason"
            value={form.reason}
            onChange={e => setForm({ ...form, reason: e.target.value })}
            className="bg-white"
          />
        </div>
        <Button
          className="mt-3 bg-[#211B18] text-white"
          onClick={() => {
            if (!form.startDate || !form.endDate)
              return toast.error("Dates required");
            create.mutate({
              staffId,
              leaveType: form.leaveType,
              startDate: form.startDate,
              endDate: form.endDate,
              reason: form.reason || null,
            } as any);
          }}
        >
          Submit
        </Button>
      </div>
      {q.isLoading ? (
        <div className="grid place-items-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
        </div>
      ) : q.isError ? (
        <p className="text-center text-xs text-[#B83D29]">
          Could not load leave requests.{" "}
          <button className="underline" onClick={() => q.refetch()}>
            Retry
          </button>
        </p>
      ) : !q.data?.length ? (
        <p className="text-center text-xs text-[#8B7E71]">No leave requests.</p>
      ) : (
        <ul className="space-y-2">
          {q.data.map((l: any) => (
            <li
              key={l.id}
              className="flex justify-between rounded-xl border bg-white p-3 text-xs"
            >
              <span>
                {l.leaveType} {l.startDate} → {l.endDate}
              </span>
              <Badge
                className={
                  l.status === "pending"
                    ? "bg-[#FBF0D5] text-[#8A5D10]"
                    : l.status === "approved"
                      ? "bg-[#E5F2E9] text-[#2F6947]"
                      : "bg-[#F6F0E8]"
                }
              >
                {l.status}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
function StaffActivityTab({ staffId }: { staffId: number }) {
  const q = trpc.staff.activity.useQuery({ staffId, limit: 20 });
  if (q.isLoading)
    return (
      <div className="grid place-items-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
      </div>
    );
  if (q.isError)
    return (
      <p className="text-center text-xs text-[#B83D29]">
        Could not load activity.{" "}
        <button className="underline" onClick={() => q.refetch()}>
          Retry
        </button>
      </p>
    );
  if (!q.data?.length)
    return <p className="text-center text-xs text-[#8B7E71]">No activity.</p>;
  return (
    <ul className="space-y-2">
      {q.data.map((a: any) => (
        <li key={a.id} className="rounded-xl border bg-white p-3">
          <p className="text-xs font-bold">
            {a.action} — {a.entityType} #{a.entityId ?? ""}
          </p>
          <p className="text-[11px] text-[#8B7E71]">
            {dateTimeText(a.createdAt)} • {a.staffName}
          </p>
        </li>
      ))}
    </ul>
  );
}
function StaffPerformanceTab({ staffId }: { staffId: number }) {
  const q = trpc.staff.performance.useQuery({ staffId });
  if (q.isLoading)
    return (
      <div className="grid place-items-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
      </div>
    );
  if (q.isError)
    return (
      <p className="text-center text-xs text-[#B83D29]">
        Could not load performance.{" "}
        <button className="underline" onClick={() => q.refetch()}>
          Retry
        </button>
      </p>
    );
  const d = q.data?.[0];
  if (!d)
    return (
      <p className="text-center text-xs text-[#8B7E71]">No performance data.</p>
    );
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl border bg-[#FCFAF6] p-4 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#8B7E71]">
          Attendance Rate
        </p>
        <p className="mt-1 text-xl font-extrabold">
          {d.attendanceRate.toFixed(1)}%
        </p>
      </div>
      <div className="rounded-xl border bg-[#FCFAF6] p-4 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#8B7E71]">
          On-Time Rate
        </p>
        <p className="mt-1 text-xl font-extrabold">
          {d.onTimeRate.toFixed(1)}%
        </p>
      </div>
      <div className="rounded-xl border bg-[#FCFAF6] p-4 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#8B7E71]">
          Orders Processed
        </p>
        <p className="mt-1 text-xl font-extrabold">{d.ordersProcessed}</p>
      </div>
    </div>
  );
}
function StaffPermissionsTab({ staff }: { staff: any }) {
  return (
    <div className="rounded-[14px] border bg-[#FCFAF6] p-5">
      <h3 className="text-sm font-extrabold">Permissions</h3>
      <p className="mt-2 text-xs">
        Role <span className="font-bold">{staff.role}</span> — permissions
        derived from role. Outlet scope:{" "}
        {staff.primaryOutletId
          ? `Outlet #${staff.primaryOutletId}`
          : "Global (Super Admin)"}
        .
      </p>
      <p className="mt-2 text-xs text-[#8B7E71]">
        Manage via Roles & Permissions. Outlet-scoped permissions require both
        permission and outlet scope.
      </p>
    </div>
  );
}
function RolesView() {
  const roles = trpc.staff.roles.list.useQuery();
  const perms = trpc.staff.roles.permissions.useQuery();
  const matrix = trpc.staff.roles.matrix.useQuery();
  if (roles.isLoading || perms.isLoading)
    return (
      <div className="grid place-items-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
      </div>
    );
  const matrixData = (matrix.data as any) ?? { matrix: [] };
  const permList = (perms.data as any) ?? [];
  const roleList = (roles.data as any) ?? [];
  return (
    <div className="space-y-4">
      <div className="rounded-[14px] border bg-[#FCFAF6] p-5">
        <h3 className="text-sm font-extrabold">Roles</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {roleList.map((r: any) => (
            <span
              key={r.id}
              className="rounded-full border bg-white px-3 py-1 text-xs font-bold"
            >
              {r.name}{" "}
              <span className="font-mono text-[10px] text-[#8B7E71]">
                {r.slug}
              </span>
            </span>
          ))}
        </div>
      </div>
      <div className="overflow-hidden rounded-[14px] border bg-[#FCFAF6]">
        <div className="overflow-x-auto">
          <table className="min-w-[700px] w-full text-left">
            <thead className="border-b bg-[#F7F2EB]">
              <tr>
                <th className="px-3 py-2 font-mono text-[9px] uppercase tracking-[0.11em] text-[#8B7E71]">
                  Permission
                </th>
                {roleList.map((r: any) => (
                  <th
                    key={r.id}
                    className="px-3 py-2 text-center font-mono text-[9px] uppercase tracking-[0.11em] text-[#8B7E71]"
                  >
                    {r.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {permList.map((p: any) => (
                <tr key={p.key}>
                  <td className="px-3 py-2 text-xs font-bold">
                    {p.key}
                    <span className="ml-2 text-[10px] font-normal text-[#8B7E71]">
                      {p.category}
                    </span>
                  </td>
                  {roleList.map((r: any) => {
                    const has = (matrixData.matrix as any[]).some(
                      (m: any) =>
                        String(m.roleId) === String(r.id) &&
                        m.permissionKey === p.key
                    );
                    return (
                      <td key={r.id} className="px-3 py-2 text-center text-xs">
                        {has ? "✓" : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
function AttendanceView() {
  const { selectedId: outletId } = useOutlet();
  const q = trpc.staff.attendance.list.useQuery(
    outletId ? { outletId, limit: 20 } : { limit: 20 }
  );
  const today = trpc.staff.attendance.today.useQuery(
    outletId ? { outletId } : undefined
  );
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-xl border bg-[#FCFAF6] p-4 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#8B7E71]">
            Expected
          </p>
          <p className="text-xl font-extrabold">{today.data?.expected ?? 0}</p>
        </div>
        <div className="rounded-xl border bg-[#FCFAF6] p-4 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#8B7E71]">
            Present
          </p>
          <p className="text-xl font-extrabold text-[#2F6947]">
            {today.data?.present ?? 0}
          </p>
        </div>
        <div className="rounded-xl border bg-[#FCFAF6] p-4 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#8B7E71]">
            Late
          </p>
          <p className="text-xl font-extrabold text-[#8A5D10]">
            {today.data?.late ?? 0}
          </p>
        </div>
        <div className="rounded-xl border bg-[#FCFAF6] p-4 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#8B7E71]">
            Absent
          </p>
          <p className="text-xl font-extrabold text-[#A83825]">
            {today.data?.absent ?? 0}
          </p>
        </div>
      </div>
      {q.isLoading ? (
        <div className="grid place-items-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
        </div>
      ) : q.isError ? (
        <p className="text-center text-xs text-[#B83D29]">
          Could not load attendance.{" "}
          <button className="underline" onClick={() => q.refetch()}>
            Retry
          </button>
        </p>
      ) : !q.data?.items.length ? (
        <p className="text-center text-xs text-[#8B7E71]">
          No attendance records.
        </p>
      ) : (
        <div className="overflow-hidden rounded-[14px] border bg-[#FCFAF6]">
          <div className="overflow-x-auto">
            <table className="min-w-[800px] w-full text-left">
              <thead className="border-b bg-[#F7F2EB]">
                <tr>
                  {[
                    "Staff",
                    "Outlet",
                    "Date",
                    "Clock In",
                    "Clock Out",
                    "Hours",
                    "Status",
                  ].map(h => (
                    <th
                      key={h}
                      className="px-3 py-2 font-mono text-[9px] uppercase tracking-[0.11em] text-[#8B7E71]"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {q.data.items.map((a: any) => (
                  <tr key={a.id} className="text-xs">
                    <td className="px-3 py-2 font-bold">
                      {a.staffName ?? `Staff #${a.staffId}`}
                    </td>
                    <td className="px-3 py-2">
                      {a.outletName ??
                        (a.outletId ? `Outlet #${a.outletId}` : "—")}
                    </td>
                    <td className="px-3 py-2">{a.date}</td>
                    <td className="px-3 py-2">
                      {a.clockIn
                        ? new Date(a.clockIn).toLocaleTimeString()
                        : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {a.clockOut
                        ? new Date(a.clockOut).toLocaleTimeString()
                        : "—"}
                    </td>
                    <td className="px-3 py-2">{a.totalHours ?? "—"}</td>
                    <td className="px-3 py-2">
                      <Badge className="text-[10px]">{a.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
function ShiftsView() {
  const { selectedId: outletId } = useOutlet();
  const templates = trpc.staff.shiftTemplates.list.useQuery(
    outletId ? { outletId } : undefined
  );
  const schedules = trpc.staff.schedules.list.useQuery(
    outletId ? { outletId } : undefined
  );
  const staffList = trpc.staff.list.useQuery({ limit: 100 } as any);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    startTime: "09:00",
    endTime: "17:00",
    outletId: outletId ? String(outletId) : "",
  });
  const createTemplate = trpc.staff.shiftTemplates.create.useMutation({
    onSuccess: () => {
      toast.success("Shift created");
      setCreateOpen(false);
      void templates.refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const [assign, setAssign] = useState({
    staffId: "",
    date: new Date().toISOString().slice(0, 10),
    shiftTemplateId: "",
  });
  const assignMut = trpc.staff.schedules.assign.useMutation({
    onSuccess: () => {
      toast.success("Shift assigned");
      void schedules.refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const removeScheduleMut = trpc.staff.schedules.remove.useMutation({
    onSuccess: () => {
      toast.success("Assignment removed");
      void schedules.refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-extrabold">Shift Templates</h3>
        <Button
          onClick={() => setCreateOpen(true)}
          className="bg-[#211B18] text-xs text-white"
        >
          <Plus className="mr-1 h-4 w-4" />
          Create shift
        </Button>
      </div>
      {templates.isLoading ? (
        <div className="grid place-items-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
        </div>
      ) : templates.isError ? (
        <p className="text-center text-xs text-[#B83D29]">
          Could not load shifts.{" "}
          <button className="underline" onClick={() => templates.refetch()}>
            Retry
          </button>
        </p>
      ) : !templates.data?.length ? (
        <p className="text-center text-xs text-[#8B7E71]">
          No shifts. Create Morning 09:00-17:00 etc.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {templates.data.map((t: any) => (
            <span
              key={t.id}
              className="rounded-full border bg-white px-3 py-1 text-xs font-bold"
              style={{ borderColor: t.color }}
            >
              {t.name} {t.startTime}–{t.endTime}{" "}
              {t.outletId ? `• Outlet #${t.outletId}` : ""}
            </span>
          ))}
        </div>
      )}
      <div className="rounded-[14px] border bg-[#FCFAF6] p-4">
        <h4 className="text-xs font-extrabold">Assign Staff</h4>
        <div className="mt-2 grid gap-2 sm:grid-cols-4">
          <Select
            value={assign.staffId}
            onValueChange={v => setAssign({ ...assign, staffId: v })}
          >
            <SelectTrigger className="bg-white">
              <SelectValue placeholder="Staff" />
            </SelectTrigger>
            <SelectContent>
              {(staffList.data?.items ?? []).map((s: any) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={assign.date}
            onChange={e => setAssign({ ...assign, date: e.target.value })}
            className="bg-white"
          />
          <Select
            value={assign.shiftTemplateId}
            onValueChange={v => setAssign({ ...assign, shiftTemplateId: v })}
          >
            <SelectTrigger className="bg-white">
              <SelectValue placeholder="Shift" />
            </SelectTrigger>
            <SelectContent>
              {(templates.data ?? []).map((t: any) => (
                <SelectItem key={t.id} value={String(t.id)}>
                  {t.name} {t.startTime}-{t.endTime}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            className="bg-[#211B18] text-white"
            onClick={() => {
              if (!assign.staffId || !assign.shiftTemplateId || !assign.date)
                return toast.error("Fill staff, date, shift");
              const staffId = Number(assign.staffId);
              const outletForStaff =
                (
                  staffList.data?.items.find(
                    (s: any) => s.id === staffId
                  ) as any
                )?.primaryOutletId ?? outletId;
              if (!outletForStaff) return toast.error("Staff has no outlet");
              assignMut.mutate({
                staffId,
                outletId: outletForStaff,
                date: assign.date,
                shiftTemplateId: Number(assign.shiftTemplateId),
              });
            }}
          >
            Assign
          </Button>
        </div>
      </div>
      <div className="rounded-[14px] border bg-[#FCFAF6] p-4">
        <h4 className="text-xs font-extrabold">Schedule</h4>
        {!schedules.data?.length ? (
          <p className="mt-2 text-center text-xs text-[#8B7E71]">
            No schedules.
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {schedules.data.map((s: any) => (
              <li
                key={s.id}
                className="flex justify-between rounded-xl border bg-white p-2 text-xs"
              >
                <span>
                  {s.date} {s.staffName} {s.shiftName} {s.shiftStart}-
                  {s.shiftEnd} {s.outletName}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  disabled={removeScheduleMut.isPending}
                  onClick={() => {
                    if (confirm("Remove assignment?"))
                      removeScheduleMut.mutate({ id: s.id });
                  }}
                >
                  <UserX className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <FormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Create shift"
        description="A named time window shifts can be scheduled against."
        onSubmit={event => {
          event.preventDefault();
          if (!form.name.trim()) return toast.error("Name required");
          createTemplate.mutate({
            name: form.name.trim(),
            startTime: form.startTime,
            endTime: form.endTime,
            outletId: form.outletId ? Number(form.outletId) : null,
          });
        }}
        submitLabel="Create"
        submitPending={createTemplate.isPending}
        formClassName="grid gap-3"
      >
        <label className="space-y-1">
          <span className="text-xs font-bold">Name</span>
          <Input
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder="Morning"
            className="bg-white"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-bold">Start</span>
          <Input
            type="time"
            value={form.startTime}
            onChange={e => setForm({ ...form, startTime: e.target.value })}
            className="bg-white"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-bold">End</span>
          <Input
            type="time"
            value={form.endTime}
            onChange={e => setForm({ ...form, endTime: e.target.value })}
            className="bg-white"
          />
        </label>
      </FormDialog>
    </div>
  );
}
function LeaveView() {
  const q = trpc.staff.leave.list.useQuery({});
  const review = trpc.staff.leave.review.useMutation({
    onSuccess: () => {
      toast.success("Leave updated");
      void q.refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <div className="space-y-3">
      {q.isLoading ? (
        <div className="grid place-items-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
        </div>
      ) : q.isError ? (
        <p className="text-center text-xs text-[#B83D29]">
          Could not load leave requests.{" "}
          <button className="underline" onClick={() => q.refetch()}>
            Retry
          </button>
        </p>
      ) : !q.data?.length ? (
        <p className="text-center text-xs text-[#8B7E71]">No leave requests.</p>
      ) : (
        <div className="overflow-hidden rounded-[14px] border bg-[#FCFAF6]">
          <div className="overflow-x-auto">
            <table className="min-w-[700px] w-full text-left">
              <thead className="border-b bg-[#F7F2EB]">
                <tr>
                  {[
                    "Staff",
                    "Type",
                    "Dates",
                    "Reason",
                    "Status",
                    "Actions",
                  ].map(h => (
                    <th
                      key={h}
                      className="px-3 py-2 font-mono text-[9px] uppercase tracking-[0.11em] text-[#8B7E71]"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {q.data.map((l: any) => (
                  <tr key={l.id} className="text-xs">
                    <td className="px-3 py-2 font-bold">
                      {l.staffName ?? `Staff #${l.staffId}`}
                    </td>
                    <td className="px-3 py-2">{l.leaveType}</td>
                    <td className="px-3 py-2">
                      {l.startDate} → {l.endDate}
                    </td>
                    <td className="px-3 py-2 max-w-[200px] truncate">
                      {l.reason ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        className={
                          l.status === "pending"
                            ? "bg-[#FBF0D5] text-[#8A5D10]"
                            : l.status === "approved"
                              ? "bg-[#E5F2E9] text-[#2F6947]"
                              : "bg-[#F6F0E8]"
                        }
                      >
                        {l.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 flex gap-1">
                      {l.status === "pending" && (
                        <>
                          <Button
                            className="h-7 bg-[#2F6947] px-2 text-[10px] text-white"
                            onClick={() =>
                              review.mutate({ id: l.id, status: "approved" })
                            }
                          >
                            Approve
                          </Button>
                          <Button
                            variant="outline"
                            className="h-7 px-2 text-[10px]"
                            onClick={() =>
                              review.mutate({ id: l.id, status: "rejected" })
                            }
                          >
                            Reject
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
function PerformanceView() {
  const q = trpc.staff.performance.useQuery({});
  if (q.isLoading)
    return (
      <div className="grid place-items-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
      </div>
    );
  if (q.isError)
    return (
      <p className="text-center text-xs text-[#B83D29]">
        Could not load performance.{" "}
        <button className="underline" onClick={() => q.refetch()}>
          Retry
        </button>
      </p>
    );
  if (!q.data?.length)
    return (
      <p className="text-center text-xs text-[#8B7E71]">No performance data.</p>
    );
  return (
    <div className="overflow-hidden rounded-[14px] border bg-[#FCFAF6]">
      <div className="overflow-x-auto">
        <table className="min-w-[700px] w-full text-left">
          <thead className="border-b bg-[#F7F2EB]">
            <tr>
              {["Staff", "Role", "Attendance", "On-Time", "Orders"].map(h => (
                <th
                  key={h}
                  className="px-3 py-2 font-mono text-[9px] uppercase tracking-[0.11em] text-[#8B7E71]"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {q.data.map((p: any) => (
              <tr key={p.staffId} className="text-xs">
                <td className="px-3 py-2 font-bold">{p.name}</td>
                <td className="px-3 py-2">{p.role}</td>
                <td className="px-3 py-2">{p.attendanceRate.toFixed(1)}%</td>
                <td className="px-3 py-2">{p.onTimeRate.toFixed(1)}%</td>
                <td className="px-3 py-2">{p.ordersProcessed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function ActivityView() {
  const q = trpc.staff.activity.useQuery({ limit: 20 });
  if (q.isLoading)
    return (
      <div className="grid place-items-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-[#E2533C]" />
      </div>
    );
  if (q.isError)
    return (
      <p className="text-center text-xs text-[#B83D29]">
        Could not load activity.{" "}
        <button className="underline" onClick={() => q.refetch()}>
          Retry
        </button>
      </p>
    );
  if (!q.data?.length)
    return <p className="text-center text-xs text-[#8B7E71]">No activity.</p>;
  return (
    <ul className="space-y-2">
      {q.data.map((a: any) => (
        <li key={a.id} className="rounded-xl border bg-white p-3">
          <p className="text-xs font-bold">
            {a.staffName} — {a.action} {a.entityType} #{a.entityId ?? ""}
          </p>
          <p className="text-[11px] text-[#8B7E71]">
            {dateTimeText(a.createdAt)} • Outlet {a.outletId ?? "—"}
          </p>
        </li>
      ))}
    </ul>
  );
}
