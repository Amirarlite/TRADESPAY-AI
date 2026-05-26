const { supabase } = require('../supabaseClient');
const { runAIEngine } = require('./aiEngine');
require('dotenv').config();

async function sendOutboundMessage(recipientId, text, platform) {
    const accessToken = process.env.META_PAGE_ACCESS_TOKEN;
    if (!accessToken || accessToken === 'EAAgoXn1HIxQBRRhOkOZAgJvsYZCXGve62eYu0SirMzHK7XkZC6f6BBsUg0mf1ZCPyJA6VKAC3s9DO29xYZBnHbDYCfhILFZBQAkgcZCuaVuDRVkYEfcHiobGUXOa4bunWmhAYPcJZCMZBSWfxlEWmqTKMHuIQuk0sT2XyAmKAVubEvhQNzFbsQ1WQGl6lCYlrY9DSVDwIwFhGWLQ3RvNDo5khxw3tnfVy0DGwUj2wZBlDA28ZCZARE0hMaosYw5aRTYZD') {
        return console.error("❌ Missing valid META_PAGE_ACCESS_TOKEN");
    }

    let url = `https://graph.facebook.com/v21.0/me/messages?access_token=${accessToken}`;
    let payload = { recipient: { id: recipientId }, message: { text } };

    if (platform === 'whatsapp_business_account' || platform === 'whatsapp') {
        const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
        url = `https://graph.facebook.com/v21.0/${phoneId}/messages?access_token=${accessToken}`;
        payload = { messaging_product: "whatsapp", to: recipientId, type: "text", text: { body: text } };
    }

    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        console.log(`📤 Sent message to ${platform} user ${recipientId}`);
    } catch (err) {
        console.error("❌ Failed to post outbound message across Meta API gateway:", err);
    }
}

// Background orchestration skill - Fixes the 3-second loop timeout
function handleInboundWebhookTask(body) {
    // We run this asynchronously so the main server can reply 200 OK to Meta instantly
    setImmediate(async () => {
        try {
            const entry = body.entry?.[0];
            const messaging = entry?.messaging?.[0] || entry?.changes?.[0]?.value;
            let senderId = messaging?.sender?.id;
            let messageText = messaging?.message?.text;
            const platform = body.object;

            let merchantId = messaging?.recipient?.id;
            if (platform === 'whatsapp_business_account') {
                const waMsg = entry?.changes?.[0]?.value?.messages?.[0];
                senderId = waMsg?.from;
                messageText = waMsg?.text?.body;
                merchantId = entry?.changes?.[0]?.value?.metadata?.phone_number_id;
            }

            if (!senderId || !messageText || messaging?.message?.is_echo) return;
            console.log(`📩 Processing background message from ${senderId}: "${messageText}"`);

            const lookupId = merchantId || senderId;

            // FIX: Explicit profile lookup using target mapping, NOT a random row
            // We search for a match in meta_webhook_recipient_id, whatsapp_id, or instagram_id
            let { data: profile } = await supabase
                .from('user_profiles')
                .select('*')
                .or(`meta_webhook_recipient_id.eq.${lookupId},whatsapp_id.eq.${lookupId},instagram_id.eq.${lookupId}`)
                .maybeSingle();

            // If still not found, try to look up by whatsapp_number as a fallback
            if (!profile && platform === 'whatsapp_business_account') {
                const { data: profByPhone } = await supabase
                    .from('user_profiles')
                    .select('*')
                    .or(`whatsapp_number.eq.${senderId},whatsapp_number.eq.${lookupId}`)
                    .maybeSingle();
                profile = profByPhone;
            }

            if (!profile) {
                console.log(`⚠️ Unregistered conversation stream context (lookupId: ${lookupId}). Bypassing AI.`);
                return;
            }


            // FIX: Ensure plan check handles string-based .env variable properly
            if (profile.plan !== 'premium' && process.env.TESTING_MODE !== 'true') {
                console.log(`🚫 Auto-Pilot blocked: User ${profile.id} is on ${profile.plan} plan.`);
                return;
            }

            // Log entry cleanly to Supabase
            await supabase.from('messages').insert([{
                user_id: profile.id, platform, sender_id: senderId, recipient_id: 'me', text: messageText, direction: 'inbound'
            }]);

            const bizSettings = { service: profile.business_service, pricing: profile.pricing_list, tone: profile.ai_tone };
            
            // Route to specific AI engine
            const aiResponse = await runAIEngine({
                promptText: messageText,
                engine: process.env.AUTOPILOT_AI_ENGINE || 'groq',
                businessContext: bizSettings
            });

            const replyText = aiResponse.replyText || "Thanks for your message. We'll get back to you shortly.";

            // Dispatch response and log execution history
            await sendOutboundMessage(senderId, replyText, platform);
            await supabase.from('messages').insert([{
                user_id: profile.id, platform, sender_id: 'me', recipient_id: senderId, text: replyText, direction: 'outbound'
            }]);

        } catch (error) {
            console.error("❌ Error executing background Autopilot routing:", error);
        }
    });
}

module.exports = { handleInboundWebhookTask, sendOutboundMessage };