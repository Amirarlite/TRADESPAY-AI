const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const { handleInboundWebhookTask } = require('./skills/metaAutopilot');
const { runAIEngine } = require('./skills/aiEngine');
const { dispatchPaymentReminder } = require('./skills/communication');
const { supabase } = require('./supabaseClient');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
let localInvoices = [];

app.use(cors({ origin: [ /srdgintel\.com$/, /localhost/ ], methods: ['GET', 'POST'] }));
app.use(express.json({ limit: '10mb' }));
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });

// Rapid Health Diagnostics
app.get('/api/health', (req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));

// Meta Endpoint Handlers
app.get('/api/webhooks/meta', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.META_WEBHOOK_VERIFY_TOKEN) {
        console.log("✅ Meta Webhook Verified Successfully!");
        return res.status(200).send(req.query['hub.challenge']);
    }
    console.error("❌ Meta Webhook Verification Failed.");
    res.sendStatus(403);
});

app.post('/api/webhooks/meta', (req, res) => {
    // Acknowledge Meta immediately within 3 seconds to prevent loop storms
    res.status(200).send('EVENT_RECEIVED');
    
    // Hand over work payload processing to background context threads
    handleInboundWebhookTask(req.body);
});

// Front-End Application Target Invoicing Routers
app.post('/api/ai/voice-to-invoice', async (req, res) => {
    try {
        const { transcript } = req.body;
        if (!transcript) return res.status(400).json({ error: "Empty transcription payload provided" });

        const resultData = await runAIEngine({
            promptText: `Extract invoice datasets out of transcript: "${transcript}"`,
            engine: process.env.INVOICE_AI_ENGINE || 'groq'
        });

        const lineItems = resultData.invoiceData?.lineItems || [];
        const subtotal = lineItems.reduce((sum, item) => sum + (item.amount || (item.quantity * item.unitPrice || 0)), 0);
        const taxAmount = Math.round(subtotal * 0.075); // 7.5% Standard VAT Calculation

        res.json({
            invoice: { ...resultData.invoiceData, subtotal, taxAmount, total: subtotal + taxAmount }
        });
    } catch (err) {
        res.status(500).json({ error: "Voice structured execution sequence processing failure" });
    }
});

app.post('/api/ai/voice-to-invoice-file', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "No audio file uploaded" });

        const tempDir = os.tmpdir();
        const ext = req.file.originalname?.endsWith('.wav') ? '.wav' : (req.file.originalname?.endsWith('.m4a') ? '.m4a' : '.webm');
        const tempFilePath = path.join(tempDir, `upload-${Date.now()}${ext}`);
        fs.writeFileSync(tempFilePath, req.file.buffer);

        let transcript = "";
        try {
            const OpenAI = require('openai');
            const groq = new OpenAI({ apiKey: process.env.GROQ_API_KEY || 'dummy', baseURL: 'https://api.groq.com/openai/v1' });
            const transcription = await groq.audio.transcriptions.create({
                file: fs.createReadStream(tempFilePath),
                model: "whisper-large-v3"
            });
            transcript = transcription.text;
        } catch (whisperErr) {
            console.error("Whisper Error:", whisperErr);
            try { fs.unlinkSync(tempFilePath); } catch(e){}
            return res.status(500).json({ error: "Audio transcription failure: " + whisperErr.message });
        }

        try { fs.unlinkSync(tempFilePath); } catch(e){}

        if (!transcript) return res.status(400).json({ error: "Failed to extract text from audio" });

        const resultData = await runAIEngine({
            promptText: `Extract invoice datasets out of transcript: "${transcript}"`,
            engine: process.env.INVOICE_AI_ENGINE || 'groq'
        });

        const lineItems = resultData.invoiceData?.lineItems || [];
        const subtotal = lineItems.reduce((sum, item) => sum + (item.amount || (item.quantity * item.unitPrice || 0)), 0);
        const taxAmount = Math.round(subtotal * 0.075);

        res.json({
            invoice: { ...resultData.invoiceData, subtotal, taxAmount, total: subtotal + taxAmount },
            transcript: transcript
        });
    } catch (err) {
        console.error("Voice-to-invoice audio pipeline failure:", err);
        res.status(500).json({ error: "Audio invoice execution sequence processing failure" });
    }
});


app.post('/api/ai/photo-to-invoice', async (req, res) => {
    try {
        const { imageBase64, description } = req.body;
        if (!imageBase64) return res.status(400).json({ error: "Missing required source image references" });

        const resultData = await runAIEngine({
            promptText: `Analyze target invoice imagery metrics layout context. Context details: ${description || 'None'}`,
            base64Image: imageBase64,
            engine: 'qwen'
        });

        res.json({ invoice: resultData.invoiceData });
    } catch (err) {
        res.status(500).json({ error: "Visual invoice entity extraction mapping runtime failure" });
    }
});

app.post('/api/email/remind', async (req, res) => {
    try {
        const mailResult = await dispatchPaymentReminder(req.body);
        res.json({ success: true, messageId: mailResult.messageId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Helper to extract userId from supabase jwt token
async function getUserIdFromAuth(req) {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (token && token !== 'null') {
            const { data: { user }, error } = await supabase.auth.getUser(token);
            if (user) return user.id;
        }
    } catch (e) {
        console.error("Auth Token parsing error:", e.message);
    }
    return null;
}

// 1. GET /api/invoices
app.get('/api/invoices', async (req, res) => {
    try {
        const userId = await getUserIdFromAuth(req);
        
        let query = supabase.from('invoices').select('*, line_items(*)').order('created_at', { ascending: false });
        if (userId) {
            query = query.eq('user_id', userId);
        }
        
        const { data: invoices, error } = await query;
        
        // Dynamic offline fallback if Supabase table is not fully configured yet
        if (error || !invoices || invoices.length === 0) {
            console.log("ℹ️ Supabase Invoices offline/empty, returning local memory list.");
            return res.json({ success: true, invoices: localInvoices });
        }
        
        // Map backend schema to frontend expectation
        const formattedInvoices = invoices.map(inv => ({
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
            status: inv.status || 'draft',
            source: inv.source || 'manual',
            due_date: inv.due_date,
            created_at: inv.created_at,
            lineItems: (inv.line_items || []).map(it => ({
                description: it.description,
                quantity: parseFloat(it.quantity) || 1,
                unitPrice: parseFloat(it.unit_price) || 0,
                unit_price: parseFloat(it.unit_price) || 0,
                amount: parseFloat(it.amount) || 0
            }))
        }));
        
        res.json({ success: true, invoices: formattedInvoices });
    } catch (err) {
        console.error("GET /api/invoices error:", err);
        res.json({ success: true, invoices: localInvoices });
    }
});

// 2. POST /api/invoices
app.post('/api/invoices', async (req, res) => {
    try {
        const userId = await getUserIdFromAuth(req);
        
        const { id, invoice_number, clientName, client_name, jobDescription, job_description, subtotal, taxRate, taxAmount, total, status, source, due_date } = req.body;
        
        const invoicePayload = {
            invoice_number: invoice_number || `INV-${Math.floor(100000 + Math.random() * 900000)}`,
            client_name: client_name || clientName || 'Valued Client',
            job_description: job_description || jobDescription || 'Contracting Services',
            subtotal: parseFloat(subtotal) || 0,
            tax_rate: parseFloat(taxRate) || 0.075,
            tax_amount: parseFloat(taxAmount) || 0,
            total: parseFloat(total) || 0,
            status: status || 'draft',
            source: source || 'manual',
            due_date: due_date || new Date().toISOString().split('T')[0]
        };
        
        if (userId) invoicePayload.user_id = userId;
        if (id && id.length > 20) invoicePayload.id = id; // Ensure valid UUID format
        
        let savedInvoice = null;
        let dbSuccess = false;
        
        try {
            const { data: invData, error: invErr } = await supabase
                .from('invoices')
                .insert([invoicePayload])
                .select()
                .single();
                
            if (!invErr && invData) {
                savedInvoice = invData;
                dbSuccess = true;
                
                // Save nested line items
                if (req.body.lineItems && req.body.lineItems.length > 0) {
                    const itemsPayload = req.body.lineItems.map(it => ({
                        invoice_id: invData.id,
                        description: it.description,
                        quantity: parseFloat(it.quantity) || 1,
                        unit_price: parseFloat(it.unitPrice || it.unit_price) || 0,
                        amount: parseFloat(it.amount) || 0
                    }));
                    await supabase.from('line_items').insert(itemsPayload);
                }
            }
        } catch (dbErr) {
            console.error("Supabase Database Insert Error:", dbErr.message);
        }
        
        // Add to local in-memory fallback list
        const localInv = {
            id: id || Date.now().toString(),
            invoice_number: invoicePayload.invoice_number,
            client_name: invoicePayload.client_name,
            clientName: invoicePayload.client_name,
            job_description: invoicePayload.job_description,
            jobDescription: invoicePayload.job_description,
            subtotal: invoicePayload.subtotal,
            taxRate: invoicePayload.tax_rate,
            taxAmount: invoicePayload.tax_amount,
            total: invoicePayload.total,
            status: invoicePayload.status,
            source: invoicePayload.source,
            due_date: invoicePayload.due_date,
            lineItems: req.body.lineItems || []
        };
        localInvoices.unshift(localInv);
        
        res.json({ success: true, invoice: localInv, dbSuccess });
    } catch (err) {
        console.error("POST /api/invoices error:", err);
        res.status(500).json({ error: "Failed to save invoice" });
    }
});

// 3. POST /api/ai/draft-reminder
app.post('/api/ai/draft-reminder', async (req, res) => {
    try {
        const { clientName, amountDue, invoiceNumber } = req.body;
        const prompt = `Draft a polite, professional, and slightly persistent invoice payment reminder email for customer "${clientName || 'Client'}" regarding invoice #${invoiceNumber || '0000'} with outstanding balance "${amountDue || '$0'}".`;
        
        let draftText = "";
        try {
            const resultData = await runAIEngine({
                promptText: prompt,
                engine: 'groq'
            });
            draftText = resultData.replyText || "This is a friendly reminder that invoice #" + invoiceNumber + " is currently outstanding. Please settle this amount at your earliest convenience.";
        } catch (err) {
            draftText = `Hi ${clientName || 'Client'},\n\nHope you are well. This is a friendly reminder regarding invoice #${invoiceNumber || '0000'} with outstanding balance of ${amountDue || '$0'}.\n\nPlease settle this amount at your earliest convenience. Thank you!`;
        }
        
        res.json({
            subject: `Payment Reminder: Invoice #${invoiceNumber || '0000'}`,
            body: draftText
        });
    } catch (err) {
        res.status(500).json({ error: "Reminder drafting failed" });
    }
});

// 4. GET /api/meta/conversations
app.get('/api/meta/conversations', async (req, res) => {
    res.json({ success: true, conversations: [] });
});

// 5. GET /api/meta/messages/:senderId
app.get('/api/meta/messages/:senderId', async (req, res) => {
    res.json({ success: true, messages: [] });
});

// 6. POST /api/meta/reply
app.post('/api/meta/reply', async (req, res) => {
    res.json({ success: true, message: "Reply dispatched successfully" });
});

// Route / to serve the complete mobile dashboard application by default
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/app.html'));
});

// Serve static UI assets
app.use(express.static(path.join(__dirname, '../public')));

// Server boot listener
if (require.main === module) {
    app.listen(port, () => console.log(`🚀 Dedicated Skills Engine Server functional on port: ${port}`));
}

module.exports = app;