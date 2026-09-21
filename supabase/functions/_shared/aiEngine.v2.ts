/**
 * ============================================================
 * TradesPay AI
 * AI Engine V2
 * Version: 2.0
 *
 * Central AI Orchestrator
 *
 * Responsibilities:
 * - Select provider
 * - Select prompt
 * - Execute AI request
 * - Validate AI response
 * - Build invoice
 * - Return metadata
 *
 * This module does not contain provider implementation.
 * ============================================================
 */

import type {
  AIOptions,
  AIResult,
  InvoiceData,
} from "./types.ts";

import {
  SYSTEM_PROMPT,
  VOICE_INVOICE_PROMPT,
  PHOTO_INVOICE_PROMPT,
  IMAGE_INVOICE_PROMPT,
} from "./prompts.ts";

import {
  parseAIResponse,
  validateInvoice,
} from "./validator.ts";

import {
  buildInvoice,
} from "./invoice.ts";

import {
  normalizeCurrency,
} from "./currency.ts";

import {
  generateTextWithFallback,
  generateVision,
  transcribeAudio,
} from "./providers.ts";

/**
 * Supported AI request types.
 */
export type AIRequestType =
  | "text"
  | "voice"
  | "photo"
  | "image";

/**
 * Engine request.
 */
export interface RunAIRequest {
  type: AIRequestType;

  input?: string;

  imageBase64?: string;

  audioBytes?: Uint8Array;

  mimeType?: string;

  description?: string;

  options?: AIOptions;
}

/**
 * Engine metadata.
 */
export interface AIEngineMeta {
  provider: string;

  model: string;

  fallbackUsed: boolean;

  latencyMs: number;

  timestamp: string;
}

/**
 * Engine response.
 */
export interface RunAIResponse {
  success: boolean;

  invoice?: InvoiceData;

  result?: AIResult;

  meta: AIEngineMeta;

  error?: string;
}

/**
 * Convert an image into an OpenAI-compatible
 * multimodal message.
 */
function buildVisionMessage(
  prompt: string,
  imageBase64: string
) {
  const cleanBase64 =
    imageBase64.replace(
      /^data:image\/[^;]+;base64,/i,
      ""
    );

  return [
    {
      role: "user" as const,
      content: [
        {
          type: "text",
          text: prompt,
        },
        {
          type: "image_url",
          image_url: {
            url:
              `data:image/jpeg;base64,${cleanBase64}`,
          },
        },
      ],
    },
  ] as any;
}

/**
 * Resolve the appropriate prompt.
 */
function resolvePrompt(
  type: AIRequestType
): string {
  switch (type) {
    case "voice":
      return VOICE_INVOICE_PROMPT;

    case "photo":
      return PHOTO_INVOICE_PROMPT;

    case "image":
      return IMAGE_INVOICE_PROMPT;

    case "text":
    default:
      return SYSTEM_PROMPT;
  }
}

/**
 * Run the TradesPay AI Engine V2.
 */
export async function runAIEngine(
  request: RunAIRequest
): Promise<RunAIResponse> {
  const startedAt =
    Date.now();

  const timestamp =
    new Date().toISOString();

  try {
    let rawText = "";

    let provider =
      "unknown";

    let model =
      "unknown";

    let fallbackUsed =
      false;

    /**
     * --------------------------------------------------------
     * TEXT REQUEST
     * --------------------------------------------------------
     */
    if (request.type === "text") {
      if (!request.input?.trim()) {
        throw new Error(
          "Text input is required."
        );
      }

      const prompt =
        `${resolvePrompt("text")}\n\n` +
        `User Input:\n${request.input}`;

      const response =
        await generateTextWithFallback(
          [
            {
              role: "system",
              content: SYSTEM_PROMPT,
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          request.options
        );

      rawText =
        response.text;

      provider =
        response.provider;

      model =
        response.model;

      fallbackUsed =
        response.provider !==
        "openrouter";
    }

    /**
     * --------------------------------------------------------
     * VOICE REQUEST
     * --------------------------------------------------------
     */
    else if (request.type === "voice") {
      if (!request.audioBytes) {
        throw new Error(
          "Audio data is required."
        );
      }

      const transcription =
        await transcribeAudio(
          request.audioBytes,
          request.mimeType ??
            "audio/webm"
        );

      if (!transcription.trim()) {
        throw new Error(
          "Audio transcription was empty."
        );
      }

      const prompt =
        `${VOICE_INVOICE_PROMPT}\n\n` +
        `Transcribed User Input:\n` +
        transcription;

      const response =
        await generateTextWithFallback(
          [
            {
              role: "system",
              content: SYSTEM_PROMPT,
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          request.options
        );

      rawText =
        response.text;

      provider =
        response.provider;

      model =
        response.model;

      fallbackUsed =
        response.provider !==
        "openrouter";
    }

    /**
     * --------------------------------------------------------
     * PHOTO / IMAGE REQUEST
     * --------------------------------------------------------
     */
    else {
      if (!request.imageBase64) {
        throw new Error(
          "Image data is required."
        );
      }

      const prompt =
        resolvePrompt(request.type);

      const messages =
        buildVisionMessage(
          prompt +
            (
              request.description
                ? `\n\nAdditional description:\n${request.description}`
                : ""
            ),
          request.imageBase64
        );

      const response =
        await generateVision(
          messages,
          request.options
        );

      rawText =
        response.text;

      provider =
        response.provider;

      model =
        response.model;
    }

    /**
     * --------------------------------------------------------
     * VALIDATE AI OUTPUT
     * --------------------------------------------------------
     */
    const parsed =
      parseAIResponse(rawText);

    /**
     * Normalize currency before
     * constructing the invoice.
     */
    if (parsed.currency) {
      parsed.currency =
        normalizeCurrency(
          String(parsed.currency)
        );
    }

    /**
     * Build the final invoice.
     */
    const invoice =
      buildInvoice(parsed);

    /**
     * Validate the resulting invoice.
     */
    const validatedInvoice =
      validateInvoice(
        invoice as unknown as Record<
          string,
          unknown
        >
      );

    const latencyMs =
      Date.now() -
      startedAt;

    return {
      success: true,

      invoice:
        validatedInvoice,

      result: {
        success: true,
        invoice:
          validatedInvoice,
        rawText,
      },

      meta: {
        provider,
        model,
        fallbackUsed,
        latencyMs,
        timestamp,
      },
    };
  } catch (error) {
    return {
      success: false,

      meta: {
        provider: "unknown",
        model: "unknown",
        fallbackUsed: false,
        latencyMs:
          Date.now() -
          startedAt,
        timestamp,
      },

      error:
        error instanceof Error
          ? error.message
          : String(error),
    };
  }
}
