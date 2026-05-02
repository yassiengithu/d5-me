import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AdminOrder = {
  id: string;
  status: string;
  total_amount: number;
  created_at: string;
};

export type AdminOrdersOverview = {
  totalOrders: number;
  recentOrders: AdminOrder[];
};

export type AdminOrdersFilters = {
  status?: string;
  from?: string; // ISO date (YYYY-MM-DD)
  to?: string;   // ISO date (YYYY-MM-DD)
};

export const getAdminOrdersOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: AdminOrdersFilters | undefined) => data ?? {})
  .handler(async ({ context, data }): Promise<AdminOrdersOverview> => {
    const { supabase, userId } = context;

    // Admin gate
    const { data: isAdmin, error: roleError } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleError) throw roleError;
    if (!isAdmin) throw new Error("Forbidden");

    const applyFilters = (q: any): any => {
      let query = q;
      if (data.status && data.status !== "all") {
        query = query.eq("status", data.status);
      }
      if (data.from) {
        query = query.gte("created_at", `${data.from}T00:00:00.000Z`);
      }
      if (data.to) {
        query = query.lte("created_at", `${data.to}T23:59:59.999Z`);
      }
      return query;
    };

    // Use admin client to bypass per-user RLS for platform-wide stats
    const countQuery = supabaseAdmin
      .from("orders")
      .select("*", { count: "exact", head: true });
    const { count, error: countError } = await applyFilters(countQuery);
    if (countError) throw countError;

    const listQuery = supabaseAdmin
      .from("orders")
      .select("id, status, total_amount, created_at")
      .order("created_at", { ascending: false })
      .limit(5);
    const { data: rows, error } = await applyFilters(listQuery);
    if (error) throw error;

    return {
      totalOrders: count ?? 0,
      recentOrders: (rows ?? []) as AdminOrder[],
    };
  });

export type AdminUsersOverview = {
  totalUsers: number;
  totalSellers: number;
};

export const getAdminUsersOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminUsersOverview> => {
    const { supabase, userId } = context;

    const { data: isAdmin, error: roleError } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleError) throw roleError;
    if (!isAdmin) throw new Error("Forbidden");

    const [usersRes, sellersRes] = await Promise.all([
      supabaseAdmin.from("profiles").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("sellers").select("*", { count: "exact", head: true }),
    ]);

    if (usersRes.error) throw usersRes.error;
    if (sellersRes.error) throw sellersRes.error;

    return {
      totalUsers: usersRes.count ?? 0,
      totalSellers: sellersRes.count ?? 0,
    };
  });

export type CommissionDay = { date: string; commission: number };

export type AdminRevenueOverview = {
  totalCommission: number;
  perDay: CommissionDay[];
};

export const getAdminRevenueOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminRevenueOverview> => {
    const { supabase, userId } = context;

    // Admin gate
    const { data: isAdmin, error: roleError } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleError) throw roleError;
    if (!isAdmin) throw new Error("Forbidden");

    // Use admin client to read across all orders, bypassing per-user RLS
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - 6); // last 7 days incl. today

    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("commission_amount, created_at, status")
      .eq("status", "completed")
      .gte("created_at", since.toISOString());
    if (error) throw error;

    const rows = data ?? [];

    // Total across all completed orders (not just last 7 days)
    const { data: totalRows, error: totalError } = await supabaseAdmin
      .from("orders")
      .select("commission_amount")
      .eq("status", "completed");
    if (totalError) throw totalError;

    const totalCommission = (totalRows ?? []).reduce(
      (sum, r) => sum + Number(r.commission_amount ?? 0),
      0,
    );

    // Build per-day buckets for last 7 days
    const buckets = new Map<string, number>();
    for (let i = 0; i < 7; i++) {
      const d = new Date(since);
      d.setUTCDate(since.getUTCDate() + i);
      buckets.set(d.toISOString().slice(0, 10), 0);
    }
    for (const r of rows) {
      const day = new Date(r.created_at).toISOString().slice(0, 10);
      if (buckets.has(day)) {
        buckets.set(day, (buckets.get(day) ?? 0) + Number(r.commission_amount ?? 0));
      }
    }

    const perDay: CommissionDay[] = Array.from(buckets.entries()).map(
      ([date, commission]) => ({ date, commission: Number(commission.toFixed(2)) }),
    );

    return {
      totalCommission: Number(totalCommission.toFixed(2)),
      perDay,
    };
  });
