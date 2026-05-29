// ─────────────────────────────────────────────────────────────
// TRADESPAY AI — Voice-to-Invoice Edge Function (Deno)
// ─────────────────────────────────────────────────────────────
// Replaces Express routes:
//   POST /api/ai/voice-to-invoice       (text transcript → invoice)
//   POST /api/ai/voice-to-invoice-file  (audio file → whisper → invoice)
//
// Accepts JSON body { transcript, generatePdf? }
//     or multipart form { audio, transcript?, generatePdf? }
// Returns: { invoice, transcript?, pdf? }
// ─────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  corsHeaders,
  runAIEngine,
  transcribeAudio,
  computeTotals,
} from "../_shared/aiEngine.ts";
import { generateInvoiceHTML, htmlToPdf } from "../_shared/pdfGenerator.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed. Use POST." }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  try {
    let transcript: string | undefined;
    let audioBytes: Uint8Array | undefined;
    let audioMimeType: string = "audio/webm";
    let generatePdf = false;

    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      // ── Audio file upload mode (was /api/ai/voice-to-invoice-file) ──
      const formData = await req.formData();

      const audioFile = formData.get("audio") as File | null;
      if (!audioFile) {
        return new Response(
          JSON.stringify({ error: "No audio file uploaded" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      audioBytes = new Uint8Array(await audioFile.arrayBuffer());
      audioMimeType = audioFile.type || "audio/webm";

      transcript = (formData.get("transcript") as string) ?? undefined;
      generatePdf = formData.get("generatePdf") === "true";
    } else if (contentType.includes("application/json")) {
      // ── JSON body mode (was /api/ai/voice-to-invoice) ──
      const body = await req.json();
      transcript = body.transcript;
      generatePdf = body.generatePdf === true;

      if (!transcript) {
        return new Response(
          JSON.stringify({ error: "Empty transcription payload provided" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    } else {
      return new Response(
        JSON.stringify({
          error:
            "Unsupported Content-Type. Use application/json or multipart/form-data.",
        }),
        {
          status: 415,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Step 1: Transcribe audio if uploaded and no transcript override
    if (audioBytes && !transcript) {
      transcript = await transcribeAudio(audioBytes, audioMimeType);
      if (!transcript) {
        return new Response(
          JSON.stringify({ error: "Failed to extract text from audio" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    // Step 2: Route to AI Engine
    const engine = Deno.env.get("INVOICE_AI_ENGINE") ?? "groq";
    const resultData = await runAIEngine({
      promptText: `Extract invoice datasets out of transcript: "${transcript}"`,
      engine,
    });

    const invoiceData = (resultData.invoiceData ?? resultData) as Record<
      string,
      unknown
    >;
    const lineItems = (invoiceData.lineItems as
      | Array<Record<string, number>>
      | undefined) ?? [];
    const { subtotal, taxAmount, total } = computeTotals(lineItems);

    const invoiceNumber =
      (invoiceData.invoiceNumber as string) ??
      `INV-${Math.floor(100000 + Math.random() * 900000)}`;
    const issuedDate = new Date().toISOString().split("T")[0];

    const invoice = {
      ...invoiceData,
      invoiceNumber,
      issuedDate,
      subtotal,
      taxRate: 0.075,
      taxAmount,
      total,
    };

    const responsePayload: Record<string, unknown> = { invoice };
    if (audioBytes) {
      responsePayload.transcript = transcript;
    }

    // Step 3: Optional PDF generation
    if (generatePdf) {
      const html = generateInvoiceHTML({
        invoiceNumber,
        clientName:
          (invoiceData.clientName as string) ?? "Valued Client",
        clientEmail: invoiceData.clientEmail as string | undefined,
        jobDescription:
          (invoiceData.jobDescription as string) ??
          "Contracting Services",
        currency: (invoiceData.currency as string) ?? "₦",
        lineItems,
        subtotal,
        taxRate: 0.075,
        taxAmount,
        total,
        issuedDate,
        dueDate: invoiceData.dueDate as string | undefined,
      });

      const pdfResult = await htmlToPdf(html, `${invoiceNumber}.pdf`);
      const base64Pdf = btoa(String.fromCharCode(...pdfResult.pdfBytes));

      responsePayload.pdf = {
        base64: base64Pdf,
        contentType: pdfResult.contentType,
        filename: `${invoiceNumber}.pdf`,
      };
    }

    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown server error";
    console.error("[voice-to-invoice] Error:", message);

    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
