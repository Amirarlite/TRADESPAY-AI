import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// ─────────────────────────────────────────────────────────────
// TRADESPAY AI — Instagram Connect Edge Function (Deno)
// ─────────────────────────────────────────────────────────────
// Receives { code, redirectUri }
// Verifies user JWT, exchanges code for Instagram Business ID,
// and updates the user profile's instagram_id.
// ─────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

async function getUserFromAuthHeader(authHeader: string) {
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: authHeader,
      apikey: anonKey,
    },
  });
  if (!res.ok) {
    throw new Error(`Auth verification failed: ${res.statusText}`);
  }
  return await res.json();
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Authenticate user via JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), { status: 401, headers: corsHeaders });
    }
    const user = await getUserFromAuthHeader(authHeader);
    if (!user || !user.id) {
      return new Response(JSON.stringify({ error: "Invalid user token" }), { status: 401, headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsHeaders });
    }

    const { code, redirectUri } = await req.json();
    if (!code || !redirectUri) {
      return new Response(JSON.stringify({ error: "Missing code or redirectUri" }), { status: 400, headers: corsHeaders });
    }

    const clientId = Deno.env.get("META_CLIENT_ID") ?? "2035173717383732";
    const clientSecret = Deno.env.get("META_CLIENT_SECRET");

    // 2. Developer/Mock mode fallback if META_CLIENT_SECRET is not configured
    if (!clientSecret || clientSecret === "YOUR_CLIENT_SECRET" || clientSecret.trim() === "") {
      console.warn("⚠️ META_CLIENT_SECRET not configured. Falling back to mock connection for testing.");
      const mockInstagramId = `ig_test_${Math.floor(Math.random() * 1000000000)}`;
      const mockHandle = "mock_instagram_handle";

      const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?id=eq.${user.id}`, {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          instagram_id: mockInstagramId,
          instagram_handle: mockHandle,
          meta_webhook_recipient_id: mockInstagramId,
        }),
      });

      if (!updateRes.ok) {
        throw new Error(`Failed to update mock profile: ${await updateRes.text()}`);
      }

      return new Response(
        JSON.stringify({
          success: true,
          mock: true,
          instagram_id: mockInstagramId,
          instagram_handle: mockHandle,
          message: "Instagram connected in testing/mock mode successfully (META_CLIENT_SECRET not set)."
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Real Meta OAuth Code Exchange Flow
    console.log("Exchanging Instagram OAuth code...");
    const tokenUrl = `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${clientSecret}&code=${code}`;
    const tokenRes = await fetch(tokenUrl);
    
    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      return new Response(JSON.stringify({ error: `OAuth exchange failed: ${errBody}` }), { status: 400, headers: corsHeaders });
    }

    const tokenData = await tokenRes.json();
    const userAccessToken = tokenData.access_token;

    // 4. Fetch the user's Facebook Pages that manage Instagram accounts
    const pagesRes = await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${userAccessToken}`);
    if (!pagesRes.ok) {
      return new Response(JSON.stringify({ error: "Failed to fetch user pages" }), { status: 400, headers: corsHeaders });
    }
    const pagesData = await pagesRes.json();
    const pages = pagesData.data || [];

    let instagramId = "";
    let pageName = "";

    // Iterate through pages to find linked Instagram Business account
    for (const page of pages) {
      const pageDetailRes = await fetch(`https://graph.facebook.com/v21.0/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`);
      if (pageDetailRes.ok) {
        const pageDetail = await pageDetailRes.json();
        if (pageDetail.instagram_business_account?.id) {
          instagramId = pageDetail.instagram_business_account.id;
          pageName = page.name;

          // Subscribe the page to webhooks for messaging
          await fetch(`https://graph.facebook.com/v21.0/${page.id}/subscribed_apps`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              subscribed_fields: "messages,messaging_postbacks",
              access_token: page.access_token
            })
          });
          
          break;
        }
      }
    }

    if (!instagramId) {
      return new Response(
        JSON.stringify({ error: "No Instagram Business Account linked to your authorized Facebook pages." }),
        { status: 400, headers: corsHeaders }
      );
    }

    // 5. Update user profile in database
    const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?id=eq.${user.id}`, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        instagram_id: instagramId,
        instagram_handle: pageName,
        meta_webhook_recipient_id: instagramId,
      }),
    });

    if (!updateRes.ok) {
      throw new Error(`Failed to update user profile in DB: ${await updateRes.text()}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        instagram_id: instagramId,
        instagram_handle: pageName,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown server error";
    console.error("[instagram-connect] Error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
