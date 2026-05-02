import { z } from "https://esm.sh/zod@3.23.8";
import { corsHeaders, errorResponse, HttpError, jsonResponse, requireAdmin } from "../_shared/admin-auth.ts";

const Schema = z.object({
  targetUserId: z.string().uuid(),
  disabled: z.boolean(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { admin, userId } = await requireAdmin(req);
    const body = await req.json().catch(() => ({}));
    const parsed = Schema.safeParse(body);
    if (!parsed.success) throw new HttpError(400, "Invalid input");
    const { targetUserId, disabled } = parsed.data;

    if (targetUserId === userId) {
      throw new HttpError(400, "You cannot disable your own account.");
    }

    const ban_duration = disabled ? `${100 * 365 * 24}h` : "none";
    const { error } = await admin.auth.admin.updateUserById(targetUserId, {
      ban_duration,
    } as unknown as Record<string, unknown>);
    if (error) throw error;

    return jsonResponse({ ok: true, disabled });
  } catch (err) {
    return errorResponse(err);
  }
});
