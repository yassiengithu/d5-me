// PayMongo source/payment intent creation - secret key stays server-side.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { z } from "https://esm.sh/zod@3.23.8";

const BodySchema = z.object({
  amount: z.number().int().positive().max(100_000_000), // centavos
  currency: z.string().length(3).default("PHP"),
  description: z.string().max(500).optional(),
  type: z.enum(["gcash", "grab_pay", "paymaya", "card"]).default("gcash"),
  redirect: z.object({
    success: z.string().url(),
    failed: z.string().url(),
  }),
  remarks: z.string().max(255).optional(),
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

    const { amount, currency, description, type, redirect, remarks } = parsed.data;

    const auth = "Basic " + btoa(`${secretKey}:`);
    const res = await fetch("https://api.paymongo.com/v1/sources", {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        data: {
          attributes: {
            amount,
            currency,
            type,
            redirect,
            ...(description ? { description } : {}),
            ...(remarks ? { remarks } : {}),
          },
        },
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error("PayMongo error:", data);
      return new Response(
        JSON.stringify({ error: data?.errors?.[0]?.detail ?? "PayMongo request failed" }),
        { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Return only what the client needs - never the secret key.
    const source = data?.data;
    return new Response(
      JSON.stringify({
        id: source?.id,
        status: source?.attributes?.status,
        checkout_url: source?.attributes?.redirect?.checkout_url,
        type: source?.attributes?.type,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("paymongo-create-source error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
