// Easyship API: shipping rate calculator
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { z } from "https://esm.sh/zod@3.23.8";

const EASYSHIP_BASE_URL = "https://api.easyship.com";
// Account token is issued for 2024-09+; older /2023-01 returns 403.
const RATES_PATH = "/2024-09/rates";

const AddressSchema = z.object({
  country_alpha2: z.string().length(2),
  city: z.string().min(1).max(120),
  postal_code: z.string().min(1).max(20),
  state: z.string().max(120).optional(),
  line_1: z.string().max(200).optional(),
});

const BodySchema = z.object({
  origin: AddressSchema.default({
    country_alpha2: "PH",
    city: "Manila",
    postal_code: "1000",
  }),
  destination: AddressSchema,
  weight_kg: z.number().positive().max(1000),
  length_cm: z.number().positive().max(300),
  width_cm: z.number().positive().max(300),
  height_cm: z.number().positive().max(300),
  declared_value: z.number().nonnegative().max(1_000_000).default(100),
  currency: z.string().length(3).default("PHP"),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("EASYSHIP_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "EASYSHIP_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const json = await req.json().catch(() => null);
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: parsed.error.flatten().fieldErrors }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const p = parsed.data;

    const payload = {
      origin_address: p.origin,
      destination_address: p.destination,
      incoterms: "DDU",
      parcels: [
        {
          total_actual_weight: p.weight_kg,
          box: {
            length: p.length_cm,
            width: p.width_cm,
            height: p.height_cm,
          },
          items: [
            {
              actual_weight: p.weight_kg,
              declared_currency: p.currency,
              declared_customs_value: p.declared_value,
              quantity: 1,
              description: "Merchandise",
              category: "fashion",
            },
          ],
        },
      ],
    };

    const res = await fetch(`${EASYSHIP_BASE_URL}${RATES_PATH}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("Easyship rates error:", res.status, data);
      return new Response(
        JSON.stringify({
          success: false,
          error: `Easyship API error [${res.status}]`,
          details: data,
        }),
        { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    type RawRate = Record<string, unknown> & {
      courier_name?: string;
      courier_display_name?: string;
      total_charge?: number;
      shipment_charge_total?: number;
      currency?: string;
      min_delivery_time?: number;
      max_delivery_time?: number;
      delivery_time_rank?: number;
      value_for_money_rank?: number;
      courier_logo_url?: string;
      courier_id?: string;
    };

    const rawRates: RawRate[] = (data?.rates ?? []) as RawRate[];
    const rates = rawRates.map((r) => ({
      courier_id: r.courier_id ?? null,
      courier_name: r.courier_display_name ?? r.courier_name ?? "Courier",
      logo_url: r.courier_logo_url ?? null,
      cost: r.total_charge ?? r.shipment_charge_total ?? null,
      currency: r.currency ?? p.currency,
      min_days: r.min_delivery_time ?? null,
      max_days: r.max_delivery_time ?? null,
      delivery_time_rank: r.delivery_time_rank ?? null,
      value_for_money_rank: r.value_for_money_rank ?? null,
    }));

    return new Response(
      JSON.stringify({ success: true, count: rates.length, rates }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("easyship-rates error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
