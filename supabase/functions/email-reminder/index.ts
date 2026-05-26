import "@supabase/functions-js/edge-runtime.d.ts";

// 1. CORS Setup
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export default {
  async fetch(req: Request) {
    // 2. Handle CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }

    try {
      // 3. Extract the invoice details sent from your frontend
      const { toEmail, clientName, amountDue, invoiceNumber, dueDate } = await req.json();

      if (!toEmail) {
        return new Response(JSON.stringify({ error: "Missing recipient email" }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        });
      }

      // 4. Get your Resend API Key from the Supabase Vault
      const resendApiKey = Deno.env.get('RESEND_API_KEY');

      // 5. Draft the HTML Email (This mimics what your AI was drafting)
      const emailHtml = `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px;">
          <h2 style="color: #ea580c;">Payment Reminder: Invoice #${invoiceNumber}</h2>
          <p>Hi ${clientName},</p>
          <p>This is a polite reminder that payment for invoice <strong>#${invoiceNumber}</strong> for the amount of <strong>${amountDue}</strong> is due on <strong>${dueDate}</strong>.</p>
          <p>If you have already made this payment, please disregard this email. Otherwise, please process the payment at your earliest convenience.</p>
          <br>
          <p>Thank you for your business!</p>
        </div>
      `;

      // 6. Send directly via Resend's REST API
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'support@srdgintel.com', // Must match your verified domain in Resend
          to: [toEmail],
          subject: `Payment Reminder: Invoice #${invoiceNumber}`,
          html: emailHtml,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        return new Response(JSON.stringify({ success: true, data }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      } else {
        throw new Error(data.message || "Failed to send email via Resend");
      }

    } catch (error) {
      console.error("Email Error:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }
  }
};