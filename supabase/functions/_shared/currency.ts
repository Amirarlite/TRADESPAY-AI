/**
 * ============================================================
 * TradesPay AI
 * Currency Utilities
 * Version: 2.0
 * ============================================================
 */

export const DEFAULT_CURRENCY = "₦";

const currencyMap: Record<string, string> = {
  "₦": "₦",
  "#": "₦",
  "naira": "₦",
  "ngn": "₦",
  "nigerian naira": "₦",

  "$": "$",
  "usd": "$",
  "dollar": "$",
  "dollars": "$",
  "us dollar": "$",

  "€": "€",
  "eur": "€",
  "euro": "€",
  "euros": "€",

  "£": "£",
  "gbp": "£",
  "pound": "£",
  "pounds": "£",
  "british pound": "£",
};

/**
 * Normalize a currency value.
 */
export function normalizeCurrency(
  value?: string | null
): string {
  if (!value) {
    return DEFAULT_CURRENCY;
  }

  const key = value.trim().toLowerCase();

  return currencyMap[key] ?? DEFAULT_CURRENCY;
}

/**
 * Detect currency from free text.
 */
export function detectCurrency(
  text?: string | null
): string {
  if (!text) {
    return DEFAULT_CURRENCY;
  }

  const lower = text.toLowerCase();

  if (
    lower.includes("₦") ||
    lower.includes("naira") ||
    lower.includes("ngn") ||
    lower.includes("#")
  ) {
    return "₦";
  }

  if (
    lower.includes("$") ||
    lower.includes("usd") ||
    lower.includes("dollar")
  ) {
    return "$";
  }

  if (
    lower.includes("€") ||
    lower.includes("eur") ||
    lower.includes("euro")
  ) {
    return "€";
  }

  if (
    lower.includes("£") ||
    lower.includes("gbp") ||
    lower.includes("pound")
  ) {
    return "£";
  }

  return DEFAULT_CURRENCY;
}

/**
 * Format money consistently.
 */
export function formatCurrency(
  amount: number,
  currency = DEFAULT_CURRENCY
): string {
  return `${currency}${amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
