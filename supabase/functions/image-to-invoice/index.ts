import "@supabase/functions-js/edge-runtime.d.ts";

// 1. CORS Setup (Crucial for Cloudflare to talk to Supabase)
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export default {
  async fetch(req: Request) {
    // 2. Handle CORS preflight for the browser
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }

    try {
      // 3. Parse the request from your frontend
      const { imageBase64, description } = await req.json();

      if (!imageBase64) {
        return new Response(JSON.stringify({ error: "Missing required source image references" }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        });
      }

      // 4. Clean the Base64 string
      const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");

      // 5. Get your API Key securely from Supabase Vault
      // Change 'QWEN_API_KEY' if you used a different name in your old .env
      const apiKey = Deno.env.get('QWEN_API_KEY'); 

      // 6. Send to Vision AI
      const promptText = `Analyze target invoice imagery metrics layout context. Context details: ${description || 'None'}. Return ONLY valid JSON with fields: invoiceNumber, clientName, total, subtotal, taxAmount, dueDate.`;

      const response = await fetch('https://api.openai.com/v1/chat/completions', { 
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: "gpt-4-vision-preview", // Update to your specific Qwen model string if using Qwen
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: promptText },
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${cleanBase64}` } }
              ]
            }
          ],
          max_tokens: 1000
        })
      });

      const aiData = await response.json();
      const invoiceJSON = aiData.choices[0].message.content;

      // 7. Return extracted data
      return new Response(JSON.stringify({ success: true, data: invoiceJSON }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });

    } catch (error) {
      console.error("Vision Error:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }
  }
};