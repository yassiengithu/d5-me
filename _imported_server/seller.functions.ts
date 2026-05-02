import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type SellerOrder = {
  id: string;
  status: string;
  total_amount: number;
  seller_earnings: number;
  created_at: string;
};

export const getSellerOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SellerOrder[]> => {
    const { supabase, userId } = context;

    const { data, error } = await supabase
      .from("orders")
      .select("id, status, total_amount, seller_earnings, created_at")
      .eq("seller_id", userId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw error;
    return (data ?? []) as SellerOrder[];
  });
