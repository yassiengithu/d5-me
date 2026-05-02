import { corsHeaders, errorResponse, jsonResponse, requireAdmin } from "../_shared/admin-auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { admin } = await requireAdmin(req);

    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (error) throw error;

    const ids = data.users.map((u) => u.id);
    const profilesRes = ids.length
      ? await admin.from("profiles").select("id, name").in("id", ids)
      : { data: [] as Array<{ id: string; name: string | null }> };

    const nameById = new Map(
      ((profilesRes as { data: Array<{ id: string; name: string | null }> | null }).data ?? []).map(
        (p) => [p.id, p.name],
      ),
    );

    const result = data.users.map((u) => {
      const bannedUntil = (u as { banned_until?: string | null }).banned_until ?? null;
      const disabled = !!bannedUntil && new Date(bannedUntil).getTime() > Date.now();
      return {
        id: u.id,
        email: u.email ?? null,
        name: nameById.get(u.id) ?? null,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
        disabled,
      };
    });

    return jsonResponse(result);
  } catch (err) {
    return errorResponse(err);
  }
});
