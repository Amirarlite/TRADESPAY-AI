import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// ─────────────────────────────────────────────────────────────
// TRADESPAY AI — Instagram Connect Edge Function (Deno)
// ─────────────────────────────────────────────────────────────
// Handles GET /instagram-connect?code=CODE&state=BASE64_JSON
// Exchanges code for Instagram Business ID, updates the user profile's
// instagram_id, and returns an HTML success page.
// ─────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function htmlResponse(title: string, message: string, isError = false, extraHtml = "") {
  const primaryColor = isError ? "#ef4444" : "#ff5c1a";
  const statusEmoji = isError ? "❌" : "📸";
  
  return new Response(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | TradesPay AI</title>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500&display=swap" rel="stylesheet">
  <style>
    body {
      background-color: #080808;
      color: #e5e2e1;
      font-family: 'Inter', sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 24px;
      box-sizing: border-box;
    }
    .card {
      background: #131313;
      border: 1px solid ${primaryColor};
      padding: 40px 32px;
      border-radius: 12px;
      text-align: center;
      max-width: 420px;
      width: 100%;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5), 0 0 20px rgba(255, 92, 26, 0.05);
      box-sizing: border-box;
    }
    .icon {
      font-size: 48px;
      margin-bottom: 20px;
    }
    h1 {
      font-family: 'Space Grotesk', sans-serif;
      color: #ffffff;
      font-size: 24px;
      font-weight: 700;
      margin: 0 0 12px 0;
      letter-spacing: -0.02em;
    }
    p {
      color: #a1a1aa;
      font-size: 14px;
      line-height: 1.6;
      margin: 0 0 24px 0;
    }
    .btn {
      display: inline-block;
      background: ${primaryColor};
      color: #000000;
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700;
      text-decoration: none;
      padding: 12px 24px;
      border-radius: 6px;
      font-size: 14px;
      transition: transform 0.2s, opacity 0.2s;
    }
    .btn:hover {
      opacity: 0.9;
    }
    .btn:active {
      transform: scale(0.98);
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${statusEmoji}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    ${extraHtml}
  </div>
</body>
</html>
`, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

serve(async (req: Request) => {
  // CORS Options Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      }
    });
  }

  const url = new URL(req.url);

  // 1. Check for callback parameters (GET)
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    return htmlResponse(
      "Connection Error",
      "Missing authorization code or state token. Please restart the connection flow from the profile page.",
      true
    );
  }

  // 2. Decode the State Parameter
  let origin = "";
  let userId = "";

  try {
    const decoded = JSON.parse(atob(state));
    origin = decoded.origin;
    userId = decoded.userId;
  } catch (e) {
    console.error("State decode error:", e);
    return htmlResponse(
      "State Verification Failed",
      "Invalid or corrupted state payload. Please log in again and retry.",
      true
    );
  }

  if (!userId) {
    return htmlResponse(
      "Unauthorized",
      "No valid user ID found in session state. Please sign in again.",
      true
    );
  }

  try {
    const clientId = Deno.env.get("META_CLIENT_ID") ?? "2035173717383732";
    const clientSecret = Deno.env.get("META_CLIENT_SECRET");
    const redirectUri = `${url.origin}${url.pathname}`; // This matches the exact Supabase endpoint

    let instagramId = "";
    let pageName = "";
    let isMock = false;

    // 3. Exchange Code (supports testing mock fallback if META_CLIENT_SECRET is missing)
    if (!clientSecret || clientSecret === "YOUR_CLIENT_SECRET" || clientSecret.trim() === "") {
      console.warn("⚠️ META_CLIENT_SECRET not configured. Falling back to Mock Connection.");
      instagramId = `ig_test_${Math.floor(Math.random() * 1000000000)}`;
      pageName = "demo_merchant_ig";
      isMock = true;
    } else {
      console.log(`Exchanging code for user token using redirect_uri: ${redirectUri}`);
      const tokenUrl = `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${clientSecret}&code=${code}`;
      const tokenRes = await fetch(tokenUrl);
      
      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        console.error("Facebook token exchange error:", errText);
        return htmlResponse(
          "Meta Connection Error",
          `Failed to exchange authorization code: ${errText}`,
          true
        );
      }

      const tokenData = await tokenRes.json();
      const userAccessToken = tokenData.access_token;

      // Fetch pages
      const pagesRes = await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${userAccessToken}`);
      if (!pagesRes.ok) {
        return htmlResponse(
          "Facebook Pages Error",
          "Failed to retrieve Facebook Pages linked to your account.",
          true
        );
      }
      const pagesData = await pagesRes.json();
      const pages = pagesData.data || [];

      for (const page of pages) {
        const pageDetailRes = await fetch(`https://graph.facebook.com/v21.0/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`);
        if (pageDetailRes.ok) {
          const pageDetail = await pageDetailRes.json();
          if (pageDetail.instagram_business_account?.id) {
            instagramId = pageDetail.instagram_business_account.id;
            pageName = page.name;

            // Subscribe to webhooks
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
    }

    if (!instagramId) {
      return htmlResponse(
        "No Business Account",
        "Could not find an Instagram Business account linked to your authorized Facebook pages. Please verify your settings in Meta Business Suite.",
        true
      );
    }

    // 4. Update the user profile database record
    const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?id=eq.${userId}`, {
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
      throw new Error(`Failed to update profile record: ${await updateRes.text()}`);
    }

    // 5. Successful connection page that notifies the parent window and closes itself
    const successMsg = isMock 
      ? "Instagram connected in <strong>Testing/Mock Mode</strong> successfully because META_CLIENT_SECRET is not set."
      : `Successfully linked Instagram Business Account: <strong>${pageName}</strong>.`;

    const closeScriptHtml = `
      <script>
        // Notify the parent window
        if (window.opener) {
          window.opener.postMessage("instagram_connected", "*");
        }
        // Auto close after 2.5 seconds
        setTimeout(() => {
          window.close();
        }, 2500);
      </script>
      <a href="${origin || '#'}" class="btn" style="background:#22c55e;color:#fff;margin-top:10px">Return to App</a>
    `;

    return htmlResponse(
      "Instagram Connected!",
      successMsg,
      false,
      closeScriptHtml
    );

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown server error";
    console.error("Callback handler exception:", err);
    return htmlResponse(
      "Server Error",
      `An internal error occurred: ${msg}`,
      true
    );
  }
});
