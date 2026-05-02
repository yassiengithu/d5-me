// PayMongo webhook receiver. Public endpoint - signature verified with secret key.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

async function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  webhookSecret: string,
): Promise<boolean> {
  if (!signatureHeader) return false;
  // PayMongo header format: t=<timestamp>,te=<test_sig>,li=<live_sig>
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => p.split("=") as [string, string]),
  );
  const timestamp = parts.t;
  const provided = parts.li ?? parts.te;
  if (!timestamp || !provided) return false;

  const payload = `${timestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const expected = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return expected === provided;
}

// Extract order_id from any nested metadata location PayMongo may use.
function extractOrderId(resourceData: any): string | null {
  return (
    resourceData?.attributes?.metadata?.order_id ??
    resourceData?.attributes?.payment_intent?.attributes?.metadata?.order_id ??
    resourceData?.attributes?.data?.attributes?.metadata?.order_id ??
    null
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const webhookSecret = Deno.env.get("PAYMONGO_WEBHOOK_SECRET");
  const rawBody = await req.text();

  // If a webhook secret is configured, require valid signature.
  if (webhookSecret) {
    const ok = await verifySignature(rawBody, req.headers.get("paymongo-signature"), webhookSecret);
    if (!ok) {
      return new Response("Invalid signature", { status: 401, headers: corsHeaders });
    }
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400, headers: corsHeaders });
  }

  const type = event?.data?.attributes?.type;
  const resourceData = event?.data?.attributes?.data;
  const sourceId = resourceData?.id;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (type === "checkout_session.payment.paid" || type === "payment.paid") {
      const orderId = extractOrderId(resourceData);
      if (!orderId) {
        console.warn(`[${type}] missing order_id in metadata`);
      } else {
        // Idempotency: only update if not already paid.
        const { data: existing, error: fetchErr } = await supabase
          .from("orders")
          .select("id, payment_status, status")
          .eq("id", orderId)
          .maybeSingle();

        if (fetchErr) {
          console.error("fetch order error:", fetchErr);
        } else if (!existing) {
          console.warn(`order ${orderId} not found`);
        } else if (existing.payment_status === "paid") {
          console.log(`order ${orderId} already paid - skipping`);
        } else {
          // Setting status='completed' fires triggers:
          //   calculate_order_commission -> commission/earnings amounts
          //   apply_seller_totals_on_completion -> seller aggregates
          const { error: updErr } = await supabase
            .from("orders")
            .update({ payment_status: "paid", status: "completed" })
            .eq("id", orderId)
            .neq("payment_status", "paid"); // extra guard against races

          if (updErr) {
            console.error("update order error:", updErr);
          } else {
            console.log(`order ${orderId} marked paid + completed`);
          }
        }
      }
    } else if (type === "payment.failed" || type === "checkout_session.payment.failed") {
      const orderId = extractOrderId(resourceData);
      if (orderId) {
        await supabase
          .from("orders")
          .update({ payment_status: "failed" })
          .eq("id", orderId)
          .neq("payment_status", "paid"); // never overwrite a paid order
      }
    } else if (type === "source.chargeable" && sourceId) {
      console.log("Source chargeable:", sourceId);
    } else {
      console.log("Unhandled PayMongo event type:", type);
    }
  } catch (err) {
    console.error("webhook handler error:", err);
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
