import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/aiEngine.ts";

// ─────────────────────────────────────────────────────────────
// TRADESPAY AI — Invoices CRUD Edge Function (Deno)
// ─────────────────────────────────────────────────────────────
// GET  /invoices                → list all (optionally filtered by ?user_id)
// POST /invoices                → create invoice + line items
// PUT  /invoices/:id            → update invoice
// DELETE /invoices/:id          → delete invoice (cascade line items)
//
// Auth: Bearer Supabase JWT (optional — if present, scopes to user_id)
// ─────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

async function getUser(req: Request): Promise<string | null> {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return null;
    const token = authHeader.replace("Bearer ", "");
    if (!token || token === "null") return null;

    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.id ?? null;
  } catch {
    return null;
  }
}

function adminClient() {
  return {
    url: SUPABASE_URL,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation",
    },
  };
}

async function dbFetch(table: string, query: string) {
  const { url, headers } = adminClient();
  const res = await fetch(`${url}/rest/v1/${table}?${query}`, { headers });
  if (!res.ok) throw new Error(`DB error ${res.status}: ${await res.text()}`);
  return await res.json();
}

async function dbInsert(table: string, payload: unknown[]) {
  const { url, headers } = adminClient();
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`DB insert error ${res.status}: ${await res.text()}`);
  return await res.json();
}

async function dbUpdate(table: string, id: string, payload: Record<string, unknown>) {
  const { url, headers } = adminClient();
  const res = await fetch(`${url}/rest/v1/${table}?id=eq.${id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`DB update error ${res.status}: ${await res.text()}`);
  return await res.json();
}

async function dbDelete(table: string, id: string) {
  const { url, headers } = adminClient();
  const res = await fetch(`${url}/rest/v1/${table}?id=eq.${id}`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok) throw new Error(`DB delete error ${res.status}: ${await res.text()}`);
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  // path: /functions/v1/invoices  or  /functions/v1/invoices/<uuid>
  const invoiceId = pathParts[pathParts.length - 1]?.length > 20 ? pathParts[pathParts.length - 1] : null;

  try {
    // ── GET: list invoices ──
    if (req.method === "GET") {
      const userId = await getUser(req);
      const filter = userId ? `user_id=eq.${userId}` : "";
      const invoices = await dbFetch(
        "invoices",
        `select=*,line_items(*)${filter ? "&" + filter : ""}&order=created_at.desc`
      );

      const formatted = (invoices as any[]).map((inv) => ({
        id: inv.id,
        invoice_number: inv.invoice_number,
        invoiceNumber: inv.invoice_number,
        clientName: inv.client_name,
        client_name: inv.client_name,
        client_email: inv.client_email,
        jobDescription: inv.job_description,
        job_description: inv.job_description,
        subtotal: parseFloat(inv.subtotal) || 0,
        taxAmount: parseFloat(inv.tax_amount) || 0,
        taxRate: parseFloat(inv.tax_rate) || 0.075,
        total: parseFloat(inv.total) || 0,
        status: inv.status || "draft",
        source: inv.source || "manual",
        due_date: inv.due_date,
        created_at: inv.created_at,
        lineItems: (inv.line_items || []).map((it: any) => ({
          description: it.description,
          quantity: parseFloat(it.quantity) || 1,
          unitPrice: parseFloat(it.unit_price) || 0,
          unit_price: parseFloat(it.unit_price) || 0,
          amount: parseFloat(it.amount) || 0,
        })),
      }));

      return new Response(
        JSON.stringify({ success: true, invoices: formatted }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── POST: create invoice ──
    if (req.method === "POST" && !invoiceId) {
      const userId = await getUser(req);
      const body = await req.json();

      const invoicePayload: Record<string, unknown> = {
        invoice_number: body.invoice_number || `INV-${Math.floor(100000 + Math.random() * 900000)}`,
        client_name: body.client_name || body.clientName || "Valued Client",
        job_description: body.job_description || body.jobDescription || "Contracting Services",
        subtotal: parseFloat(body.subtotal) || 0,
        tax_rate: parseFloat(body.taxRate) || 0.075,
        tax_amount: parseFloat(body.taxAmount) || 0,
        total: parseFloat(body.total) || 0,
        status: body.status || "draft",
        source: body.source || "manual",
        due_date: body.due_date || new Date().toISOString().split("T")[0],
      };

      if (userId) invoicePayload.user_id = userId;

      const [savedInvoice] = await dbInsert("invoices", [invoicePayload]);

      // Insert line items
      if (body.lineItems && body.lineItems.length > 0) {
        const itemsPayload = body.lineItems.map((it: any) => ({
          invoice_id: savedInvoice.id,
          description: it.description,
          quantity: parseFloat(it.quantity) || 1,
          unit_price: parseFloat(it.unitPrice || it.unit_price) || 0,
          amount: parseFloat(it.amount) || 0,
        }));
        await dbInsert("line_items", itemsPayload);
      }

      return new Response(
        JSON.stringify({ success: true, invoice: savedInvoice }),
        { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── PUT: update invoice ──
    if (req.method === "PUT" && invoiceId) {
      const body = await req.json();
      const updatePayload: Record<string, unknown> = {};

      const allowedFields = [
        "client_name", "clientName", "client_email",
        "job_description", "jobDescription", "subtotal", "tax_rate", "taxAmount",
        "total", "status", "source", "due_date",
      ];
      for (const field of allowedFields) {
        if (body[field] !== undefined) {
          const dbKey = field.includes("_") ? field : field.replace(/([A-Z])/g, "_$1").toLowerCase();
          updatePayload[dbKey] = body[field];
        }
      }

      if (Object.keys(updatePayload).length === 0) {
        return new Response(
          JSON.stringify({ error: "No valid fields to update" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const [updated] = await dbUpdate("invoices", invoiceId, updatePayload);

      return new Response(
        JSON.stringify({ success: true, invoice: updated }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── DELETE: delete invoice ──
    if (req.method === "DELETE" && invoiceId) {
      await dbDelete("invoices", invoiceId);

      return new Response(
        JSON.stringify({ success: true, message: "Invoice deleted" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid route or method" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown server error";
    console.error("[invoices] Error:", message);

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
