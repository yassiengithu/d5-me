// Easyship API: list couriers (sandbox)
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const EASYSHIP_BASE_URL = "https://api.easyship.com";

async function fetchCouriers(apiKey: string) {
  const res = await fetch(`${EASYSHIP_BASE_URL}/2023-01/couriers`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Easyship API error [${res.status}]: ${JSON.stringify(data)}`,
    );
  }
  return data;
}

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

    const data = await fetchCouriers(apiKey);
    const couriers = data?.couriers ?? data?.data ?? [];

    return new Response(
      JSON.stringify({
        success: true,
        count: Array.isArray(couriers) ? couriers.length : 0,
        couriers,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("easyship-couriers error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
