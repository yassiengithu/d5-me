import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AdminUser = {
  id: string;
  email: string | null;
  name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  disabled: boolean;
};

async function assertAdmin(supabase: any, userId: string) {
  const { data: isAdmin, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw error;
  if (!isAdmin) throw new Error("Forbidden");
}

export const listAdminUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminUser[]> => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    if (error) throw error;

    const ids = data.users.map((u) => u.id);
    const { data: profiles } = ids.length
      ? await supabaseAdmin.from("profiles").select("id, name").in("id", ids)
      : { data: [] as { id: string; name: string | null }[] };

    const nameById = new Map((profiles ?? []).map((p) => [p.id, p.name]));

    return data.users.map((u) => {
      // Supabase disables a user by setting banned_until to a far-future date.
      const bannedUntil = (u as any).banned_until as string | null | undefined;
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
  });

export const setUserDisabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ targetUserId: z.string().uuid(), disabled: z.boolean() }).parse(data),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    if (data.targetUserId === userId) {
      throw new Error("You cannot disable your own account.");
    }

    // 100 years effectively disables the account; "none" re-enables it.
    const ban_duration = data.disabled ? `${100 * 365 * 24}h` : "none";
    const { error } = await supabaseAdmin.auth.admin.updateUserById(
      data.targetUserId,
      { ban_duration } as any,
    );
    if (error) throw error;

    return { ok: true, disabled: data.disabled };
  });
