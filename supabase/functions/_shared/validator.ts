/**
 * ============================================================
 * TradesPay AI
 * Shared JSON Validator
 * Version: 2.1
 * ============================================================
 */

import type { InvoiceData } from "./types.ts";

/**
 * Remove markdown wrappers and isolate the JSON object.
 */
export function extractJSON(raw: string): string {
  let cleaned = String(raw ?? "").trim();

  cleaned = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (
    start === -1 ||
    end === -1 ||
    end <= start
  ) {
    throw new Error(
      "No valid JSON object found in AI response."
    );
  }

  return cleaned.substring(
    start,
    end + 1
  );
}

/**
 * Parse AI JSON safely.
 */
export function parseAIResponse(
  raw: string
): Record<string, unknown> {
  const json = extractJSON(raw);

  try {
    const parsed = JSON.parse(json);

    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new Error(
        "AI response must be a JSON object."
      );
    }

    return parsed as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `Invalid JSON returned by AI: ${
        err instanceof Error
          ? err.message
          : String(err)
      }`
    );
  }
}

/**
 * Safely convert values to numbers.
 */
function toNumber(
  value: unknown,
  fallback = 0
): number {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

/**
 * Normalize invoice fields.
 *
 * This function does not invent business information.
 * Missing values use safe application defaults.
 */
export function validateInvoice(
  data: Record<string, unknown>
): InvoiceData {
  const rawItems =
    Array.isArray(data.lineItems)
      ? data.lineItems
      : [];

  const lineItems =
    rawItems.map((item: any) => {
      const quantity =
        toNumber(
          item?.quantity,
          1
        );

      const unitPrice =
        toNumber(
          item?.unitPrice ??
          item?.amount,
          0
        );

      const suppliedAmount =
        toNumber(
          item?.amount,
          0
        );

      const amount =
        suppliedAmount > 0
          ? suppliedAmount
          : quantity * unitPrice;

      return {
        name:
          String(
            item?.name ??
            item?.description ??
            "Service"
          ),

        quantity,

        unitPrice,

        amount:
          Number(
            amount.toFixed(2)
          ),
      };
    });

  const calculatedSubtotal =
    lineItems.reduce(
      (sum, item) =>
        sum + item.amount,
      0
    );

  const suppliedSubtotal =
    toNumber(
      data.subtotal,
      calculatedSubtotal
    );

  const subtotal =
    Number(
      suppliedSubtotal.toFixed(2)
    );

  const taxRate =
    toNumber(
      data.taxRate,
      0.075
    );

  const calculatedTax =
    Number(
      (subtotal * taxRate)
        .toFixed(2)
    );

  const taxAmount =
    toNumber(
      data.taxAmount,
      calculatedTax
    );

  const calculatedTotal =
    Number(
      (subtotal + taxAmount)
        .toFixed(2)
    );

  const total =
    toNumber(
      data.total,
      calculatedTotal
    );

  return {
    invoiceNumber:
      String(
        data.invoiceNumber ??
        `INV-${crypto
          .randomUUID()
          .slice(0, 8)
          .toUpperCase()}`
      ),

    clientName:
      String(
        data.clientName ??
        data.customer ??
        "Valued Client"
      ),

    clientEmail:
      String(
        data.clientEmail ??
        ""
      ),

    jobDescription:
      String(
        data.jobDescription ??
        "Services Rendered"
      ),

    currency:
      String(
        data.currency ??
        "₦"
      ),

    lineItems,

    subtotal,

    taxRate,

    taxAmount,

    total,

    issuedDate:
      String(
        data.issuedDate ??
        new Date()
          .toISOString()
          .split("T")[0]
      ),

    dueDate:
      String(
        data.dueDate ??
        ""
      ),
  };
}
