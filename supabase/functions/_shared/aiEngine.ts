// ─────────────────────────────────────────────────────────────
// TRADESPAY AI — Shared AI Engine (Deno/Edge Functions)
// ─────────────────────────────────────────────────────────────
// Import this module from any edge function:
//   import { runAIEngine, parseStructuredJSON, computeTotals } from "../_shared/aiEngine.ts";
// ─────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT =
  `You are "Tradespay Sales Assistant", an expert Sales Auto-Pilot.
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

export const TAX_RATE = 0.075; // 7.5% VAT

// ─── Provider Calls ──────────────────────────────────────────

async function callGroq(messages: unknown[]): Promise<string> {
  const apiKey = Deno.env.get("GROQ_API_KEY");
  if (!apiKey) throw new Error("GROQ_API_KEY not configured");

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Groq API error ${res.status}: ${body}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

async function callCerebras(messages: unknown[]): Promise<string> {
  const apiKey = Deno.env.get("CEREBRAS_API_KEY");
  if (!apiKey) throw new Error("CEREBRAS_API_KEY not configured");

  const res = await fetch("https://api.cerebras.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: "llama3.1-70b", messages }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cerebras API error ${res.status}: ${body}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

async function callQwenVision(messages: unknown[]): Promise<string> {
  const apiKey = Deno.env.get("QWEN_API_KEY");
  if (!apiKey) throw new Error("QWEN_API_KEY not configured");
  const baseURL =
    Deno.env.get("QWEN_BASE_URL") ??
    "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
  const model = Deno.env.get("QWEN_VISION_MODEL") ?? "qwen-vl-max";

  const res = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Qwen API error ${res.status}: ${body}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

async function callGemini(prompt: string): Promise<string> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      }),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${body}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

// ─── AI Engine Router ────────────────────────────────────────

export async function runAIEngine(params: {
  promptText: string;
  engine?: string;
  businessContext?: Record<string, string>;
}): Promise<Record<string, unknown>> {
  const { promptText, engine, businessContext = {} } = params;

  // Resolve engine: explicit param → model_config table → env var → default "groq"
  let resolvedEngine = engine;
  if (!resolvedEngine) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (supabaseUrl && supabaseKey) {
      try {
        const res = await fetch(`${supabaseUrl}/rest/v1/model_config?select=model&limit=1`, {
          headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.length > 0) resolvedEngine = data[0].model;
        }
      } catch { /* table not yet created — fall through */ }
    }
  }
  resolvedEngine = resolvedEngine ?? Deno.env.get("INVOICE_AI_ENGINE") ?? "groq";

  const contextPrompt =
    `${SYSTEM_PROMPT}\n\n` +
    `Business Context:\n` +
    `Services: ${businessContext.service ?? "Contracting"}\n` +
    `Pricelist: ${businessContext.pricing ?? "Custom quote"}\n` +
    `Tone: ${businessContext.tone ?? "professional"}\n\n` +
    `User Input: ${promptText}`;

  const messages = [{ role: "user" as const, content: contextPrompt }];

  let rawOutput: string;

  switch (resolvedEngine) {
    case "groq":
      rawOutput = await callGroq(messages);
      break;
    case "cerebras":
      rawOutput = await callCerebras(messages);
      break;
    case "qwen":
      rawOutput = await callQwenVision(messages);
      break;
    case "gemini":
      rawOutput = await callGemini(contextPrompt);
      break;
    default:
      rawOutput = await callGroq(messages);
  }

  return parseStructuredJSON(rawOutput);
}

// ─── Vision Engine (for photo/image inputs) ──────────────────

export async function runVisionEngine(params: {
  promptText: string;
  base64Image: string;
  engine?: string;
}): Promise<Record<string, unknown>> {
  const { promptText, base64Image, engine = "qwen" } = params;
  const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, "");

  const contextPrompt = `${SYSTEM_PROMPT}\n\nUser Input: ${promptText}`;

  if (engine === "qwen") {
    const apiKey = Deno.env.get("QWEN_API_KEY");
    if (!apiKey) throw new Error("QWEN_API_KEY not configured for vision");
    const baseURL =
      Deno.env.get("QWEN_BASE_URL") ??
      "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
    const model = Deno.env.get("QWEN_VISION_MODEL") ?? "qwen-vl-max";

    const res = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: contextPrompt },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${cleanBase64}`,
                },
              },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Qwen Vision error ${res.status}: ${body}`);
    }
    const data = await res.json();
    return parseStructuredJSON(data.choices[0].message.content);
  }

  throw new Error(`Vision engine not supported for: ${engine}`);
}

// ─── Whisper Transcription (Groq) ────────────────────────────

export async function transcribeAudio(
  audioBytes: Uint8Array,
  mimeType: string
): Promise<string> {
  const apiKey = Deno.env.get("GROQ_API_KEY");
  if (!apiKey) throw new Error("GROQ_API_KEY not configured for Whisper");

  const fileExt = mimeType.includes("wav")
    ? "wav"
    : mimeType.includes("m4a")
      ? "m4a"
      : "webm";

  const boundary = `---deno-form-boundary-${crypto.randomUUID()}`;
  const bodyParts: Uint8Array[] = [];

  bodyParts.push(new TextEncoder().encode(`--${boundary}\r\n`));
  bodyParts.push(
    new TextEncoder().encode(
      `Content-Disposition: form-data; name="file"; filename="audio.${fileExt}"\r\n`
    )
  );
  bodyParts.push(
    new TextEncoder().encode(`Content-Type: ${mimeType}\r\n\r\n`)
  );
  bodyParts.push(audioBytes);
  bodyParts.push(new TextEncoder().encode(`\r\n`));

  bodyParts.push(new TextEncoder().encode(`--${boundary}\r\n`));
  bodyParts.push(
    new TextEncoder().encode(
      `Content-Disposition: form-data; name="model"\r\n\r\n`
    )
  );
  bodyParts.push(new TextEncoder().encode(`whisper-large-v3\r\n`));

  bodyParts.push(new TextEncoder().encode(`--${boundary}--\r\n`));

  const totalLen = bodyParts.reduce((sum, p) => sum + p.length, 0);
  const body = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of bodyParts) {
    body.set(part, offset);
    offset += part.length;
  }

  const res = await fetch(
    "https://api.groq.com/openai/v1/audio/transcriptions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Whisper transcription failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.text ?? "";
}

// ─── JSON Parser ─────────────────────────────────────────────

export function parseStructuredJSON(raw: string): Record<string, unknown> {
  let cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("LLM response contained no valid JSON object");
  }
  cleaned = cleaned.substring(start, end + 1);
  return JSON.parse(cleaned);
}

// ─── Financial Calculator ────────────────────────────────────

export function computeTotals(
  lineItems: Array<Record<string, number>>
): { subtotal: number; taxAmount: number; total: number } {
  const subtotal = lineItems.reduce(
    (sum, item) =>
      sum + (item.amount ?? item.quantity * item.unitPrice ?? 0),
    0
  );
  const taxAmount = Math.round(subtotal * TAX_RATE);
  const total = subtotal + taxAmount;
  return { subtotal, taxAmount, total };
}

// ─── CORS Headers (Cloudflare-compatible) ────────────────────

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};
