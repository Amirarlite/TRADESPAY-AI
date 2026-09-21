/**
 * ============================================================
 * TradesPay AI
 * Shared Types
 * Version: 2.0
 * ============================================================
 */

/**
 * Standard AI message.
 */
export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * AI provider options.
 */
export interface AIOptions {
  provider?: "openrouter" | "groq";
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Standard AI provider response.
 */
export interface AIResponse {
  provider: string;
  model: string;
  text: string;
  latency?: number;
}

/**
 * Invoice line item.
 */
export interface InvoiceLineItem {
  name: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

/**
 * Standard invoice schema.
 */
export interface InvoiceData {
  invoiceNumber: string;
  clientName: string;
  clientEmail?: string;
  jobDescription: string;
  currency: string;
  lineItems: InvoiceLineItem[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  issuedDate?: string;
  dueDate?: string;
}

/**
 * Standard AI result.
 */
export interface AIResult {
  success: boolean;
  invoice?: InvoiceData;
  rawText?: string;
  error?: string;
}
