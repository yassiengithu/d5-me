import { corsHeaders, errorResponse, jsonResponse, requireAdmin } from "../_shared/admin-auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { admin } = await requireAdmin(req);

    const [usersRes, sellersRes] = await Promise.all([
      admin.from("profiles").select("*", { count: "exact", head: true }),
      admin.from("sellers").select("*", { count: "exact", head: true }),
    ]);
    if (usersRes.error) throw usersRes.error;
    if (sellersRes.error) throw sellersRes.error;

    return jsonResponse({
      totalUsers: usersRes.count ?? 0,
      totalSellers: sellersRes.count ?? 0,
    });
  } catch (err) {
    return errorResponse(err);
  }
});
