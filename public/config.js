// ────────────────────────────────────────────────────────
// TRADESPAY AI — Frontend Config
// ────────────────────────────────────────────────────────
// Change these 2 values and the entire frontend switches
// between Express backend ↔ Supabase Edge Functions.
// ────────────────────────────────────────────────────────

// ── SUPABASE (must match your project) ──
// Get from: Supabase Dashboard → Project Settings → API
window.SUPABASE_URL = 'https://kakynaaatzotkpyjsvit.supabase.co';
window.SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtha3luYWFhdHpvdGtweWpzdml0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NjIzNTAsImV4cCI6MjA4ODMzODM1MH0.Q8hQqFmex3X9LryCEIUgW6PAdNRpx31d9xgBI8x-OQ0'

// ── BACKEND MODE ────────────────────────────────────────
// "edge" → All API calls go to Supabase Edge Functions
// "express" → All API calls go to Express server (legacy)
window.BACKEND_MODE = 'edge';

// Supabase base URL for Edge Functions
// Production: your-project.supabase.co/functions/v1
// Local: http://localhost:54321/functions/v1
window.EDGE_FN_BASE = window.SUPABASE_URL + '/functions/v1';

// Express server URL (legacy — only used if BACKEND_MODE === 'express')
window.EXPRESS_BASE = window.location.origin.startsWith('http')
  ? window.location.origin
  : 'https://api.srdgintel.com';

// ── Route Mapping (auto-resolved by mode) ──────────────
window.ROUTES = {
  voiceToInvoice:    () => (window.BACKEND_MODE === 'edge' ? `${window.EDGE_FN_BASE}/voice-to-invoice`    : `${window.EXPRESS_BASE}/api/ai/voice-to-invoice`),
  photoToInvoice:    () => (window.BACKEND_MODE === 'edge' ? `${window.EDGE_FN_BASE}/photo-to-invoice`    : `${window.EXPRESS_BASE}/api/ai/photo-to-invoice`),
  draftReminder:     () => (window.BACKEND_MODE === 'edge' ? `${window.EDGE_FN_BASE}/draft-reminder`      : `${window.EXPRESS_BASE}/api/ai/draft-reminder`),
  invoices:          () => (window.BACKEND_MODE === 'edge' ? `${window.EDGE_FN_BASE}/invoices`            : `${window.EXPRESS_BASE}/api/invoices`),
  emailRemind:       () => (window.BACKEND_MODE === 'edge' ? `${window.EDGE_FN_BASE}/email-reminder`      : `${window.EXPRESS_BASE}/api/email/remind`),
  processQueue:      () => `${window.EDGE_FN_BASE}/process-queue`,  // edge-only
};
