/**
 * ============================================================
 * TradesPay AI
 * Shared AI Provider Layer
 * Version: 2.2
 *
 * Responsibilities:
 * - OpenRouter Text
 * - OpenRouter Vision
 * - Groq Text Fallback
 * - Groq Whisper
 *
 * No invoice logic.
 * No prompt logic.
 * No JSON parsing.
 * ============================================================
 */

import type {
  AIMessage,
  AIOptions,
  AIResponse,
} from "./types.ts";

const OPENROUTER_API_KEY =
  Deno.env.get("OPENROUTER_API_KEY") ?? "";

const GROQ_API_KEY =
  Deno.env.get("GROQ_API_KEY") ?? "";

const OPENROUTER_BASE =
  Deno.env.get("OPENROUTER_BASE_URL") ??
  "https://openrouter.ai/api/v1";

const GROQ_BASE =
  Deno.env.get("GROQ_BASE_URL") ??
  "https://api.groq.com/openai/v1";

const DEFAULT_OPENROUTER_MODEL =
  Deno.env.get("OPENROUTER_MODEL") ??
  "deepseek/deepseek-chat-v3";

const DEFAULT_GROQ_MODEL =
  Deno.env.get("GROQ_MODEL") ??
  "llama-3.3-70b-versatile";

const DEFAULT_GROQ_WHISPER_MODEL =
  Deno.env.get("GROQ_WHISPER_MODEL") ??
  "whisper-large-v3";

/**
 * Shared chat completion helper.
 */
async function chatCompletion(
  provider: "openrouter" | "groq",
  messages: AIMessage[],
  options?: AIOptions
): Promise<AIResponse> {
  const apiKey =
    provider === "openrouter"
      ? OPENROUTER_API_KEY
      : GROQ_API_KEY;

  if (!apiKey) {
    throw new Error(
      `${provider.toUpperCase()} API key not configured.`
    );
  }

  const baseUrl =
    provider === "openrouter"
      ? OPENROUTER_BASE
      : GROQ_BASE;

  const model =
    options?.model ??
    (
      provider === "openrouter"
        ? DEFAULT_OPENROUTER_MODEL
        : DEFAULT_GROQ_MODEL
    );

  const startedAt = Date.now();

  const response = await fetch(
    `${baseUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(provider === "openrouter"
          ? {
              "HTTP-Referer":
                Deno.env.get("APP_URL") ??
                "https://tradespay.ai",
              "X-Title": "TradesPay AI",
            }
          : {}),
      },
      body: JSON.stringify({
        model,
        messages,
        temperature:
          options?.temperature ?? 0.2,
        max_tokens:
          options?.maxTokens ?? 1200,
      }),
    }
  );

  if (!response.ok) {
    const errorText =
      await response.text();

    throw new Error(
      `${provider} request failed ` +
      `(${response.status}): ${errorText}`
    );
  }

  const json =
    await response.json();

  const text =
    json?.choices?.[0]?.message?.content;

  if (
    typeof text !== "string" ||
    !text.trim()
  ) {
    throw new Error(
      `${provider} returned an empty response.`
    );
  }

  return {
    provider,
    model,
    text,
    latency:
      Date.now() - startedAt,
  };
}

/**
 * Generate text using the requested provider.
 */
export async function generateText(
  messages: AIMessage[],
  options?: AIOptions
): Promise<AIResponse> {
  const provider =
    options?.provider ?? "openrouter";

  if (
    provider !== "openrouter" &&
    provider !== "groq"
  ) {
    throw new Error(
      `Unsupported AI provider: ${provider}`
    );
  }

  return chatCompletion(
    provider,
    messages,
    options
  );
}

/**
 * Generate text with automatic fallback.
 *
 * OpenRouter is attempted first.
 * Groq is used only if OpenRouter fails.
 */
export async function generateTextWithFallback(
  messages: AIMessage[],
  options?: AIOptions
): Promise<AIResponse> {
  try {
    return await chatCompletion(
      "openrouter",
      messages,
      options
    );
  } catch (primaryError) {
    try {
      return await chatCompletion(
        "groq",
        messages,
        {
          ...options,
          provider: "groq",
          model:
            options?.model ??
            DEFAULT_GROQ_MODEL,
        }
      );
    } catch (fallbackError) {
      throw new Error(
        `AI provider failure. ` +
        `Primary: ${
          primaryError instanceof Error
            ? primaryError.message
            : String(primaryError)
        }. ` +
        `Fallback: ${
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError)
        }.`
      );
    }
  }
}

/**
 * Generate a vision response.
 *
 * Messages must use the provider's compatible
 * multimodal message structure.
 */
export async function generateVision(
  messages: AIMessage[],
  options?: AIOptions
): Promise<AIResponse> {
  return chatCompletion(
    "openrouter",
    messages,
    {
      ...options,
      model:
        options?.model ??
        Deno.env.get(
          "OPENROUTER_VISION_MODEL"
        ) ??
        DEFAULT_OPENROUTER_MODEL,
    }
  );
}

/**
 * Transcribe audio through Groq Whisper.
 */
export async function transcribeAudio(
  audioBytes: Uint8Array,
  mimeType = "audio/webm"
): Promise<string> {
  if (!GROQ_API_KEY) {
    throw new Error(
      "GROQ API key not configured."
    );
  }

  const extension =
    mimeType.includes("wav")
      ? "wav"
      : mimeType.includes("m4a")
        ? "m4a"
        : mimeType.includes("mp3")
          ? "mp3"
          : "webm";

  const formData =
    new FormData();

  // Copy into a guaranteed ArrayBuffer so this remains
  // compatible with current Deno TypeScript typings.
  const audioBuffer =
    new ArrayBuffer(audioBytes.byteLength);

  new Uint8Array(audioBuffer).set(audioBytes);

  const audioBlob =
    new Blob(
      [audioBuffer],
      { type: mimeType }
    );

  formData.append(
    "file",
    audioBlob,
    `audio.${extension}`
  );

  formData.append(
    "model",
    DEFAULT_GROQ_WHISPER_MODEL
  );

  const response =
    await fetch(
      `${GROQ_BASE}/audio/transcriptions`,
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${GROQ_API_KEY}`,
        },
        body: formData,
      }
    );

  if (!response.ok) {
    const errorText =
      await response.text();

    throw new Error(
      `Groq Whisper request failed ` +
      `(${response.status}): ${errorText}`
    );
  }

  const json =
    await response.json();

  const text =
    json?.text;

  if (
    typeof text !== "string"
  ) {
    throw new Error(
      "Groq Whisper returned no transcription."
    );
  }

  return text.trim();
}

/**
 * Provider configuration health check.
 *
 * Does not make an API request.
 */
export function healthCheck() {
  return {
    openrouter:
      Boolean(OPENROUTER_API_KEY),

    groq:
      Boolean(GROQ_API_KEY),

    models: {
      openrouter:
        DEFAULT_OPENROUTER_MODEL,

      groq:
        DEFAULT_GROQ_MODEL,

      whisper:
        DEFAULT_GROQ_WHISPER_MODEL,
    },
  };
}
