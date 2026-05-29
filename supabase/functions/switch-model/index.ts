import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// ─────────────────────────────────────────────────────────────
// TRADESPAY AI — Switch Model Edge Function
// ─────────────────────────────────────────────────────────────
// POST { model: "groq" | "qwen" | "cerebras" | "gemini" }
// GET  → returns current active model
//
// Reads/writes `model_config` table so any function can check
// the current active model before falling back to env vars.
// ─────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const VALID_MODELS = ["groq", "qwen", "cerebras", "gemini", "openai"];

async function getCurrentModel(): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/model_config?select=model&limit=1`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
    },
  });
  if (res.ok) {
    const data = await res.json();
    if (data.length > 0) return data[0].model;
  }
  // Fallback to env var
  return Deno.env.get("INVOICE_AI_ENGINE") ?? "groq";
}

async function setActiveModel(model: string): Promise<void> {
  // Upsert into model_config table
  const body = JSON.stringify([{ key: "active_model", model }]);
  await fetch(`${SUPABASE_URL}/rest/v1/model_config`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body,
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method === "GET") {
      const current = await getCurrentModel();
      return new Response(
        JSON.stringify({ current_model: current, available: VALID_MODELS }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (req.method === "POST") {
      const { model } = await req.json();

      if (!model || !VALID_MODELS.includes(model)) {
        return new Response(
          JSON.stringify({ error: `Invalid model. Choose: ${VALID_MODELS.join(", ")}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      await setActiveModel(model);

      return new Response(
        JSON.stringify({ success: true, active_model: model, available: VALID_MODELS }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response("Method not allowed", {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
