// Easyship API: track a shipment by tracking number.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const EASYSHIP_BASE_URL = "https://api.easyship.com";

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

    const url = new URL(req.url);
    let trackingNumber = url.searchParams.get("tracking_number") ?? "";
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      trackingNumber = body?.tracking_number ?? trackingNumber;
    }
    trackingNumber = String(trackingNumber).trim();
    if (!trackingNumber || trackingNumber.length > 120) {
      return new Response(
        JSON.stringify({ error: "tracking_number is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Try the v2024-09 tracking endpoint first, fall back to legacy.
    const endpoints = [
      `/2024-09/trackings/${encodeURIComponent(trackingNumber)}`,
      `/2024-09/trackings?tracking_number=${encodeURIComponent(trackingNumber)}`,
      `/2023-01/track?tracking_number=${encodeURIComponent(trackingNumber)}`,
    ];

    let lastStatus = 0;
    let lastBody: unknown = null;
    for (const path of endpoints) {
      const res = await fetch(`${EASYSHIP_BASE_URL}${path}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
      });
      const data = await res.json().catch(() => ({}));
      lastStatus = res.status;
      lastBody = data;
      if (!res.ok) continue;

      type RawCheckpoint = {
        status?: string;
        message?: string;
        description?: string;
        location?: string;
        city?: string;
        country?: string;
        checkpoint_time?: string;
        timestamp?: string;
        time?: string;
      };
      type RawTrack = Record<string, unknown> & {
        tracking?: RawTrack;
        status?: string;
        current_status?: string;
        courier_name?: string;
        courier?: { name?: string };
        estimated_delivery_date?: string;
        eta?: string;
        last_location?: string;
        checkpoints?: RawCheckpoint[];
        tracking_checkpoints?: RawCheckpoint[];
        events?: RawCheckpoint[];
      };
      const t: RawTrack = ((data as RawTrack)?.tracking ?? data) as RawTrack;
      const checkpoints =
        t.checkpoints ?? t.tracking_checkpoints ?? t.events ?? [];
      const normalized = checkpoints
        .map((c) => ({
          status: c.status ?? "",
          message: c.message ?? c.description ?? "",
          location:
            c.location ??
            [c.city, c.country].filter(Boolean).join(", ") ??
            "",
          time: c.checkpoint_time ?? c.timestamp ?? c.time ?? null,
        }))
        .sort((a, b) => {
          const ta = a.time ? new Date(a.time).getTime() : 0;
          const tb = b.time ? new Date(b.time).getTime() : 0;
          return tb - ta;
        });

      const latest = normalized[0];
      const status = (t.current_status ?? t.status ?? latest?.status ?? "unknown")
        .toString()
        .toLowerCase();
      const courierName = t.courier_name ?? t.courier?.name ?? null;
      const eta = t.estimated_delivery_date ?? t.eta ?? null;

      return new Response(
        JSON.stringify({
          success: true,
          tracking_number: trackingNumber,
          status,
          courier_name: courierName,
          current_location: latest?.location ?? t.last_location ?? null,
          last_update: latest?.time ?? null,
          estimated_delivery: eta,
          checkpoints: normalized,
          raw: data,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: `Easyship tracking unavailable [${lastStatus}]`,
        details: lastBody,
      }),
      { status: lastStatus || 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
