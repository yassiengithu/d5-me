import { corsHeaders, errorResponse, jsonResponse, requireAdmin } from "../_shared/admin-auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { admin } = await requireAdmin(req);

    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - 6);

    const { data, error } = await admin
      .from("orders")
      .select("commission_amount, created_at, status")
      .eq("status", "completed")
      .gte("created_at", since.toISOString());
    if (error) throw error;
    const rows = data ?? [];

    const { data: totalRows, error: totalError } = await admin
      .from("orders")
      .select("commission_amount")
      .eq("status", "completed");
    if (totalError) throw totalError;

    const totalCommission = (totalRows ?? []).reduce(
      (sum: number, r: { commission_amount: number | string | null }) =>
        sum + Number(r.commission_amount ?? 0),
      0,
    );

    const buckets = new Map<string, number>();
    for (let i = 0; i < 7; i++) {
      const d = new Date(since);
      d.setUTCDate(since.getUTCDate() + i);
      buckets.set(d.toISOString().slice(0, 10), 0);
    }
    for (const r of rows as Array<{ created_at: string; commission_amount: number | string | null }>) {
      const day = new Date(r.created_at).toISOString().slice(0, 10);
      if (buckets.has(day)) {
        buckets.set(day, (buckets.get(day) ?? 0) + Number(r.commission_amount ?? 0));
      }
    }

    const perDay = Array.from(buckets.entries()).map(([date, commission]) => ({
      date,
      commission: Number(commission.toFixed(2)),
    }));

    return jsonResponse({
      totalCommission: Number(totalCommission.toFixed(2)),
      perDay,
    });
  } catch (err) {
    return errorResponse(err);
  }
});
