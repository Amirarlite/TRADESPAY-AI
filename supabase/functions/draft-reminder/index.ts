import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, runAIEngine } from "../_shared/aiEngine.ts";

// ─────────────────────────────────────────────────────────────
// TRADESPAY AI — Draft Reminder Edge Function (Deno)
// ─────────────────────────────────────────────────────────────
// POST JSON { clientName, amountDue, invoiceNumber }
// → AI drafts a polite payment reminder email
// Returns: { subject, body }
// ─────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const { clientName, amountDue, invoiceNumber } = await req.json();

    const prompt = `Draft a polite, professional, and slightly persistent invoice payment reminder email for customer "${clientName ?? "Client"}" regarding invoice #${invoiceNumber ?? "0000"} with outstanding balance "${amountDue ?? "$0"}.`;

    let draftText = "";
    try {
      const resultData = await runAIEngine({
        promptText: prompt,
        engine: "groq",
      });
      draftText = (resultData.replyText as string) ??
        `This is a friendly reminder that invoice #${invoiceNumber ?? "0000"} is currently outstanding. Please settle this amount at your earliest convenience.`;
    } catch (_err) {
      draftText = `Hi ${clientName ?? "Client"},\n\nHope you are well. This is a friendly reminder regarding invoice #${invoiceNumber ?? "0000"} with outstanding balance of ${amountDue ?? "$0"}.\n\nPlease settle this amount at your earliest convenience. Thank you!`;
    }

    return new Response(
      JSON.stringify({
        subject: `Payment Reminder: Invoice #${invoiceNumber ?? "0000"}`,
        body: draftText,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown server error";
    console.error("[draft-reminder] Error:", message);

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
