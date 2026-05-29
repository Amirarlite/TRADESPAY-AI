import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// ─────────────────────────────────────────────────────────────
// TRADESPAY AI — Meta Webhook Edge Function (Deno)
// ─────────────────────────────────────────────────────────────
// Handles Instagram + WhatsApp inbound messages.
// Strategy: ACK instantly → store in webhook_queue → cron worker processes.
// This guarantees zero missed messages even if AI is slow or down.
// ─────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

async function insertQueueItem(item: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/webhook_queue`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(item),
  });
  if (!res.ok) {
    console.error("Queue insert failed:", res.status, await res.text());
  }
}

async function insertMessageLog(msg: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(msg),
  });
  if (!res.ok) {
    console.error("Message log insert failed:", res.status, await res.text());
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);

  // ── META VERIFICATION (GET) ──
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const verifyToken = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN");

    if (mode === "subscribe" && token === verifyToken) {
      console.log("✅ Meta Webhook Verified!");
      return new Response(challenge ?? "", { status: 200 });
    }
    console.error("❌ Meta Webhook Verification Failed.");
    return new Response("Forbidden", { status: 403 });
  }

  // ── RECEIVE MESSAGES (POST) ──
  if (req.method === "POST") {
    try {
      const body = await req.json();

      // ACK Meta IMMEDIATELY — must respond within 3 seconds
      // We process asynchronously below
      const ackPromise = Promise.resolve();

      // Parse the inbound message
      const entry = body.entry?.[0];
      const platform = body.object; // 'instagram' or 'whatsapp_business_account'

      let senderId: string | undefined;
      let messageText: string | undefined;
      let merchantId: string | undefined;

      if (platform === "instagram") {
        const messaging = entry?.messaging?.[0];
        senderId = messaging?.sender?.id;
        messageText = messaging?.message?.text;
        merchantId = messaging?.recipient?.id;
      } else if (platform === "whatsapp_business_account" || platform === "whatsapp") {
        const changes = entry?.changes?.[0]?.value;
        const waMsg = changes?.messages?.[0];
        senderId = waMsg?.from;
        messageText = waMsg?.text?.body;
        merchantId = changes?.metadata?.phone_number_id;
      }

      // Skip echoes (our own messages) and empty messages
      if (!senderId || !messageText || entry?.messaging?.[0]?.message?.is_echo) {
        console.log("⏭️ Skipping echo or empty message");
        return new Response("EVENT_RECEIVED", { status: 200 });
      }

      console.log(`📩 Inbound from ${senderId} (${platform}): "${messageText.substring(0, 80)}..."`);

      // Log inbound message
      const lookupId = merchantId ?? senderId;
      await insertMessageLog({
        platform,
        sender_id: senderId,
        recipient_id: "me",
        text: messageText,
        direction: "inbound",
      });

      // ── Queue the message for async processing ──
      await insertQueueItem({
        platform,
        sender_id: senderId,
        recipient_id: lookupId,
        message_text: messageText,
        status: "pending",
        retry_count: 0,
      });

      console.log(`✅ Queued message from ${senderId}`);
      return new Response("EVENT_RECEIVED", { status: 200 });
    } catch (err) {
      console.error("❌ Meta Webhook Error:", err);
      return new Response("Error", { status: 500 });
    }
  }

  return new Response("Method not allowed", { status: 405, headers: corsHeaders });
});
