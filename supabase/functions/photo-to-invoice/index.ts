import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, runVisionEngine, computeTotals } from "../_shared/aiEngine.ts";
import { generateInvoiceHTML, htmlToPdf } from "../_shared/pdfGenerator.ts";

// ─────────────────────────────────────────────────────────────
// TRADESPAY AI — Photo-to-Invoice Edge Function (Deno)
// ─────────────────────────────────────────────────────────────
// POST JSON { imageBase64, description?, generatePdf? }
// → Vision AI extracts invoice data → returns JSON + optional PDF
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
    const { imageBase64, description, generatePdf } = await req.json();

    if (!imageBase64) {
      return new Response(
        JSON.stringify({ error: "Missing required image (base64)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Run Vision AI
    const engine = Deno.env.get("INVOICE_AI_ENGINE") ?? "qwen";
    const resultData = await runVisionEngine({
      promptText: `Analyze target invoice imagery metrics layout context. Context details: ${description ?? "None"}.`,
      base64Image: imageBase64,
      engine,
    });

    const invoiceData = (resultData.invoiceData ?? resultData) as Record<string, unknown>;
    const lineItems = (invoiceData.lineItems as Array<Record<string, number>>) ?? [];
    const { subtotal, taxAmount, total } = computeTotals(lineItems);

    const invoiceNumber = (invoiceData.invoiceNumber as string) ?? `INV-${Math.floor(100000 + Math.random() * 900000)}`;
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

    // Optional PDF generation
    if (generatePdf) {
      const html = generateInvoiceHTML({
        invoiceNumber,
        clientName: (invoiceData.clientName as string) ?? "Valued Client",
        clientEmail: invoiceData.clientEmail as string | undefined,
        jobDescription: (invoiceData.jobDescription as string) ?? "Contracting Services",
        currency: (invoiceData.currency as string) ?? "₦",
        lineItems,
        subtotal,
        taxRate: 0.075,
        taxAmount,
        total,
        dueDate: invoiceData.dueDate as string | undefined,
        issuedDate,
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
    console.error("[photo-to-invoice] Error:", message);

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
