/**
 * ============================================================
 * TradesPay AI
 * Invoice Engine
 * Version: 2.1
 * ============================================================
 */

import type {
  InvoiceData,
  InvoiceLineItem,
} from "./types.ts";

import { normalizeCurrency } from "./currency.ts";

export const DEFAULT_TAX_RATE = 0.075;

/**
 * Generate a unique invoice number.
 */
export function generateInvoiceNumber(): string {
  return `INV-${Date.now()}`;
}

/**
 * Safely convert a value to a positive number.
 */
function toNumber(
  value: unknown,
  fallback = 0
): number {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return number;
}

/**
 * Normalize AI line items.
 */
export function normalizeLineItems(
  items: unknown
): InvoiceLineItem[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((item: any) => {
    const quantity = toNumber(
      item?.quantity,
      1
    );

    const unitPrice = toNumber(
      item?.unitPrice ??
      item?.amount,
      0
    );

    const suppliedAmount = toNumber(
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
        Number(amount.toFixed(2)),
    };
  });
}

/**
 * Calculate invoice totals.
 */
export function calculateTotals(
  lineItems: InvoiceLineItem[],
  taxRate = DEFAULT_TAX_RATE
) {
  const safeTaxRate =
    Number.isFinite(Number(taxRate))
      ? Number(taxRate)
      : DEFAULT_TAX_RATE;

  const subtotal = Number(
    lineItems
      .reduce(
        (sum, item) =>
          sum + toNumber(item.amount),
        0
      )
      .toFixed(2)
  );

  const taxAmount = Number(
    (subtotal * safeTaxRate).toFixed(2)
  );

  const total = Number(
    (subtotal + taxAmount).toFixed(2)
  );

  return {
    subtotal,
    taxRate: safeTaxRate,
    taxAmount,
    total,
  };
}

/**
 * Build the final normalized invoice.
 */
export function buildInvoice(
  data: Partial<InvoiceData>
): InvoiceData {
  const lineItems =
    normalizeLineItems(
      data.lineItems
    );

  const totals =
    calculateTotals(
      lineItems,
      data.taxRate ??
      DEFAULT_TAX_RATE
    );

  return {
    invoiceNumber:
      String(
        data.invoiceNumber ??
        generateInvoiceNumber()
      ),

    clientName:
      String(
        data.clientName ??
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
      normalizeCurrency(
        data.currency
      ),

    lineItems,

    subtotal:
      totals.subtotal,

    taxRate:
      totals.taxRate,

    taxAmount:
      totals.taxAmount,

    total:
      totals.total,

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
