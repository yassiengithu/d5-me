import { supabase } from "@/integrations/supabase/client";

export type PayMongoSourceType = "gcash" | "grab_pay" | "paymaya" | "card";

export interface CreateSourceInput {
  /** Amount in PHP (e.g., 199.50). Will be converted to centavos. */
  amountPhp: number;
  type: PayMongoSourceType;
  description?: string;
  successUrl: string;
  failedUrl: string;
  remarks?: string;
}

export interface PayMongoSource {
  id: string;
  status: string;
  checkout_url: string;
  type: string;
}

/**
 * Create a PayMongo source via our secure edge function.
 * The secret key never touches the browser.
 */
export async function createPayMongoSource(input: CreateSourceInput): Promise<PayMongoSource> {
  const amount = Math.round(input.amountPhp * 100);
  const { data, error } = await supabase.functions.invoke("paymongo-create-source", {
    body: {
      amount,
      currency: "PHP",
      type: input.type,
      description: input.description,
      remarks: input.remarks,
      redirect: { success: input.successUrl, failed: input.failedUrl },
    },
  });
  if (error) throw new Error(error.message);
  if (!data?.checkout_url) throw new Error("No checkout URL returned");
  return data as PayMongoSource;
}
