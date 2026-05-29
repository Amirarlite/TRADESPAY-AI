// ─────────────────────────────────────────────────────────────
// TRADESPAY AI — PDF Invoice Generator (Deno/Edge Functions)
// ─────────────────────────────────────────────────────────────
// Generates branded HTML invoices, converts to PDF via API.
// Brand colors: primary #ff5c1a (orange), dark #0a0a0a, light #f4f4f5
// ─────────────────────────────────────────────────────────────

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

interface InvoiceData {
  invoiceNumber: string;
  clientName: string;
  clientEmail?: string;
  jobDescription: string;
  currency: string;
  lineItems: LineItem[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  dueDate?: string;
  issuedDate?: string;
}

function formatCurrency(amount: number, currency: string): string {
  return `${currency}${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function generateInvoiceHTML(data: InvoiceData): string {
  const now = data.issuedDate ?? new Date().toISOString().split("T")[0];
  const due = data.dueDate ?? new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];
  const c = data.currency;

  const rows = data.lineItems
    .map(
      (item) => `
        <tr>
          <td style="padding: 12px 16px; border-bottom: 1px solid #1c1c1e; color: #e4e4e7; font-size: 14px;">${item.description}</td>
          <td style="padding: 12px 16px; border-bottom: 1px solid #1c1c1e; color: #a1a1aa; font-size: 14px; text-align: center;">${item.quantity}</td>
          <td style="padding: 12px 16px; border-bottom: 1px solid #1c1c1e; color: #a1a1aa; font-size: 14px; text-align: right;">${formatCurrency(item.unitPrice, c)}</td>
          <td style="padding: 12px 16px; border-bottom: 1px solid #1c1c1e; color: #f4f4f5; font-size: 14px; text-align: right; font-weight: 600;">${formatCurrency(item.amount, c)}</td>
        </tr>`
    )
    .join("");

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Syne:wght@400;500;600;700&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Syne', system-ui, sans-serif; background: #0a0a0a; color: #f4f4f5; padding: 40px; max-width: 800px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; padding-bottom: 24px; border-bottom: 2px solid #ff5c1a; }
    .logo { font-family: 'Bebas Neue', Impact, sans-serif; font-size: 36px; letter-spacing: 3px; color: #ff5c1a; text-transform: uppercase; }
    .logo span { color: #f4f4f5; }
    .invoice-title { text-align: right; }
    .invoice-title h1 { font-family: 'Bebas Neue', Impact, sans-serif; font-size: 28px; letter-spacing: 2px; color: #ff5c1a; text-transform: uppercase; }
    .invoice-title p { font-size: 14px; color: #71717a; margin-top: 4px; }
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-bottom: 36px; }
    .meta-block label { font-size: 11px; text-transform: uppercase; letter-spacing: 2px; color: #71717a; display: block; margin-bottom: 6px; }
    .meta-block p { font-size: 15px; color: #e4e4e7; font-weight: 500; }
    .meta-block .highlight { color: #ff5c1a; font-weight: 700; font-size: 16px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 28px; }
    th { padding: 10px 16px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 2px; color: #71717a; border-bottom: 1px solid #27272a; }
    th:nth-child(2), th:nth-child(3), th:nth-child(4) { text-align: right; }
    th:nth-child(2) { text-align: center; }
    .totals { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; margin-bottom: 36px; }
    .totals .row { display: flex; justify-content: space-between; width: 260px; font-size: 14px; color: #a1a1aa; }
    .totals .row.grand { font-size: 20px; color: #f4f4f5; font-weight: 700; padding-top: 12px; border-top: 2px solid #ff5c1a; width: 260px; }
    .totals .row.grand .val { color: #ff5c1a; }
    .footer { text-align: center; padding-top: 28px; border-top: 1px solid #27272a; }
    .footer p { font-size: 12px; color: #71717a; margin-bottom: 6px; }
    .footer .brand { font-size: 11px; color: #d4d4d8; font-weight: 800; letter-spacing: 2px; }
    .description { background: #18181b; padding: 16px; border-radius: 8px; margin-bottom: 28px; border-left: 3px solid #ff5c1a; }
    .description p { font-size: 14px; color: #d4d4d8; line-height: 1.6; }
    .status-badge { display: inline-block; background: #ff5c1a; color: #0a0a0a; padding: 4px 14px; border-radius: 4px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">TRADES<span>PAY</span></div>
      <p style="font-size: 12px; color: #71717a; margin-top: 4px;">AI-Powered Invoicing</p>
    </div>
    <div class="invoice-title">
      <h1>INVOICE</h1>
      <p>${data.invoiceNumber}</p>
    </div>
  </div>

  <div class="meta-grid">
    <div class="meta-block">
      <label>Bill To</label>
      <p class="highlight">${data.clientName}</p>
      ${data.clientEmail ? `<p style="font-size: 13px; color: #a1a1aa;">${data.clientEmail}</p>` : ""}
    </div>
    <div class="meta-block" style="text-align: right;">
      <label>Details</label>
      <p>Issued: <strong>${now}</strong></p>
      <p>Due: <strong style="color: #ff5c1a;">${due}</strong></p>
    </div>
  </div>

  <div class="description">
    <label style="font-size: 11px; text-transform: uppercase; letter-spacing: 2px; color: #71717a; display: block; margin-bottom: 8px;">Scope of Work</label>
    <p>${data.jobDescription}</p>
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th>Qty</th>
        <th>Unit Price</th>
        <th>Amount</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="totals">
    <div class="row"><span>Subtotal</span><span>${formatCurrency(data.subtotal, c)}</span></div>
    <div class="row"><span>VAT (${(data.taxRate * 100).toFixed(1)}%)</span><span>${formatCurrency(data.taxAmount, c)}</span></div>
    <div class="row grand"><span>Total Due</span><span class="val">${formatCurrency(data.total, c)}</span></div>
  </div>

  <div class="footer">
    <p>This invoice was generated automatically by TradesPay AI.</p>
    <p class="brand">POWERED BY SRDGINTEL</p>
  </div>
</body>
</html>`;
}

/**
 * Convert HTML string to PDF.
 * Uses a free HTML-to-PDF API or Deno's wkhtmltopdf if available.
 * For production: wire up your preferred PDF service (e.g., Gotenberg, PDFShift, DocRaptor).
 * Default fallback: return as HTML with PDF-like filename.
 */
export async function htmlToPdf(
  html: string,
  filename: string = "invoice.pdf"
): Promise<{ pdfBytes: Uint8Array; contentType: string }> {
  // Option 1: Try an HTML-to-PDF API (configure URL in env)
  const pdfApiUrl = Deno.env.get("HTML_TO_PDF_API_URL");
  if (pdfApiUrl) {
    const res = await fetch(pdfApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html }),
    });
    if (res.ok) {
      return { pdfBytes: new Uint8Array(await res.arrayBuffer()), contentType: "application/pdf" };
    }
    console.warn("PDF API failed, falling back to HTML delivery");
  }

  // Fallback: deliver HTML as-is (browsers render it, user can print-to-PDF)
  const encoder = new TextEncoder();
  return { pdfBytes: encoder.encode(html), contentType: "text/html" };
}
