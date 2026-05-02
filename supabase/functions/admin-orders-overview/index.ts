import { corsHeaders, errorResponse, jsonResponse, requireAdmin } from "../_shared/admin-auth.ts";

type Filters = { status?: string; from?: string; to?: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { admin } = await requireAdmin(req);
    const filters: Filters = await req.json().catch(() => ({}));

    const applyFilters = (q: any) => {
      let query = q;
      if (filters.status && filters.status !== "all") {
        query = query.eq("status", filters.status);
      }
      if (filters.from) query = query.gte("created_at", `${filters.from}T00:00:00.000Z`);
      if (filters.to) query = query.lte("created_at", `${filters.to}T23:59:59.999Z`);
      return query;
    };

    const { count, error: countError } = await applyFilters(
      admin.from("orders").select("*", { count: "exact", head: true }),
    );
    if (countError) throw countError;

    const { data: rows, error } = await applyFilters(
      admin
        .from("orders")
        .select("id, status, total_amount, created_at")
        .order("created_at", { ascending: false })
        .limit(5),
    );
    if (error) throw error;

    return jsonResponse({
      totalOrders: count ?? 0,
      recentOrders: rows ?? [],
    });
  } catch (err) {
    return errorResponse(err);
  }
});
