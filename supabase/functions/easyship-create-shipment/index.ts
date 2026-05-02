// Easyship API: create a shipment and persist it.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { z } from "https://esm.sh/zod@3.23.8";

const EASYSHIP_BASE_URL = "https://api.easyship.com";
// Account tokens are issued for 2024-09+; older /2023-01 returns 403.
const SHIPMENTS_PATH = "/2024-09/shipments";

const AddressSchema = z.object({
  contact_name: z.string().min(1).max(120),
  contact_phone: z.string().min(3).max(40),
  contact_email: z.string().email().optional(),
  company_name: z.string().max(120).optional(),
  country_alpha2: z.string().length(2),
  city: z.string().min(1).max(120),
  postal_code: z.string().min(1).max(20),
  state: z.string().max(120).optional(),
  line_1: z.string().min(1).max(200),
  line_2: z.string().max(200).optional(),
});

const ParcelSchema = z.object({
  weight_kg: z.number().positive().max(1000),
  length_cm: z.number().positive().max(300),
  width_cm: z.number().positive().max(300),
  height_cm: z.number().positive().max(300),
  declared_value: z.number().nonnegative().max(1_000_000).default(100),
  currency: z.string().length(3).default("PHP"),
  description: z.string().max(200).default("Merchandise"),
});

const BodySchema = z.object({
  sender: AddressSchema,
  receiver: AddressSchema,
  parcel: ParcelSchema,
  courier_id: z.string().min(1).max(120),
  order_id: z.string().uuid().optional(),
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

    // Authenticate caller — RLS requires a real user.
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userRes.user.id;

    const json = await req.json().catch(() => null);
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: parsed.error.flatten().fieldErrors }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { sender, receiver, parcel, courier_id, order_id } = parsed.data;

    const payload = {
      selected_courier_id: courier_id,
      courier_id, // some Easyship versions accept this top-level key
      incoterms: "DDU",
      origin_address: {
        contact_name: sender.contact_name,
        contact_phone: sender.contact_phone,
        ...(sender.contact_email ? { contact_email: sender.contact_email } : {}),
        ...(sender.company_name ? { company_name: sender.company_name } : {}),
        country_alpha2: sender.country_alpha2,
        city: sender.city,
        postal_code: sender.postal_code,
        ...(sender.state ? { state: sender.state } : {}),
        line_1: sender.line_1,
        ...(sender.line_2 ? { line_2: sender.line_2 } : {}),
      },
      destination_address: {
        contact_name: receiver.contact_name,
        contact_phone: receiver.contact_phone,
        ...(receiver.contact_email ? { contact_email: receiver.contact_email } : {}),
        ...(receiver.company_name ? { company_name: receiver.company_name } : {}),
        country_alpha2: receiver.country_alpha2,
        city: receiver.city,
        postal_code: receiver.postal_code,
        ...(receiver.state ? { state: receiver.state } : {}),
        line_1: receiver.line_1,
        ...(receiver.line_2 ? { line_2: receiver.line_2 } : {}),
      },
      parcels: [
        {
          total_actual_weight: parcel.weight_kg,
          box: {
            length: parcel.length_cm,
            width: parcel.width_cm,
            height: parcel.height_cm,
          },
          items: [
            {
              actual_weight: parcel.weight_kg,
              declared_currency: parcel.currency,
              declared_customs_value: parcel.declared_value,
              quantity: 1,
              description: parcel.description,
              category: "fashion",
            },
          ],
        },
      ],
    };

    const res = await fetch(`${EASYSHIP_BASE_URL}${SHIPMENTS_PATH}`, {
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
      console.error("Easyship shipment error:", res.status, data);
      return new Response(
        JSON.stringify({
          success: false,
          error: data?.error?.message ?? `Easyship API error [${res.status}]`,
          details: data,
        }),
        { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    type RawShipment = Record<string, unknown> & {
      easyship_shipment_id?: string;
      shipment_id?: string;
      id?: string;
      tracking_number?: string;
      tracking_page_url?: string;
      label_url?: string;
      shipping_documents?: { format?: string; type?: string; url?: string }[];
      selected_courier_name?: string;
      courier_name?: string;
      shipment_charge_total?: number;
      total_charge?: number;
      currency?: string;
    };
    const ship: RawShipment = (data?.shipment ?? data) as RawShipment;
    const easyshipShipmentId =
      ship.easyship_shipment_id ?? ship.shipment_id ?? ship.id ?? null;
    const trackingNumber = ship.tracking_number ?? null;
    const labelDoc = ship.shipping_documents?.find(
      (d) => (d.type ?? "").toLowerCase().includes("label"),
    );
    const labelUrl = ship.label_url ?? labelDoc?.url ?? null;
    const courierName = ship.selected_courier_name ?? ship.courier_name ?? null;
    const cost = ship.shipment_charge_total ?? ship.total_charge ?? null;
    const currency = ship.currency ?? parcel.currency;

    // Persist to DB (RLS: user_id = auth.uid()).
    const { data: inserted, error: insertErr } = await supabase
      .from("shipments")
      .insert({
        user_id: userId,
        order_id: order_id ?? null,
        easyship_shipment_id: easyshipShipmentId,
        tracking_number: trackingNumber,
        label_url: labelUrl,
        courier_id,
        courier_name: courierName,
        sender,
        receiver,
        parcel,
        cost,
        currency,
        status: "created",
        raw_response: data,
      })
      .select("id")
      .single();

    if (insertErr) {
      console.error("shipments insert error:", insertErr);
      return new Response(
        JSON.stringify({
          success: true,
          warning: "Shipment created but failed to save locally",
          easyship_shipment_id: easyshipShipmentId,
          tracking_number: trackingNumber,
          label_url: labelUrl,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        id: inserted.id,
        easyship_shipment_id: easyshipShipmentId,
        tracking_number: trackingNumber,
        label_url: labelUrl,
        courier_name: courierName,
        cost,
        currency,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("easyship-create-shipment error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
