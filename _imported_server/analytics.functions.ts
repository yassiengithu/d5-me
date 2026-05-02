import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ProductMetric = {
  product_id: number;
  count: number;
};

export type ProductAnalytics = {
  topViewed: ProductMetric[];
  topSelling: ProductMetric[];
};

export const getProductAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ProductAnalytics> => {
    const { supabase } = context;

    const [viewedRes, soldRes] = await Promise.all([
      supabase.rpc("get_top_viewed_products", { _limit: 10 }),
      supabase.rpc("get_top_selling_products", { _limit: 10 }),
    ]);

    if (viewedRes.error) throw viewedRes.error;
    if (soldRes.error) throw soldRes.error;

    const topViewed: ProductMetric[] = (viewedRes.data ?? []).map((r: any) => ({
      product_id: Number(r.product_id),
      count: Number(r.view_count),
    }));
    const topSelling: ProductMetric[] = (soldRes.data ?? []).map((r: any) => ({
      product_id: Number(r.product_id),
      count: Number(r.units_sold),
    }));

    return { topViewed, topSelling };
  });
