// PayMongo Checkout Session creation - secret key stays server-side.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { z } from "https://esm.sh/zod@3.23.8";

const LineItemSchema = z.object({
  name: z.string().min(1).max(255),
  quantity: z.number().int().positive().max(1000),
  amount: z.number().positive().max(1_000_000), // PHP (pesos), converted to centavos below
  description: z.string().max(500).optional(),
  currency: z.string().length(3).default("PHP"),
});

const BodySchema = z.object({
  line_items: z.array(LineItemSchema).min(1).max(50),
  success_url: z.string().url(),
  cancel_url: z.string().url(),
  description: z.string().max(500).optional(),
  reference_number: z.string().max(255).optional(),
  customer_email: z.string().email().optional(),
  order_id: z.string().uuid().optional(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const secretKey = Deno.env.get("PAYMONGO_SECRET_KEY");
    if (!secretKey) {
      return new Response(JSON.stringify({ error: "PayMongo not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const json = await req.json().catch(() => null);
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: parsed.error.flatten().fieldErrors }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { line_items, success_url, cancel_url, description, reference_number, customer_email, order_id } = parsed.data;

    // Convert PHP -> centavos (PayMongo requires integer minor units).
    const items = line_items.map((li) => ({
      name: li.name,
      quantity: li.quantity,
      amount: Math.round(li.amount * 100),
      currency: li.currency,
      ...(li.description ? { description: li.description } : {}),
    }));

    const auth = "Basic " + btoa(`${secretKey}:`);
    const res = await fetch("https://api.paymongo.com/v1/checkout_sessions", {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        data: {
          attributes: {
            line_items: items,
            payment_method_types: ["gcash", "card"],
            success_url,
            cancel_url,
            ...(description ? { description } : {}),
            ...(reference_number ? { reference_number } : {}),
            ...(customer_email ? { billing: { email: customer_email } } : {}),
            ...(order_id ? { metadata: { order_id } } : {}),
          },
        },
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error("PayMongo checkout error:", data);
      return new Response(
        JSON.stringify({ error: data?.errors?.[0]?.detail ?? "PayMongo request failed" }),
        { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const session = data?.data;
    return new Response(
      JSON.stringify({
        id: session?.id,
        checkout_url: session?.attributes?.checkout_url,
        reference_number: session?.attributes?.reference_number,
        status: session?.attributes?.status,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("paymongo-create-checkout error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
