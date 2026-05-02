import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Persist a placed order to the database with monetary breakdown.
 *
 * Stores:
 *   - total_amount      : grand total charged to the buyer
 *   - commission_amount : platform fee portion
 *   - seller_earnings   : total - commission
 *   - payment_status    : 'pending' | 'paid' | 'failed'
 *
 * Values are computed on the client (from the canonical platform fee rate in
 * src/lib/commission.ts) and passed through here so the DB row matches what
 * the buyer was shown at checkout. The DB also has a status-based commission
 * trigger, but it only fires on `status = 'completed'`; we want the breakdown
 * recorded immediately at order placement.
 */
export const recordOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().min(1),
        total_amount: z.number().nonnegative(),
        commission_amount: z.number().nonnegative(),
        seller_earnings: z.number().nonnegative(),
        payment_status: z.enum(["pending", "paid", "failed"]).default("pending"),
        seller_id: z.string().uuid().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("orders").insert({
      id: data.id,
      user_id: userId,
      seller_id: data.seller_id ?? null,
      status: "pending",
      payment_status: data.payment_status,
      total_amount: data.total_amount,
      commission_amount: data.commission_amount,
      seller_earnings: data.seller_earnings,
    });
    if (error) {
      console.error("recordOrder insert failed:", error);
      return { ok: false as const, error: error.message };
    }
    return { ok: true as const };
  });

export const updateOrderPaymentStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().min(1),
        payment_status: z.enum(["pending", "paid", "failed"]),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("orders")
      .update({ payment_status: data.payment_status })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) {
      console.error("updateOrderPaymentStatus failed:", error);
      return { ok: false as const, error: error.message };
    }
    return { ok: true as const };
  });
