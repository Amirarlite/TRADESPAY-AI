const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');

// Initialize API clients securely
const groq = new OpenAI({ apiKey: process.env.GROQ_API_KEY || 'dummy', baseURL: 'https://api.groq.com/openai/v1' });
const cerebras = new OpenAI({ apiKey: process.env.CEREBRAS_API_KEY || 'dummy', baseURL: 'https://api.cerebras.ai/v1' });
const qwen = new OpenAI({ apiKey: process.env.QWEN_API_KEY || 'dummy', baseURL: process.env.QWEN_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' });
const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'dummy').getGenerativeModel({ model: "gemini-1.5-flash" });

const SYSTEM_PROMPT = `You are "Tradespay Sales Assistant", an expert Sales Auto-Pilot.
GOAL: Extract key structured details from user inputs or conversations to convert leads into sales and generate structured invoices.
CRITICAL OUTPUT RULES: You must ALWAYS return pure JSON matching the schema precisely. Never output conversational pleasantries or markdown backticks outside the JSON.

JSON Schema:
{
    "replyText": "Professional response tailored to the client",
    "invoiceData": {
        "clientName": "Extracted name or 'Valued Client'",
        "jobDescription": "Full detailed scope of work",
        "currency": "Default to ₦, switch to $, €, or £ if explicitly mentioned",
        "lineItems": [
            { "description": "Item description", "quantity": 1, "unitPrice": 0, "amount": 0 }
        ]
    }
}`;

async function runAIEngine({ promptText, base64Image = null, engine = 'groq', businessContext = {} }) {
    const contextPrompt = `${SYSTEM_PROMPT}\n\nBusiness Context:\nServices: ${businessContext.service || 'Contracting'}\nPricelist: ${businessContext.pricing || 'Custom quote'}\nTone: ${businessContext.tone || 'professional'}\n\nUser Input: ${promptText}`;

    let rawOutput = "";

    try {
        if (engine === 'groq') {
            const res = await groq.chat.completions.create({
                model: "llama-3.3-70b-versatile",
                messages: [{ role: "user", content: contextPrompt }]
            });
            rawOutput = res.choices[0].message.content;
        } else if (engine === 'cerebras') {
            const res = await cerebras.chat.completions.create({
                model: "llama3.1-70b",
                messages: [{ role: "user", content: contextPrompt }]
            });
            rawOutput = res.choices[0].message.content;
        } else if (engine === 'qwen' && base64Image) {
            const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, "");
            const res = await qwen.chat.completions.create({
                model: process.env.QWEN_VISION_MODEL || "qwen-vl-max",
                messages: [{
                    role: "user",
                    content: [
                        { type: "text", text: contextPrompt },
                        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${cleanBase64}` } }
                    ]
                }]
            });
            rawOutput = res.choices[0].message.content;
        } else {
            // Gemini Fallback Engine
            const res = await gemini.generateContent(contextPrompt);
            rawOutput = res.response.text();
        }

        // Structural cleanup engine for bulletproof JSON extractions
        rawOutput = rawOutput.replace(/```json/gi, '').replace(/```/g, '').trim();
        const jsonStart = rawOutput.indexOf('{');
        const jsonEnd = rawOutput.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1) {
            rawOutput = rawOutput.substring(jsonStart, jsonEnd + 1);
        }
        
        return JSON.parse(rawOutput);
    } catch (error) {
        console.error(`Skill AI Error using ${engine}:`, error.message);
        
        // Smart Heuristic Fallback Parser for offline testing and invalid keys
        console.warn("⚠️ API keys are inactive/mock. Running Local Heuristic Parser for testing...");
        try {
            const lowerPrompt = promptText.toLowerCase();
            
            let clientName = "Valued Client";
            const clientMatch = promptText.match(/(?:charge|invoice|bill|to)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
            if (clientMatch) {
                clientName = clientMatch[1];
            }
            
            let amount = 100;
            const amountMatch = promptText.match(/(?:\$|₦|€|£|naira|dollar|dollars)\s*(\d+(?:,\d+)*(?:\.\d+)?)(?:\s*k)?/i) || promptText.match(/(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:\$|₦|€|£|naira|dollar|dollars)/i);
            if (amountMatch) {
                let val = amountMatch[1].replace(/,/g, '');
                amount = parseFloat(val);
                if (lowerPrompt.includes('k naira') || lowerPrompt.includes('k ') || lowerPrompt.includes('k$')) {
                    amount *= 1000;
                }
            }
            
            let currency = "₦";
            if (promptText.includes('$') || lowerPrompt.includes('dollar')) currency = "$";
            else if (promptText.includes('€') || lowerPrompt.includes('euro')) currency = "€";
            else if (promptText.includes('£') || lowerPrompt.includes('pound')) currency = "£";
            
            let jobDescription = "Contracting Services";
            const jobMatch = promptText.match(/(?:for|of)\s+([^.]+)/i);
            if (jobMatch) {
                jobDescription = jobMatch[1].trim();
            } else {
                jobDescription = promptText.replace(/(?:charge|invoice|bill|to)\s+[A-Za-z]+\s+[^ ]+/i, '').trim();
                if (jobDescription.length < 5) jobDescription = "Contracting Services";
            }
            
            return {
                replyText: `Hi ${clientName}, here is the invoice for the ${jobDescription.toLowerCase()}. Let us know if you have any questions!`,
                invoiceData: {
                    clientName: clientName,
                    jobDescription: jobDescription,
                    currency: currency,
                    lineItems: [
                        {
                            description: jobDescription,
                            quantity: 1,
                            unitPrice: amount,
                            amount: amount
                        }
                    ]
                }
            };
        } catch (fallbackError) {
            console.error("Heuristic parser failed:", fallbackError);
            throw error;
        }
    }
}

module.exports = { runAIEngine };