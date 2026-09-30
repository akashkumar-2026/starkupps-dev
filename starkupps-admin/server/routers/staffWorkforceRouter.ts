import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  assertOutletAccess,
  escapePostgrestOr,
  getOutletScope,
  hasPermission,
  invalidateAuthMemo,
  recordAudit,
  resolveStaffRole,
} from "../db/index";
import { protectedProcedure, router } from "../lib/trpc";
import { getSupabaseAdmin, getSql } from "../db/supabase";

const staffRoleSchema = z.enum(["owner", "manager", "staff"]);
const employmentTypeSchema = z.enum([
  "full_time",
  "part_time",
  "contract",
  "temporary",
]);
const staffStatusSchema = z.enum([
  "pending",
  "active",
  "inactive",
  "suspended",
  "on_leave",
  "terminated",
]);

async function need(user: any, perm: any) {
  const r = await resolveStaffRole(user);
  if (!r || !hasPermission(r, perm))
    throw new TRPCError({ code: "FORBIDDEN", message: "Access denied." });
  return r;
}

// Fail-closed target check: a scoped caller may only mutate a staff member
// who is linked to at least one outlet in the caller's scope (via
// primaryOutletId or outlet_staff). Owners (scope null) bypass.
async function assertStaffAccess(user: any, staffRow: any) {
  const scope = await getOutletScope(user);
  if (scope === null) return;
  const supabase = getSupabaseAdmin();
  const linked = new Set<number>();
  if (staffRow?.primaryOutletId) linked.add(Number(staffRow.primaryOutletId));
  try {
    const { data } = await supabase
      .from("outlet_staff")
      .select("outletId")
      .eq("staffId", staffRow.id);
    for (const r of (data ?? []) as any[])
      linked.add(Number((r as any).outletId));
  } catch {}
  for (const oid of Array.from(linked)) if (scope.includes(oid)) return;
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "You do not have access to this staff member.",
  });
}

function nextEmployeeId(existing: string[]): string {
  let max = 0;
  for (const id of existing) {
    const m = id.match(/SK-EMP-(\d+)/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `SK-EMP-${String(max + 1).padStart(4, "0")}`;
}

export const staffWorkforceRouter = router({
  // Overview KPI
  overview: protectedProcedure
    .input(
      z.object({ outletId: z.number().int().positive().optional() }).nullish()
    )
    .query(async ({ ctx, input }) => {
      await need(ctx.user, "staff.read");
      const supabase = getSupabaseAdmin();
      const scope = await getOutletScope(ctx.user);
      if (input?.outletId) await assertOutletAccess(ctx.user, input.outletId);

      // staff counts
      let allStaff: any[] = [];
      try {
        const { data, error } = await supabase.from("staff").select("*");
        if (error) throw error;
        allStaff = (data ?? []) as any[];
      } catch {
        allStaff = [];
      }

      let filtered = allStaff;
      if (input?.outletId) {
        let ids: number[] = [];
        try {
          const { data, error } = await supabase
            .from("outlet_staff")
            .select("staffId")
            .eq("outletId", input.outletId);
          if (error) throw error;
          ids = ((data ?? []) as any[]).map(x => x.staffId);
        } catch {
          ids = [];
        }
        filtered = allStaff.filter(
          (s: any) => s.primaryOutletId === input.outletId || ids.includes(s.id)
        );
      } else if (scope && scope.length) {
        let outletStaffMap: any[] = [];
        try {
          const { data, error } = await supabase
            .from("outlet_staff")
            .select("*");
          if (error) throw error;
          outletStaffMap = (data ?? []) as any[];
        } catch {
          outletStaffMap = [];
        }
        filtered = allStaff.filter((s: any) =>
          !s.primaryOutletId && outletStaffMap.length === 0
            ? true
            : (s.primaryOutletId && scope.includes(s.primaryOutletId)) ||
              outletStaffMap.some(
                (o: any) => o.staffId === s.id && scope.includes(o.outletId)
              )
        );
      }

      const total = filtered.length;
      const active = filtered.filter(
        (s: any) => s.status === "active" && s.active
      ).length;
      const inactive = filtered.filter(
        (s: any) => s.status === "inactive" || !s.active
      ).length;
      const suspended = filtered.filter(
        (s: any) => s.status === "suspended"
      ).length;

      const today = new Date().toISOString().slice(0, 10);
      let attToday: any[] = [];
      try {
        const { data, error } = await supabase
          .from("attendance_records")
          .select("*")
          .eq("date", today as any);
        if (error) throw error;
        attToday = (data ?? []) as any[];
      } catch {
        attToday = [];
      }

      if (input?.outletId)
        attToday = attToday.filter((a: any) => a.outletId === input.outletId);
      else if (scope && scope.length)
        attToday = attToday.filter(
          (a: any) => !a.outletId || scope.includes(a.outletId)
        );

      const present = attToday.filter((a: any) =>
        ["present", "late", "half_day"].includes(a.status)
      ).length;
      const late = attToday.filter((a: any) => a.status === "late").length;
      const absent = attToday.filter((a: any) => a.status === "absent").length;
      const onLeave = filtered.filter(
        (s: any) => s.status === "on_leave"
      ).length;
      const working = attToday.filter(
        (a: any) => a.clockIn && !a.clockOut
      ).length;
      const onBreak = attToday.filter(
        (a: any) => a.breakStart && !a.breakEnd && !a.clockOut
      ).length;

      // staff by outlet distribution
      let byOutlet: {
        outletId: number | null;
        outletName: string;
        count: number;
      }[] = [];
      try {
        const { data: outletsList } = await supabase
          .from("outlets")
          .select("*");
        const { data: allOutletStaffForOverview } = await supabase
          .from("outlet_staff")
          .select("*");
        const list = (outletsList ?? []) as any[];
        const allOS = (allOutletStaffForOverview ?? []) as any[];
        byOutlet = await Promise.all(
          list.map(async (o: any) => {
            if (scope && scope.length && !scope.includes(o.id)) return null;
            if (input?.outletId && o.id !== input.outletId) return null;
            const count = filtered.filter(
              (s: any) =>
                s.primaryOutletId === o.id ||
                allOS.some(
                  (os: any) => os.outletId === o.id && os.staffId === s.id
                )
            ).length;
            return { outletId: o.id, outletName: o.name, count };
          })
        ).then(r => r.filter(Boolean) as any);
      } catch {
        byOutlet = [];
      }

      // scheduled today
      let scheduledToday = 0;
      try {
        const { data, error } = await supabase
          .from("staff_schedules")
          .select("*")
          .eq("date", today as any);
        if (error) throw error;
        const schedules = (data ?? []) as any[];
        if (input?.outletId)
          scheduledToday = schedules.filter(
            (s: any) => s.outletId === input.outletId
          ).length;
        else if (scope && scope.length)
          scheduledToday = schedules.filter((s: any) =>
            scope.includes(s.outletId)
          ).length;
        else scheduledToday = schedules.length;
      } catch {}

      return {
        total,
        active,
        inactive,
        suspended,
        present,
        late,
        absent,
        onLeave,
        working,
        onBreak,
        scheduledToday,
        byOutlet,
      };
    }),

  // List with filters
  list: protectedProcedure
    .input(
      z
        .object({
          search: z.string().trim().max(80).optional(),
          outletId: z.number().int().positive().optional(),
          role: staffRoleSchema.optional(),
          employmentType: employmentTypeSchema.optional(),
          status: staffStatusSchema.optional(),
          active: z.boolean().optional(),
          limit: z.number().int().min(1).max(100).default(20),
          cursor: z.number().int().positive().optional(),
        })
        .nullish()
    )
    .query(async ({ ctx, input }) => {
      await need(ctx.user, "staff.read");
      const supabase = getSupabaseAdmin();
      const scope = await getOutletScope(ctx.user);
      if (input?.outletId) await assertOutletAccess(ctx.user, input.outletId);

      let candidateIds: number[] | null = null;
      if (input?.outletId) {
        let primary: number[] = [];
        let extra: number[] = [];
        try {
          const { data, error } = await supabase
            .from("staff")
            .select("id")
            .eq("primaryOutletId", input.outletId);
          if (error) throw error;
          primary = ((data ?? []) as any[]).map(x => x.id);
        } catch {
          primary = [];
        }
        try {
          const { data, error } = await supabase
            .from("outlet_staff")
            .select("staffId")
            .eq("outletId", input.outletId);
          if (error) throw error;
          extra = ((data ?? []) as any[]).map(x => x.staffId);
        } catch {
          extra = [];
        }
        candidateIds = Array.from(new Set([...primary, ...extra]));
        if (candidateIds.length === 0)
          return { items: [], nextCursor: undefined };
      } else if (scope && scope.length) {
        let allOutletStaff: any[] = [];
        try {
          const { data, error } = await supabase
            .from("outlet_staff")
            .select("*");
          if (error) throw error;
          allOutletStaff = (data ?? []) as any[];
        } catch {
          allOutletStaff = [];
        }
        let primaryInScope: number[] = [];
        try {
          const { data, error } = await supabase
            .from("staff")
            .select("id")
            .in("primaryOutletId", scope);
          if (error) throw error;
          primaryInScope = ((data ?? []) as any[]).map(x => x.id);
        } catch {
          primaryInScope = [];
        }
        const extraInScope = allOutletStaff
          .filter((o: any) => scope.includes(o.outletId))
          .map((o: any) => o.staffId);
        const ids = Array.from(new Set([...primaryInScope, ...extraInScope]));
        if (ids.length) candidateIds = ids;
        else candidateIds = [-1]; // force empty via 1=0 equivalent
      }

      const limit = input?.limit ?? 20;
      const limitPlusOne = limit + 1;

      let query: any = supabase
        .from("staff")
        .select("*")
        .order("id", { ascending: false })
        .limit(limitPlusOne);
      if (input?.cursor) query = query.lt("id", input.cursor);
      if (input?.role) query = query.eq("role", input.role);
      if (input?.employmentType)
        query = query.eq("employmentType", input.employmentType);
      if (input?.status) query = query.eq("status", input.status);
      if (input?.active !== undefined) query = query.eq("active", input.active);
      if (candidateIds) {
        if (candidateIds.length === 1 && candidateIds[0] === -1) {
          // scope with no ids -> match none
          query = query.eq("id", -1);
        } else {
          query = query.in("id", candidateIds);
        }
      }
      if (input?.search) {
        const q = escapePostgrestOr(input.search);
        // PostgREST or filter: ilike search across multiple columns
        query = query.or(
          `name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%,employeeId.ilike.%${q}%`
        );
      }

      const { data: rows, error } = await query;
      if (error)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      const allRows = (rows ?? []) as any[];
      const page = allRows.slice(0, limit);

      // enrich with attendance today and outlet name
      const today = new Date().toISOString().slice(0, 10);
      const attMap = new Map<number, any>();
      try {
        const { data: atts, error: attErr } = await supabase
          .from("attendance_records")
          .select("*")
          .eq("date", today as any);
        if (attErr) throw attErr;
        for (const a of (atts ?? []) as any[]) attMap.set(a.staffId, a);
      } catch {}
      const outletMap = new Map<number, string>();
      try {
        const { data: outs, error: outErr } = await supabase
          .from("outlets")
          .select("id,name");
        if (outErr) throw outErr;
        for (const o of (outs ?? []) as any[]) outletMap.set(o.id, o.name);
      } catch {}
      const enriched = page.map((s: any) => ({
        ...s,
        outletName: s.primaryOutletId
          ? (outletMap.get(s.primaryOutletId) ?? `Outlet #${s.primaryOutletId}`)
          : "Unassigned",
        todayAttendance: attMap.get(s.id) ?? null,
      }));
      return {
        items: enriched,
        nextCursor: allRows.length > limit ? page.at(-1)?.id : undefined,
      };
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await need(ctx.user, "staff.read");
      const supabase = getSupabaseAdmin();
      const { data: s, error } = await supabase
        .from("staff")
        .select("*")
        .eq("id", input.id)
        .limit(1)
        .maybeSingle();
      if (error)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      if (!s)
        throw new TRPCError({ code: "NOT_FOUND", message: "Staff not found." });
      // outlet access check
      const scope = await getOutletScope(ctx.user);
      if (scope !== null && scope.length) {
        const allowed =
          (s as any).primaryOutletId &&
          scope.includes((s as any).primaryOutletId);
        let extra: number[] = [];
        try {
          const { data, error: e2 } = await supabase
            .from("outlet_staff")
            .select("outletId")
            .eq("staffId", (s as any).id);
          if (e2) throw e2;
          extra = ((data ?? []) as any[]).map(x => x.outletId);
        } catch {
          extra = [];
        }
        if (!allowed && !extra.some(id => scope.includes(id)))
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "No access to this staff's outlet.",
          });
      }
      let outletsForStaff: number[] = [];
      try {
        const { data, error: e3 } = await supabase
          .from("outlet_staff")
          .select("outletId")
          .eq("staffId", (s as any).id);
        if (e3) throw e3;
        outletsForStaff = ((data ?? []) as any[]).map(x => x.outletId);
      } catch {
        outletsForStaff = [];
      }

      let manager: any = null;
      if ((s as any).managerId) {
        try {
          const { data, error: e4 } = await supabase
            .from("staff")
            .select("*")
            .eq("id", (s as any).managerId)
            .limit(1)
            .maybeSingle();
          if (!e4) manager = data ?? null;
        } catch {
          manager = null;
        }
      }

      let attendance: any[] = [];
      try {
        const { data, error: e5 } = await supabase
          .from("attendance_records")
          .select("*")
          .eq("staffId", (s as any).id)
          .order("date", { ascending: false })
          .limit(10);
        if (!e5) attendance = (data ?? []) as any[];
      } catch {
        attendance = [];
      }

      let schedules: any[] = [];
      try {
        const { data, error: e6 } = await supabase
          .from("staff_schedules")
          .select("*")
          .eq("staffId", (s as any).id)
          .order("date", { ascending: false })
          .limit(10);
        if (!e6) schedules = (data ?? []) as any[];
      } catch {
        schedules = [];
      }

      let leaves: any[] = [];
      try {
        const { data, error: e7 } = await supabase
          .from("leave_requests")
          .select("*")
          .eq("staffId", (s as any).id)
          .order("createdAt", { ascending: false })
          .limit(10);
        if (!e7) leaves = (data ?? []) as any[];
      } catch {
        leaves = [];
      }

      let outletName: string | null = null;
      if ((s as any).primaryOutletId) {
        try {
          const { data, error: e8 } = await supabase
            .from("outlets")
            .select("name")
            .eq("id", (s as any).primaryOutletId)
            .limit(1)
            .maybeSingle();
          if (!e8) outletName = (data as any)?.name ?? null;
        } catch {
          outletName = null;
        }
      }

      return {
        staff: s,
        outlets: outletsForStaff,
        manager,
        attendance,
        schedules,
        leaves,
        outletName,
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(2).max(160),
        email: z.string().trim().email().max(320),
        phone: z.string().trim().max(32).nullable(),
        role: staffRoleSchema,
        employmentType: employmentTypeSchema.default("full_time"),
        joiningDate: z.string().date().nullable().optional(),
        primaryOutletId: z.number().int().positive().nullable(),
        managerId: z.number().int().positive().nullable().optional(),
        additionalOutlets: z
          .array(z.number().int().positive())
          .max(20)
          .optional(),
        profilePhoto: z.string().trim().max(2000).nullable().optional(),
        dateOfBirth: z.string().date().nullable().optional(),
        emergencyContact: z.string().trim().max(32).nullable().optional(),
        address: z.string().trim().max(500).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await need(ctx.user, "staff.create");
      const supabase = getSupabaseAdmin();
      if (input.primaryOutletId)
        await assertOutletAccess(ctx.user, input.primaryOutletId);
      if (input.additionalOutlets)
        for (const oid of input.additionalOutlets)
          await assertOutletAccess(ctx.user, oid);

      const { data: existing, error: existErr } = await supabase
        .from("staff")
        .select("id")
        .eq("email", input.email)
        .limit(1)
        .maybeSingle();
      if (existErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: existErr.message,
        });
      if (existing)
        throw new TRPCError({
          code: "CONFLICT",
          message: "A staff profile already uses that email address.",
        });

      // generate employeeId
      let allIds: string[] = [];
      try {
        const { data, error } = await supabase
          .from("staff")
          .select("employeeId");
        if (error) throw error;
        allIds = ((data ?? []) as any[])
          .map(x => x.employeeId)
          .filter(Boolean) as string[];
      } catch {
        allIds = [];
      }
      const employeeId = nextEmployeeId(allIds);

      const payload: any = {
        employeeId,
        name: input.name.trim(),
        email: input.email.trim(),
        phone: input.phone?.trim() || null,
        role: input.role,
        employmentType: input.employmentType,
        status: "active",
        joiningDate: input.joiningDate
          ? (new Date(input.joiningDate).toISOString() as any)
          : (new Date().toISOString() as any),
        primaryOutletId: input.primaryOutletId,
        managerId: input.managerId ?? null,
        profilePhoto: input.profilePhoto ?? null,
        dateOfBirth: input.dateOfBirth
          ? (new Date(input.dateOfBirth).toISOString() as any)
          : null,
        emergencyContact: input.emergencyContact ?? null,
        address: input.address ?? null,
        active: true,
      };

      const { data: inserted, error: insErr } = await supabase
        .from("staff")
        .insert(payload)
        .select("id")
        .single();
      if (insErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: insErr.message,
        });
      const id = Number((inserted as any).id);

      if (input.additionalOutlets?.length) {
        for (const oid of input.additionalOutlets) {
          try {
            await supabase
              .from("outlet_staff")
              .insert({ outletId: oid, staffId: id } as any);
          } catch {}
        }
      }
      // also ensure primary outlet is in outlet_staff for scope
      if (input.primaryOutletId) {
        try {
          await supabase
            .from("outlet_staff")
            .insert({ outletId: input.primaryOutletId, staffId: id } as any);
        } catch {}
      }
      await recordAudit({
        actorUserId: ctx.user.id,
        entityType: "staff",
        entityId: id,
        outletId: input.primaryOutletId ?? null,
        action: "created",
        after: { name: input.name, role: input.role, employeeId },
      });
      return { id, employeeId };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().trim().min(2).max(160).optional(),
        phone: z.string().trim().max(32).nullable().optional(),
        role: staffRoleSchema.optional(),
        employmentType: employmentTypeSchema.optional(),
        joiningDate: z.string().date().nullable().optional(),
        managerId: z.number().int().positive().nullable().optional(),
        profilePhoto: z.string().trim().max(2000).nullable().optional(),
        dateOfBirth: z.string().date().nullable().optional(),
        emergencyContact: z.string().trim().max(32).nullable().optional(),
        address: z.string().trim().max(500).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await need(ctx.user, "staff.update");
      const supabase = getSupabaseAdmin();
      const { data: cur, error: curErr } = await supabase
        .from("staff")
        .select("*")
        .eq("id", input.id)
        .limit(1)
        .maybeSingle();
      if (curErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: curErr.message,
        });
      if (!cur)
        throw new TRPCError({ code: "NOT_FOUND", message: "Staff not found." });
      await assertStaffAccess(ctx.user, cur);
      const patch: any = {};
      if (input.name !== undefined) patch.name = input.name.trim();
      if (input.phone !== undefined) patch.phone = input.phone?.trim() || null;
      if (input.role !== undefined) patch.role = input.role;
      if (input.employmentType !== undefined)
        patch.employmentType = input.employmentType;
      if (input.joiningDate !== undefined)
        patch.joiningDate = input.joiningDate
          ? (new Date(input.joiningDate).toISOString() as any)
          : null;
      if (input.managerId !== undefined) patch.managerId = input.managerId;
      if (input.profilePhoto !== undefined)
        patch.profilePhoto = input.profilePhoto;
      if (input.dateOfBirth !== undefined)
        patch.dateOfBirth = input.dateOfBirth
          ? (new Date(input.dateOfBirth).toISOString() as any)
          : null;
      if (input.emergencyContact !== undefined)
        patch.emergencyContact = input.emergencyContact;
      if (input.address !== undefined) patch.address = input.address;
      if (Object.keys(patch).length === 0)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No fields to update.",
        });
      const { error: updErr } = await supabase
        .from("staff")
        .update(patch)
        .eq("id", input.id);
      if (updErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: updErr.message,
        });
      await recordAudit({
        actorUserId: ctx.user.id,
        entityType: "staff",
        entityId: input.id,
        outletId: (cur as any).primaryOutletId ?? null,
        action: "updated",
        before: cur as any,
        after: patch,
      });
      return { success: true };
    }),

  changeRole: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), role: staffRoleSchema }))
    .mutation(async ({ ctx, input }) => {
      await need(ctx.user, "staff.update");
      const supabase = getSupabaseAdmin();
      const { data: cur, error: curErr } = await supabase
        .from("staff")
        .select("*")
        .eq("id", input.id)
        .limit(1)
        .maybeSingle();
      if (curErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: curErr.message,
        });
      if (!cur)
        throw new TRPCError({ code: "NOT_FOUND", message: "Staff not found." });
      await assertStaffAccess(ctx.user, cur);
      if ((cur as any).role === input.role)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Role already set.",
        });
      const { error: updErr } = await supabase
        .from("staff")
        .update({ role: input.role } as any)
        .eq("id", input.id);
      if (updErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: updErr.message,
        });
      // Immediate revocation: without this the 30s memo would let the old role keep
      // working after a demotion.
      invalidateAuthMemo({
        id: (cur as any)?.userId ?? null,
        email: (cur as any)?.email ?? null,
      });
      await recordAudit({
        actorUserId: ctx.user.id,
        entityType: "staff",
        entityId: input.id,
        outletId: (cur as any).primaryOutletId ?? null,
        action: "role_changed",
        before: { role: (cur as any).role } as any,
        after: { role: input.role },
      });
      return { success: true };
    }),

  assignOutlet: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        primaryOutletId: z.number().int().positive().nullable(),
        additionalOutlets: z
          .array(z.number().int().positive())
          .max(20)
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await need(ctx.user, "staff.update");
      const supabase = getSupabaseAdmin();
      const { data: cur, error: curErr } = await supabase
        .from("staff")
        .select("*")
        .eq("id", input.id)
        .limit(1)
        .maybeSingle();
      if (curErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: curErr.message,
        });
      if (!cur)
        throw new TRPCError({ code: "NOT_FOUND", message: "Staff not found." });
      await assertStaffAccess(ctx.user, cur);
      if (input.primaryOutletId)
        await assertOutletAccess(ctx.user, input.primaryOutletId);
      if (input.additionalOutlets)
        for (const oid of input.additionalOutlets)
          await assertOutletAccess(ctx.user, oid);
      const { error: updErr } = await supabase
        .from("staff")
        .update({ primaryOutletId: input.primaryOutletId } as any)
        .eq("id", input.id);
      if (updErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: updErr.message,
        });
      if (input.additionalOutlets !== undefined) {
        await supabase.from("outlet_staff").delete().eq("staffId", input.id);
        for (const oid of input.additionalOutlets) {
          try {
            await supabase
              .from("outlet_staff")
              .insert({ outletId: oid, staffId: input.id } as any);
          } catch {}
        }
        if (
          input.primaryOutletId &&
          !input.additionalOutlets.includes(input.primaryOutletId)
        ) {
          try {
            await supabase.from("outlet_staff").insert({
              outletId: input.primaryOutletId,
              staffId: input.id,
            } as any);
          } catch {}
        }
      }
      // Outlet reassignment changes the authorization scope.
      invalidateAuthMemo({
        id: (cur as any).userId ?? null,
        email: (cur as any).email ?? null,
      });
      await recordAudit({
        actorUserId: ctx.user.id,
        entityType: "staff",
        entityId: input.id,
        outletId: input.primaryOutletId ?? null,
        action: "outlet_assigned",
        before: { primaryOutletId: (cur as any).primaryOutletId } as any,
        after: {
          primaryOutletId: input.primaryOutletId,
          additionalOutlets: input.additionalOutlets,
        },
      });
      return { success: true };
    }),

  setStatus: protectedProcedure
    .input(
      z.object({ id: z.number().int().positive(), status: staffStatusSchema })
    )
    .mutation(async ({ ctx, input }) => {
      await need(ctx.user, "staff.update");
      const supabase = getSupabaseAdmin();
      const { data: cur, error: curErr } = await supabase
        .from("staff")
        .select("*")
        .eq("id", input.id)
        .limit(1)
        .maybeSingle();
      if (curErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: curErr.message,
        });
      if (!cur)
        throw new TRPCError({ code: "NOT_FOUND", message: "Staff not found." });
      await assertStaffAccess(ctx.user, cur);
      if (
        (cur as any).userId === ctx.user.id &&
        ["suspended", "inactive", "terminated"].includes(input.status)
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot suspend your own account.",
        });
      const activeMap: Record<string, boolean> = {
        pending: false,
        active: true,
        inactive: false,
        suspended: false,
        on_leave: true,
        terminated: false,
      };
      const { error: updErr } = await supabase
        .from("staff")
        .update({
          status: input.status,
          active: activeMap[input.status] ?? false,
        } as any)
        .eq("id", input.id);
      if (updErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: updErr.message,
        });
      // Suspension/termination must revoke access on the next request.
      invalidateAuthMemo({
        id: (cur as any).userId ?? null,
        email: (cur as any).email ?? null,
      });
      await recordAudit({
        actorUserId: ctx.user.id,
        entityType: "staff",
        entityId: input.id,
        outletId: (cur as any).primaryOutletId ?? null,
        action:
          input.status === "suspended"
            ? "suspended"
            : input.status === "terminated"
              ? "terminated"
              : input.status === "active"
                ? "reactivated"
                : "status_changed",
        before: {
          status: (cur as any).status,
          active: (cur as any).active,
        } as any,
        after: { status: input.status, active: activeMap[input.status] },
      });
      return { success: true };
    }),
  setActive: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await need(ctx.user, "staff.update");
      const supabase = getSupabaseAdmin();
      const { data: cur, error: curErr } = await supabase
        .from("staff")
        .select("*")
        .eq("id", input.id)
        .limit(1)
        .maybeSingle();
      if (curErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: curErr.message,
        });
      if (!cur)
        throw new TRPCError({ code: "NOT_FOUND", message: "Staff not found." });
      await assertStaffAccess(ctx.user, cur);
      if ((cur as any).userId === ctx.user.id && !input.active)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot deactivate your own access.",
        });
      const status = input.active ? "active" : "inactive";
      const { error: updErr } = await supabase
        .from("staff")
        .update({ active: input.active, status: status as any } as any)
        .eq("id", input.id);
      if (updErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: updErr.message,
        });
      invalidateAuthMemo({
        id: (cur as any).userId ?? null,
        email: (cur as any).email ?? null,
      });
      await recordAudit({
        actorUserId: ctx.user.id,
        entityType: "staff",
        entityId: input.id,
        outletId: (cur as any).primaryOutletId ?? null,
        action: input.active ? "activated" : "deactivated",
        before: { active: (cur as any).active } as any,
        after: { active: input.active },
      });
      return { success: true };
    }),

  // Roles & Permissions
  roles: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      await need(ctx.user, "staff.read");
      const supabase = getSupabaseAdmin();
      const { data: roles, error } = await supabase
        .from("workforce_roles")
        .select("*")
        .order("name", { ascending: true });
      if (error)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      return (roles ?? []) as any[];
    }),
    permissions: protectedProcedure.query(async ({ ctx }) => {
      await need(ctx.user, "staff.read");
      const supabase = getSupabaseAdmin();
      const { data: perms, error } = await supabase
        .from("workforce_permissions")
        .select("*")
        .order("category", { ascending: true });
      if (error)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      return (perms ?? []) as any[];
    }),
    matrix: protectedProcedure.query(async ({ ctx }) => {
      await need(ctx.user, "staff.read");
      const supabase = getSupabaseAdmin();
      const [
        { data: roles, error: rErr },
        { data: perms, error: pErr },
        { data: rp, error: rpErr },
      ] = await Promise.all([
        supabase.from("workforce_roles").select("*"),
        supabase.from("workforce_permissions").select("*"),
        supabase.from("workforce_role_permissions").select("*"),
      ]);
      if (rErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: rErr.message,
        });
      if (pErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: pErr.message,
        });
      if (rpErr)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: rpErr.message,
        });
      return { roles: roles ?? [], permissions: perms ?? [], matrix: rp ?? [] };
    }),
  }),

  // Attendance
  attendance: router({
    list: protectedProcedure
      .input(
        z
          .object({
            outletId: z.number().int().positive().optional(),
            staffId: z.number().int().positive().optional(),
            date: z.string().date().optional(),
            status: z
              .enum([
                "present",
                "late",
                "absent",
                "half_day",
                "on_leave",
                "holiday",
              ])
              .optional(),
            from: z.string().date().optional(),
            to: z.string().date().optional(),
            limit: z.number().int().min(1).max(100).default(20),
            cursor: z.number().int().positive().optional(),
          })
          .nullish()
      )
      .query(async ({ ctx, input }) => {
        await need(ctx.user, "staff.read");
        const supabase = getSupabaseAdmin();
        const scope = await getOutletScope(ctx.user);
        if (input?.outletId) await assertOutletAccess(ctx.user, input.outletId);

        const limit = input?.limit ?? 20;
        const limitPlusOne = limit + 1;

        let q: any = supabase
          .from("attendance_records")
          .select("*")
          .order("date", { ascending: false })
          .order("id", { ascending: false })
          .limit(limitPlusOne);
        if (input?.cursor) q = q.lt("id", input.cursor);
        if (input?.staffId) q = q.eq("staffId", input.staffId);
        if (input?.outletId) q = q.eq("outletId", input.outletId);
        else if (scope && scope.length) q = q.in("outletId", scope);
        if (input?.date) q = q.eq("date", input.date as any);
        if (input?.status) q = q.eq("status", input.status);
        if (input?.from) q = q.gte("date", input.from as any);
        if (input?.to) q = q.lte("date", input.to as any);

        let rows: any[] = [];
        try {
          const { data, error } = await q;
          if (error) throw error;
          rows = (data ?? []) as any[];
        } catch {
          rows = [];
        }

        if (rows.length === 0) return { items: [], nextCursor: undefined };

        // Enrich staffName and outletName via batch fetch
        const staffIds = Array.from(
          new Set(rows.map((r: any) => r.staffId).filter(Boolean))
        ) as number[];
        const outletIds = Array.from(
          new Set(rows.map((r: any) => r.outletId).filter(Boolean))
        ) as number[];
        const staffMap = new Map<number, string>();
        const outletMap = new Map<number, string>();
        try {
          if (staffIds.length) {
            const { data, error } = await supabase
              .from("staff")
              .select("id,name")
              .in("id", staffIds);
            if (!error)
              (data ?? []).forEach((s: any) => staffMap.set(s.id, s.name));
          }
        } catch {}
        try {
          if (outletIds.length) {
            const { data, error } = await supabase
              .from("outlets")
              .select("id,name")
              .in("id", outletIds);
            if (!error)
              (data ?? []).forEach((o: any) => outletMap.set(o.id, o.name));
          }
        } catch {}
        const page = rows.slice(0, limit);
        return {
          items: page.map((r: any) => ({
            ...r,
            staffName: staffMap.get(r.staffId) ?? null,
            outletName: outletMap.get(r.outletId) ?? null,
          })),
          nextCursor: rows.length > limit ? page.at(-1)?.id : undefined,
        };
      }),
    today: protectedProcedure
      .input(
        z.object({ outletId: z.number().int().positive().optional() }).nullish()
      )
      .query(async ({ ctx, input }) => {
        await need(ctx.user, "staff.read");
        const supabase = getSupabaseAdmin();
        const today = new Date().toISOString().slice(0, 10);
        const scope = await getOutletScope(ctx.user);
        if (input?.outletId) await assertOutletAccess(ctx.user, input.outletId);
        let records: any[] = [];
        try {
          const { data, error } = await supabase
            .from("attendance_records")
            .select("*")
            .eq("date", today as any);
          if (error) throw error;
          records = (data ?? []) as any[];
        } catch {
          records = [];
        }
        if (input?.outletId)
          records = records.filter((r: any) => r.outletId === input.outletId);
        else if (scope && scope.length)
          records = records.filter(
            (r: any) => !r.outletId || scope.includes(r.outletId)
          );

        let expected = 0;
        try {
          const { count, error } = await supabase
            .from("staff")
            .select("id", { count: "exact", head: true })
            .eq("status", "active");
          if (!error) expected = Number(count ?? 0);
          else {
            const { data, error: e2 } = await supabase
              .from("staff")
              .select("id")
              .eq("status", "active");
            if (!e2) expected = (data ?? []).length;
          }
        } catch {
          expected = 0;
        }

        const present = records.filter((r: any) =>
          ["present", "late", "half_day"].includes(r.status)
        ).length;
        const late = records.filter((r: any) => r.status === "late").length;
        const absent = Math.max(0, expected - present);
        return { expected, present, late, absent, records };
      }),
    clockIn: protectedProcedure
      .input(
        z.object({
          staffId: z.number().int().positive(),
          outletId: z.number().int().positive().nullable().optional(),
          shiftId: z.number().int().positive().nullable().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "staff.update");
        const supabase = getSupabaseAdmin();
        await assertOutletAccess(ctx.user, input.outletId ?? null);
        const today = new Date().toISOString().slice(0, 10);
        let existing: any = null;
        try {
          const { data, error } = await supabase
            .from("attendance_records")
            .select("*")
            .eq("staffId", input.staffId)
            .eq("date", today as any)
            .limit(1)
            .maybeSingle();
          if (!error) existing = data ?? null;
        } catch {
          existing = null;
        }
        if (existing?.clockIn)
          throw new TRPCError({
            code: "CONFLICT",
            message: "Already clocked in today.",
          });
        const now = new Date().toISOString();
        if (existing) {
          const { error: updErr } = await supabase
            .from("attendance_records")
            .update({
              clockIn: now as any,
              outletId: input.outletId ?? existing.outletId,
              status: "present",
            } as any)
            .eq("id", existing.id);
          if (updErr)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: updErr.message,
            });
          await recordAudit({
            actorUserId: ctx.user.id,
            entityType: "attendance",
            entityId: existing.id,
            outletId: input.outletId ?? null,
            action: "clock_in",
            after: { staffId: input.staffId, clockIn: now },
          });
          return { id: existing.id };
        }
        const { data: inserted, error: insErr } = await supabase
          .from("attendance_records")
          .insert({
            staffId: input.staffId,
            outletId: input.outletId ?? null,
            date: today as any,
            clockIn: now as any,
            status: "present",
            createdBy: ctx.user.id,
          } as any)
          .select("id")
          .single();
        if (insErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: insErr.message,
          });
        const id = Number((inserted as any).id);
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "attendance",
          entityId: id,
          outletId: input.outletId ?? null,
          action: "clock_in",
          after: { staffId: input.staffId },
        });
        return { id };
      }),
    clockOut: protectedProcedure
      .input(z.object({ staffId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "staff.update");
        const supabase = getSupabaseAdmin();
        const { data: target } = await supabase
          .from("staff")
          .select("id,primaryOutletId")
          .eq("id", input.staffId)
          .limit(1)
          .maybeSingle();
        if (!target)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Staff not found.",
          });
        await assertStaffAccess(ctx.user, target);
        const today = new Date().toISOString().slice(0, 10);
        const { data: rec, error } = await supabase
          .from("attendance_records")
          .select("*")
          .eq("staffId", input.staffId)
          .eq("date", today as any)
          .limit(1)
          .maybeSingle();
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        if (!rec || !(rec as any).clockIn)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Not clocked in.",
          });
        if ((rec as any).clockOut)
          throw new TRPCError({
            code: "CONFLICT",
            message: "Already clocked out.",
          });
        const now = new Date();
        const hours =
          (now.getTime() - new Date((rec as any).clockIn).getTime()) / 3600000 -
          ((rec as any).breakEnd && (rec as any).breakStart
            ? (new Date((rec as any).breakEnd).getTime() -
                new Date((rec as any).breakStart).getTime()) /
              3600000
            : 0);
        const { error: updErr } = await supabase
          .from("attendance_records")
          .update({
            clockOut: now.toISOString() as any,
            totalHours: Number(hours.toFixed(2)) as any,
          } as any)
          .eq("id", (rec as any).id);
        if (updErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: updErr.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "attendance",
          entityId: (rec as any).id,
          action: "clock_out",
          after: { staffId: input.staffId },
        });
        return { success: true, totalHours: hours };
      }),
    breakToggle: protectedProcedure
      .input(
        z.object({
          staffId: z.number().int().positive(),
          type: z.enum(["break_start", "break_end"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "staff.update");
        const supabase = getSupabaseAdmin();
        const { data: target } = await supabase
          .from("staff")
          .select("id,primaryOutletId")
          .eq("id", input.staffId)
          .limit(1)
          .maybeSingle();
        if (!target)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Staff not found.",
          });
        await assertStaffAccess(ctx.user, target);
        const today = new Date().toISOString().slice(0, 10);
        const { data: rec, error } = await supabase
          .from("attendance_records")
          .select("*")
          .eq("staffId", input.staffId)
          .eq("date", today as any)
          .limit(1)
          .maybeSingle();
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        if (!rec)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "No attendance today.",
          });
        const now = new Date().toISOString();
        if (input.type === "break_start") {
          if ((rec as any).breakStart)
            throw new TRPCError({
              code: "CONFLICT",
              message: "Already on break.",
            });
          const { error: updErr } = await supabase
            .from("attendance_records")
            .update({ breakStart: now as any } as any)
            .eq("id", (rec as any).id);
          if (updErr)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: updErr.message,
            });
        } else {
          if (!(rec as any).breakStart || (rec as any).breakEnd)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Not on break.",
            });
          const { error: updErr } = await supabase
            .from("attendance_records")
            .update({ breakEnd: now as any } as any)
            .eq("id", (rec as any).id);
          if (updErr)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: updErr.message,
            });
        }
        return { success: true };
      }),
    correct: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          clockIn: z.string().datetime().nullable().optional(),
          clockOut: z.string().datetime().nullable().optional(),
          reason: z.string().trim().min(3).max(500),
          status: z
            .enum([
              "present",
              "late",
              "absent",
              "half_day",
              "on_leave",
              "holiday",
            ])
            .optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "staff.update");
        const supabase = getSupabaseAdmin();
        const { data: cur, error: curErr } = await supabase
          .from("attendance_records")
          .select("*")
          .eq("id", input.id)
          .limit(1)
          .maybeSingle();
        if (curErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: curErr.message,
          });
        if (!cur)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Attendance not found.",
          });
        if ((cur as any).outletId)
          await assertOutletAccess(ctx.user, (cur as any).outletId);
        else {
          const { data: target } = await supabase
            .from("staff")
            .select("id,primaryOutletId")
            .eq("id", (cur as any).staffId)
            .limit(1)
            .maybeSingle();
          if (!target)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Staff not found.",
            });
          await assertStaffAccess(ctx.user, target);
        }
        const patch: any = {};
        if (input.clockIn !== undefined)
          patch.clockIn = input.clockIn
            ? new Date(input.clockIn).toISOString()
            : null;
        if (input.clockOut !== undefined)
          patch.clockOut = input.clockOut
            ? new Date(input.clockOut).toISOString()
            : null;
        if (input.status !== undefined) patch.status = input.status;
        const { error: updErr } = await supabase
          .from("attendance_records")
          .update(patch)
          .eq("id", input.id);
        if (updErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: updErr.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "attendance",
          entityId: input.id,
          outletId: (cur as any).outletId ?? null,
          action: "corrected",
          before: cur as any,
          after: { reason: input.reason, ...patch },
        });
        return { success: true };
      }),
  }),

  // Shifts & Schedules
  shiftTemplates: router({
    list: protectedProcedure
      .input(
        z.object({ outletId: z.number().int().positive().optional() }).nullish()
      )
      .query(async ({ ctx, input }) => {
        await need(ctx.user, "staff.read");
        const supabase = getSupabaseAdmin();
        if (input?.outletId) await assertOutletAccess(ctx.user, input.outletId);
        const scope = await getOutletScope(ctx.user);
        let rows: any[] = [];
        try {
          const { data, error } = await supabase
            .from("shift_templates")
            .select("*")
            .order("startTime", { ascending: true });
          if (error) throw error;
          rows = (data ?? []) as any[];
        } catch {
          rows = [];
        }
        if (input?.outletId)
          rows = rows.filter(
            (r: any) => !r.outletId || r.outletId === input.outletId
          );
        else if (scope && scope.length)
          rows = rows.filter(
            (r: any) => !r.outletId || scope.includes(r.outletId)
          );
        return rows;
      }),
    create: protectedProcedure
      .input(
        z.object({
          name: z.string().trim().min(2).max(80),
          startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
          endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
          outletId: z.number().int().positive().nullable(),
          color: z
            .string()
            .regex(/^#[0-9A-Fa-f]{6}$/)
            .nullable()
            .optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "staff.update");
        if (input.outletId) await assertOutletAccess(ctx.user, input.outletId);
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
          .from("shift_templates")
          .insert({
            name: input.name.trim(),
            startTime: input.startTime,
            endTime: input.endTime,
            outletId: input.outletId,
            color: input.color ?? "#E2533C",
          } as any)
          .select("id")
          .single();
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        const id = Number((data as any).id);
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "shift_template",
          entityId: id,
          outletId: input.outletId ?? null,
          action: "created",
          after: input as any,
        });
        return { id };
      }),
    update: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          name: z.string().trim().min(2).max(80),
          startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
          endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "staff.update");
        const supabase = getSupabaseAdmin();
        const { data: cur, error: curErr } = await supabase
          .from("shift_templates")
          .select("id,outletId")
          .eq("id", input.id)
          .limit(1)
          .maybeSingle();
        if (curErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: curErr.message,
          });
        if (!cur)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Shift template not found.",
          });
        await assertOutletAccess(ctx.user, (cur as any).outletId ?? null);
        const { error } = await supabase
          .from("shift_templates")
          .update({
            name: input.name,
            startTime: input.startTime,
            endTime: input.endTime,
          } as any)
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        return { success: true };
      }),
    remove: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "staff.update");
        const supabase = getSupabaseAdmin();
        const { data: cur, error: curErr } = await supabase
          .from("shift_templates")
          .select("id,outletId")
          .eq("id", input.id)
          .limit(1)
          .maybeSingle();
        if (curErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: curErr.message,
          });
        if (!cur)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Shift template not found.",
          });
        await assertOutletAccess(ctx.user, (cur as any).outletId ?? null);
        let used: any[] = [];
        try {
          const { data, error } = await supabase
            .from("staff_schedules")
            .select("id")
            .eq("shiftTemplateId", input.id)
            .limit(1);
          if (error) throw error;
          used = (data ?? []) as any[];
        } catch {
          used = [];
        }
        if (used[0])
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Shift is assigned to schedules. Remove assignments first.",
          });
        const { error } = await supabase
          .from("shift_templates")
          .delete()
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        return { success: true };
      }),
  }),
  schedules: router({
    list: protectedProcedure
      .input(
        z
          .object({
            outletId: z.number().int().positive().optional(),
            date: z.string().date().optional(),
            from: z.string().date().optional(),
            to: z.string().date().optional(),
          })
          .nullish()
      )
      .query(async ({ ctx, input }) => {
        await need(ctx.user, "staff.read");
        const supabase = getSupabaseAdmin();
        const scope = await getOutletScope(ctx.user);
        if (input?.outletId) await assertOutletAccess(ctx.user, input.outletId);

        let q: any = supabase
          .from("staff_schedules")
          .select("*")
          .order("date", { ascending: true })
          .limit(100);
        if (input?.outletId) q = q.eq("outletId", input.outletId);
        else if (scope && scope.length) q = q.in("outletId", scope);
        if (input?.date) q = q.eq("date", input.date as any);
        if (input?.from) q = q.gte("date", input.from as any);
        if (input?.to) q = q.lte("date", input.to as any);

        let rows: any[] = [];
        try {
          const { data, error } = await q;
          if (error) throw error;
          rows = (data ?? []) as any[];
        } catch {
          rows = [];
        }

        if (rows.length === 0) return [];

        // Enrich staff, shift, outlet names
        const staffIds = Array.from(
          new Set(rows.map((r: any) => r.staffId).filter(Boolean))
        ) as number[];
        const shiftIds = Array.from(
          new Set(rows.map((r: any) => r.shiftTemplateId).filter(Boolean))
        ) as number[];
        const outletIds = Array.from(
          new Set(rows.map((r: any) => r.outletId).filter(Boolean))
        ) as number[];
        const staffMap = new Map<number, string>();
        const shiftMap = new Map<
          number,
          { name: string; startTime: string; endTime: string }
        >();
        const outletMap = new Map<number, string>();
        try {
          if (staffIds.length) {
            const { data } = await supabase
              .from("staff")
              .select("id,name")
              .in("id", staffIds);
            (data ?? []).forEach((s: any) => staffMap.set(s.id, s.name));
          }
        } catch {}
        try {
          if (shiftIds.length) {
            const { data } = await supabase
              .from("shift_templates")
              .select("id,name,startTime,endTime")
              .in("id", shiftIds);
            (data ?? []).forEach((sh: any) =>
              shiftMap.set(sh.id, {
                name: sh.name,
                startTime: sh.startTime,
                endTime: sh.endTime,
              })
            );
          }
        } catch {}
        try {
          if (outletIds.length) {
            const { data } = await supabase
              .from("outlets")
              .select("id,name")
              .in("id", outletIds);
            (data ?? []).forEach((o: any) => outletMap.set(o.id, o.name));
          }
        } catch {}

        // Sort by date then shift startTime
        rows.sort((a: any, b: any) => {
          if (a.date !== b.date)
            return String(a.date).localeCompare(String(b.date));
          const sa = shiftMap.get(a.shiftTemplateId)?.startTime ?? "";
          const sb = shiftMap.get(b.shiftTemplateId)?.startTime ?? "";
          return sa.localeCompare(sb);
        });

        return rows.map((r: any) => ({
          ...r,
          staffName: staffMap.get(r.staffId) ?? null,
          shiftName: shiftMap.get(r.shiftTemplateId)?.name ?? null,
          shiftStart: shiftMap.get(r.shiftTemplateId)?.startTime ?? null,
          shiftEnd: shiftMap.get(r.shiftTemplateId)?.endTime ?? null,
          outletName: outletMap.get(r.outletId) ?? null,
        }));
      }),
    assign: protectedProcedure
      .input(
        z.object({
          staffId: z.number().int().positive(),
          outletId: z.number().int().positive(),
          date: z.string().date(),
          shiftTemplateId: z.number().int().positive(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "staff.update");
        await assertOutletAccess(ctx.user, input.outletId);
        const supabase = getSupabaseAdmin();
        // prevent conflicting schedules for same staff same date
        let existing: any = null;
        try {
          const { data, error } = await supabase
            .from("staff_schedules")
            .select("id")
            .eq("staffId", input.staffId)
            .eq("date", input.date as any)
            .limit(1)
            .maybeSingle();
          if (!error) existing = data ?? null;
        } catch {
          existing = null;
        }
        if (existing)
          throw new TRPCError({
            code: "CONFLICT",
            message: "Staff already assigned for this date.",
          });
        const { data, error } = await supabase
          .from("staff_schedules")
          .insert({
            staffId: input.staffId,
            outletId: input.outletId,
            date: input.date as any,
            shiftTemplateId: input.shiftTemplateId,
            createdBy: ctx.user.id,
          } as any)
          .select("id")
          .single();
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        const id = Number((data as any).id);
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "staff_schedule",
          entityId: id,
          outletId: input.outletId,
          action: "assigned",
          after: input as any,
        });
        return { id };
      }),
    remove: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "staff.update");
        const supabase = getSupabaseAdmin();
        const { data: cur, error: curErr } = await supabase
          .from("staff_schedules")
          .select("id,outletId")
          .eq("id", input.id)
          .limit(1)
          .maybeSingle();
        if (curErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: curErr.message,
          });
        if (!cur)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Schedule not found.",
          });
        await assertOutletAccess(ctx.user, (cur as any).outletId ?? null);
        const { error } = await supabase
          .from("staff_schedules")
          .delete()
          .eq("id", input.id);
        if (error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
          });
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "staff_schedule",
          entityId: input.id,
          action: "removed",
        });
        return { success: true };
      }),
  }),

  // Leave
  leave: router({
    list: protectedProcedure
      .input(
        z
          .object({
            outletId: z.number().int().positive().optional(),
            status: z
              .enum(["pending", "approved", "rejected", "cancelled"])
              .optional(),
            staffId: z.number().int().positive().optional(),
          })
          .nullish()
      )
      .query(async ({ ctx, input }) => {
        await need(ctx.user, "staff.read");
        const supabase = getSupabaseAdmin();
        const scope = await getOutletScope(ctx.user);
        if (input?.outletId) await assertOutletAccess(ctx.user, input.outletId);

        let q: any = supabase
          .from("leave_requests")
          .select("*")
          .order("createdAt", { ascending: false })
          .limit(50);
        if (input?.status) q = q.eq("status", input.status);
        if (input?.staffId) q = q.eq("staffId", input.staffId);
        if (input?.outletId) q = q.eq("outletId", input.outletId);
        else if (scope && scope.length) q = q.in("outletId", scope);

        let rows: any[] = [];
        try {
          const { data, error } = await q;
          if (error) throw error;
          rows = (data ?? []) as any[];
        } catch {
          rows = [];
        }

        if (rows.length === 0) return [];

        const staffIds = Array.from(
          new Set(rows.map((r: any) => r.staffId).filter(Boolean))
        ) as number[];
        const outletIds = Array.from(
          new Set(rows.map((r: any) => r.outletId).filter(Boolean))
        ) as number[];
        const staffMap = new Map<number, string>();
        const outletMap = new Map<number, string>();
        try {
          if (staffIds.length) {
            const { data } = await supabase
              .from("staff")
              .select("id,name")
              .in("id", staffIds);
            (data ?? []).forEach((s: any) => staffMap.set(s.id, s.name));
          }
        } catch {}
        try {
          if (outletIds.length) {
            const { data } = await supabase
              .from("outlets")
              .select("id,name")
              .in("id", outletIds);
            (data ?? []).forEach((o: any) => outletMap.set(o.id, o.name));
          }
        } catch {}

        return rows.map((r: any) => ({
          ...r,
          staffName: staffMap.get(r.staffId) ?? null,
          outletName: r.outletId ? (outletMap.get(r.outletId) ?? null) : null,
        }));
      }),
    create: protectedProcedure
      .input(
        z.object({
          staffId: z.number().int().positive().optional(),
          leaveType: z
            .enum(["casual", "sick", "emergency", "unpaid", "other"])
            .default("casual"),
          startDate: z.string().date(),
          endDate: z.string().date(),
          reason: z.string().trim().max(500).nullable(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // staff can create for self, manager can create for others
        const supabase = getSupabaseAdmin();
        await need(ctx.user, "staff.read");
        let staffId = input.staffId;
        if (!staffId) {
          // find staff for current user
          let me: any = null;
          try {
            const { data, error } = await supabase
              .from("staff")
              .select("id,primaryOutletId")
              .eq("userId", ctx.user.id)
              .limit(1)
              .maybeSingle();
            if (!error) me = data ?? null;
          } catch {
            me = null;
          }
          if (!me)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "No staff profile for current user.",
            });
          staffId = me.id;
        }
        let target: any = null;
        try {
          const { data, error } = await supabase
            .from("staff")
            .select("*")
            .eq("id", staffId!)
            .limit(1)
            .maybeSingle();
          if (error) throw error;
          target = data ?? null;
        } catch {
          target = null;
        }
        if (!target)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Staff not found.",
          });
        if (new Date(input.endDate) < new Date(input.startDate))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "End date must be after start.",
          });
        const outletId = target.primaryOutletId ?? null;
        if (outletId) await assertOutletAccess(ctx.user, outletId);
        const { data: inserted, error: insErr } = await supabase
          .from("leave_requests")
          .insert({
            staffId,
            outletId,
            leaveType: input.leaveType,
            startDate: input.startDate as any,
            endDate: input.endDate as any,
            reason: input.reason,
          } as any)
          .select("id")
          .single();
        if (insErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: insErr.message,
          });
        const id = Number((inserted as any).id);
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "leave_request",
          entityId: id,
          outletId,
          action: "created",
          after: input as any,
        });
        return { id };
      }),
    review: protectedProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          status: z.enum(["approved", "rejected", "cancelled"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await need(ctx.user, "staff.update");
        const supabase = getSupabaseAdmin();
        const { data: cur, error: curErr } = await supabase
          .from("leave_requests")
          .select("*")
          .eq("id", input.id)
          .limit(1)
          .maybeSingle();
        if (curErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: curErr.message,
          });
        if (!cur)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Leave not found.",
          });
        if ((cur as any).status !== "pending")
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Only pending requests can be reviewed.",
          });
        if ((cur as any).outletId)
          await assertOutletAccess(ctx.user, (cur as any).outletId);
        else {
          const { data: target } = await supabase
            .from("staff")
            .select("id,primaryOutletId")
            .eq("id", (cur as any).staffId)
            .limit(1)
            .maybeSingle();
          if (!target)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Staff not found.",
            });
          await assertStaffAccess(ctx.user, target);
        }
        const { error: updErr } = await supabase
          .from("leave_requests")
          .update({
            status: input.status,
            reviewedBy: ctx.user.id,
            reviewedAt: new Date().toISOString() as any,
          } as any)
          .eq("id", input.id);
        if (updErr)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: updErr.message,
          });
        if (input.status === "approved") {
          // mark attendance as on_leave for those dates
          // we don't auto-create attendance, but status will be reflected in performance
        }
        await recordAudit({
          actorUserId: ctx.user.id,
          entityType: "leave_request",
          entityId: input.id,
          outletId: (cur as any).outletId ?? null,
          action: `leave_${input.status}`,
          before: { status: (cur as any).status } as any,
          after: { status: input.status },
        });
        return { success: true };
      }),
  }),

  // Performance (derived)
  performance: protectedProcedure
    .input(
      z
        .object({
          staffId: z.number().int().positive().optional(),
          outletId: z.number().int().positive().optional(),
        })
        .nullish()
    )
    .query(async ({ ctx, input }) => {
      await need(ctx.user, "staff.read");
      const supabase = getSupabaseAdmin();
      const scope = await getOutletScope(ctx.user);
      if (input?.outletId) await assertOutletAccess(ctx.user, input.outletId);
      let staffList: any[] = [];
      if (input?.staffId) {
        try {
          const { data, error } = await supabase
            .from("staff")
            .select("*")
            .eq("id", input.staffId)
            .limit(1)
            .maybeSingle();
          if (!error && data) staffList = [data];
        } catch {
          staffList = [];
        }
      } else {
        try {
          const { data, error } = await supabase
            .from("staff")
            .select("*")
            .limit(100);
          if (!error) staffList = (data ?? []) as any[];
        } catch {
          staffList = [];
        }
        if (input?.outletId) {
          let ids: number[] = [];
          try {
            const { data, error } = await supabase
              .from("outlet_staff")
              .select("staffId")
              .eq("outletId", input.outletId);
            if (!error) ids = ((data ?? []) as any[]).map(x => x.staffId);
          } catch {
            ids = [];
          }
          staffList = staffList.filter(
            (s: any) =>
              s.primaryOutletId === input.outletId || ids.includes(s.id)
          );
        } else if (scope && scope.length) {
          let ids: any[] = [];
          try {
            const { data, error } = await supabase
              .from("outlet_staff")
              .select("*");
            if (!error) ids = (data ?? []) as any[];
          } catch {
            ids = [];
          }
          staffList = staffList.filter(
            (s: any) =>
              (s.primaryOutletId && scope.includes(s.primaryOutletId)) ||
              ids.some(
                (x: any) => x.staffId === s.id && scope.includes(x.outletId)
              )
          );
        }
      }
      // Batch attendance + orders-processed aggregates instead of one or two
      // queries per staff member (previous N+1).
      const staffIds = staffList.map((s: any) => s.id);
      const userIds = staffList
        .map((s: any) => s.userId)
        .filter((v: any): v is number => typeof v === "number");
      let attendanceMap = new Map<
        number,
        { totalDays: number; present: number; late: number }
      >();
      let ordersMap = new Map<number, number>();
      try {
        const sql = await getSql();
        if (staffIds.length) {
          const attRows = (await sql.unsafe(
            `
          SELECT "staffId",
            count(*)::int AS "totalDays",
            count(*) FILTER (WHERE "status" IN ('present','late'))::int AS "present",
            count(*) FILTER (WHERE "status" = 'late')::int AS "late"
          FROM "attendance_records"
          WHERE "staffId" = ANY($1)
          GROUP BY "staffId"
        `,
            [staffIds]
          )) as any[];
          attendanceMap = new Map(
            attRows.map((r: any) => [
              Number(r.staffId),
              {
                totalDays: Number(r.totalDays),
                present: Number(r.present),
                late: Number(r.late),
              },
            ])
          );
        }
        if (userIds.length) {
          const orderRows = (await sql.unsafe(
            `
          SELECT "actorUserId", count(*)::int AS "c"
          FROM "audit_log"
          WHERE "entityType" = 'order' AND "actorUserId" = ANY($1)
          GROUP BY "actorUserId"
        `,
            [userIds]
          )) as any[];
          ordersMap = new Map(
            orderRows.map((r: any) => [Number(r.actorUserId), Number(r.c)])
          );
        }
      } catch {
        attendanceMap = new Map();
        ordersMap = new Map();
      }
      const results = staffList.map((s: any) => {
        const att = attendanceMap.get(s.id);
        const totalDays = att?.totalDays ?? 0;
        const denom = totalDays || 1;
        const present = att?.present ?? 0;
        const late = att?.late ?? 0;
        const attendanceRate = (present / denom) * 100;
        const onTimeRate = ((present - late) / denom) * 100;
        return {
          staffId: s.id,
          name: s.name,
          role: s.role,
          outletId: s.primaryOutletId,
          attendanceRate,
          onTimeRate,
          ordersProcessed: s.userId ? (ordersMap.get(s.userId) ?? 0) : 0,
          totalDays,
          present,
          late,
        };
      });
      return results;
    }),

  // Activity (human-friendly)
  activity: protectedProcedure
    .input(
      z
        .object({
          staffId: z.number().int().positive().optional(),
          outletId: z.number().int().positive().optional(),
          limit: z.number().int().min(1).max(50).default(20),
        })
        .nullish()
    )
    .query(async ({ ctx, input }) => {
      await need(ctx.user, "staff.read");
      const supabase = getSupabaseAdmin();
      const scope = await getOutletScope(ctx.user);
      if (input?.outletId) await assertOutletAccess(ctx.user, input.outletId);
      let staffIds: number[] | null = null;
      if (input?.staffId) staffIds = [input.staffId];
      else if (input?.outletId) {
        let primary: number[] = [];
        let extra: number[] = [];
        try {
          const { data, error } = await supabase
            .from("staff")
            .select("id")
            .eq("primaryOutletId", input.outletId);
          if (!error) primary = ((data ?? []) as any[]).map(x => x.id);
        } catch {
          primary = [];
        }
        try {
          const { data, error } = await supabase
            .from("outlet_staff")
            .select("staffId")
            .eq("outletId", input.outletId);
          if (!error) extra = ((data ?? []) as any[]).map(x => x.staffId);
        } catch {
          extra = [];
        }
        staffIds = Array.from(new Set([...primary, ...extra]));
      } else if (scope && scope.length) {
        let all: any[] = [];
        try {
          const { data, error } = await supabase.from("staff").select("*");
          if (!error) all = (data ?? []) as any[];
        } catch {
          all = [];
        }
        staffIds = all
          .filter(
            (s: any) => s.primaryOutletId && scope.includes(s.primaryOutletId)
          )
          .map((s: any) => s.id);
      }
      // fetch audit_log for those staff userIds
      let userIds: number[] = [];
      if (staffIds) {
        try {
          const q: any = supabase
            .from("staff")
            .select("id,userId")
            .in("id", staffIds.length ? staffIds : [-1]);
          const { data, error } = await q;
          if (!error)
            userIds = ((data ?? []) as any[])
              .map((r: any) => r.userId)
              .filter(Boolean) as number[];
        } catch {
          userIds = [];
        }
      }
      let logs: any[] = [];
      try {
        let q: any = supabase
          .from("audit_log")
          .select("*")
          .order("createdAt", { ascending: false })
          .limit(input?.limit ?? 20);
        if (userIds.length) q = q.in("actorUserId", userIds);
        const { data, error } = await q;
        if (error) throw error;
        logs = (data ?? []) as any[];
      } catch {
        logs = [];
      }

      // enrich with staff name
      const userToStaff = new Map<number, string>();
      try {
        if (userIds.length) {
          const { data, error } = await supabase
            .from("staff")
            .select("userId,name")
            .in("userId", userIds.length ? userIds : [-1]);
          if (!error)
            for (const s of (data ?? []) as any[])
              if (s.userId) userToStaff.set(s.userId, s.name);
        }
      } catch {}
      return logs.map((l: any) => ({
        ...l,
        staffName: l.actorUserId
          ? (userToStaff.get(l.actorUserId) ?? `User #${l.actorUserId}`)
          : "System",
      }));
    }),
});
