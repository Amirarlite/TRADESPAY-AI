import "@supabase/functions-js/edge-runtime.d.ts";

export default {
  async fetch(req: Request) {
    const url = new URL(req.url);

    // 1. META VERIFICATION (The GET Request)
    if (req.method === 'GET') {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');

      // Get your verify token from Supabase Vault
      const verifyToken = Deno.env.get('META_WEBHOOK_VERIFY_TOKEN');

      if (mode === 'subscribe' && token === verifyToken) {
        console.log("Meta Webhook Verified!");
        // Meta requires the raw challenge string returned with a 200 status
        return new Response(challenge, { status: 200 });
      } else {
        return new Response("Forbidden", { status: 403 });
      }
    }

    // 2. RECEIVE MESSAGES (The POST Request)
    if (req.method === 'POST') {
      try {
        const body = await req.json();
        console.log("Received Meta Webhook:", JSON.stringify(body));

        // TODO: Your AI Auto-Pilot logic goes here.
        // Extract the sender ID, look up the merchant, and send the AI reply via Meta API.

        // Meta requires a strict 200 OK response immediately, or they will spam your server with retries.
        return new Response("EVENT_RECEIVED", { status: 200 });
      } catch (err) {
        console.error("Meta Webhook Error:", err);
        return new Response("Error", { status: 500 });
      }
    }

    return new Response("Method not allowed", { status: 405 });
  }
};