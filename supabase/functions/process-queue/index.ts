import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// ─────────────────────────────────────────────────────────────
// TRADESPAY AI — Process Queue Worker (Deno)
// ─────────────────────────────────────────────────────────────
// Cron-triggered worker. Polls webhook_queue for pending messages,
// runs AI engine, sends reply via Meta API, logs everything.
//
// Trigger via:
//   - Supabase cron job
//   - External scheduler (GitHub Actions, cron-job.org, etc.)
//   - Manual: curl -X POST <function-url>
// ─────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_PAGE_ACCESS_TOKEN = Deno.env.get("META_PAGE_ACCESS_TOKEN") ?? "";
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";

// ─── AI Engine (inlined to avoid cross-function imports in cron context) ───

const SYSTEM_PROMPT =
`You are "Tradespay Sales Assistant", an expert Sales Auto-Pilot.
GOAL: Extract key structured details from user inputs or conversations to convert leads into sales and generate structured invoices.
CRITICAL OUTPUT RULES: You must ALWAYS return pure JSON matching the schema precisely. Never output conversational pleasantries or markdown backticks outside the JSON.

JSON Schema:
{
    "replyText": "Professional response tailored to the client",
    "invoiceData": {
        "clientName": "Extracted name or 'Valued Client'",
        "jobDescription": "Full detailed scope of work",
        "currency": "Default to ₦, switch to $, €, or £ if explicitly mentioned",
        "lineItems": [
            { "description": "Item description", "quantity": 1, "unitPrice": 0, "amount": 0 }
        ]
    }
}`;

async function callAI(prompt: string, engine: string): Promise<string> {
  const fullPrompt = `${SYSTEM_PROMPT}\n\nUser Input: ${prompt}`;

  if (engine === "groq") {
    const apiKey = Deno.env.get("GROQ_API_KEY");
    if (!apiKey) throw new Error("GROQ_API_KEY not configured");
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: fullPrompt }] }),
    });
    if (!res.ok) throw new Error(`Groq error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.choices[0].message.content;
  }

  if (engine === "gemini") {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("GEMINI_API_KEY not configured");
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: fullPrompt }] }] }),
      }
    );
    if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  }

  throw new Error(`Unsupported engine: ${engine}`);
}

function parseAIResponse(raw: string): Record<string, unknown> {
  let cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No valid JSON in AI response");
  return JSON.parse(cleaned.substring(start, end + 1));
}

// ─── Database Helpers ────────────────────────────────────────

async function fetchPendingQueue(limit: number = 10) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/webhook_queue?status=eq.pending&order=created_at.asc&limit=${limit}`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
      },
    }
  );
  if (!res.ok) throw new Error(`Queue fetch error ${res.status}: ${await res.text()}`);
  return await res.json();
}

async function updateQueueStatus(id: string, status: string, error?: string) {
  const body: Record<string, unknown> = { status };
  if (error) body.error_message = error;
  if (status === "completed" || status === "failed") body.processed_at = new Date().toISOString();

  const res = await fetch(`${SUPABASE_URL}/rest/v1/webhook_queue?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error(`Queue update failed for ${id}:`, await res.text());
}

async function lookupProfile(lookupId: string, platform: string) {
  // Search across all possible ID fields
  const fields = ["meta_webhook_recipient_id", "whatsapp_id", "instagram_id", "whatsapp_number"];
  const conditions = fields.map((f) => `${f}.eq.${lookupId}`).join(",");

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/user_profiles?or=(${conditions})&limit=1`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
      },
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data[0] ?? null;
}

// ─── Send Outbound Message via Meta API ─────────────────────

async function sendOutboundMessage(recipientId: string, text: string, platform: string) {
  const accessToken = META_PAGE_ACCESS_TOKEN;
  if (!accessToken) throw new Error("META_PAGE_ACCESS_TOKEN not configured");

  let url: string;
  let payload: Record<string, unknown>;

  if (platform === "whatsapp" || platform === "whatsapp_business_account") {
    if (!WHATSAPP_PHONE_NUMBER_ID) throw new Error("WHATSAPP_PHONE_NUMBER_ID not configured");
    url = `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_NUMBER_ID}/messages?access_token=${accessToken}`;
    payload = {
      messaging_product: "whatsapp",
      to: recipientId,
      type: "text",
      text: { body: text },
    };
  } else {
    // Instagram / Facebook Messenger
    url = `https://graph.facebook.com/v21.0/me/messages?access_token=${accessToken}`;
    payload = {
      recipient: { id: recipientId },
      message: { text },
    };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Meta API error ${res.status}: ${errBody}`);
  }

  return await res.json();
}

// ─── Main Handler ───────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Fetch pending messages (max 10 per run)
    const pending = await fetchPendingQueue(10);

    if (!pending || pending.length === 0) {
      return new Response(
        JSON.stringify({ status: "idle", message: "No pending messages" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`🔄 Processing ${pending.length} pending message(s)...`);

    const results: Array<{ sender_id: string; status: string; error?: string }> = [];
    // Resolve engine: env var -> model_config table -> default "groq"
    let engine = Deno.env.get("AUTOPILOT_AI_ENGINE");
    if (!engine) {
      const sUrl = Deno.env.get("SUPABASE_URL");
      const sKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (sUrl && sKey) {
        try {
          const r = await fetch(`${sUrl}/rest/v1/model_config?select=model&limit=1`, {
            headers: { apikey: sKey, Authorization: `Bearer ${sKey}` },
          });
          if (r.ok) {
            const d = await r.json();
            if (d.length > 0) engine = d[0].model;
          }
        } catch { /* table not created yet - fall through */ }
      }
    }
    engine = engine ?? "groq";

    for (const item of pending) {
      try {
        const { id, sender_id, platform, message_text } = item;

        // Mark as processing
        await updateQueueStatus(id, "processing");

        // Look up user profile
        const profile = await lookupProfile(sender_id, platform);
        if (!profile) {
          console.log(`⚠️ Unregistered sender ${sender_id}, skipping`);
          await updateQueueStatus(id, "failed", "User not registered");
          results.push({ sender_id, status: "skipped", error: "Unregistered user" });
          continue;
        }

        // Check plan tier
        if (profile.plan !== "premium" && Deno.env.get("TESTING_MODE") !== "true") {
          console.log(`🚫 User ${profile.id} on ${profile.plan} plan, skipped`);
          await updateQueueStatus(id, "failed", `Plan: ${profile.plan}`);
          results.push({ sender_id, status: "blocked", error: `Plan: ${profile.plan}` });
          continue;
        }

        // Run AI engine
        const aiRaw = await callAI(message_text, engine);
        const aiResult = parseAIResponse(aiRaw);
        const replyText = (aiResult.replyText as string) ??
          "Thanks for your message. We'll get back to you shortly.";

        // Send reply
        await sendOutboundMessage(sender_id, replyText, platform);

        // Log outbound message
        await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
          method: "POST",
          headers: {
            apikey: SUPABASE_SERVICE_ROLE,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            user_id: profile.id,
            platform,
            sender_id: "me",
            recipient_id: sender_id,
            text: replyText,
            direction: "outbound",
          }),
        });

        await updateQueueStatus(id, "completed");
        results.push({ sender_id, status: "completed" });
        console.log(`✅ Replied to ${sender_id}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error(`❌ Failed processing ${item.sender_id}:`, message);

        // Increment retry count
        const retryCount = (item.retry_count ?? 0) + 1;
        if (retryCount >= 5) {
          await updateQueueStatus(item.id, "failed", message);
        } else {
          // Reset to pending for retry on next run
          await updateQueueStatus(item.id, "pending", message);
          // Bump retry count
          await fetch(`${SUPABASE_URL}/rest/v1/webhook_queue?id=eq.${item.id}`, {
            method: "PATCH",
            headers: {
              apikey: SUPABASE_SERVICE_ROLE,
              Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ retry_count: retryCount }),
          });
        }
        results.push({ sender_id: item.sender_id, status: "error", error: message });
      }
    }

    return new Response(
      JSON.stringify({
        status: "processed",
        total: pending.length,
        results,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown server error";
    console.error("[process-queue] Error:", message);

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
