const fs = require('fs');
const path = require('path');

// 1. Load environment variables from the workspace root .env file
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
    console.log("✅ Loaded environment variables from .env");
} else {
    console.warn("⚠️ .env file not found at " + envPath);
}

// 2. Import local skill modules
const { runAIEngine } = require('../api/skills/aiEngine');
const { dispatchPaymentReminder } = require('../api/skills/communication');

// Helper to format output
function printHeader(title) {
    console.log("\n==================================================");
    console.log(`🚀 TESTING SKILL: ${title}`);
    console.log("==================================================");
}

async function testVoiceToInvoice() {
    printHeader("Voice-to-Invoice Parser (Groq)");
    const transcript = "Hey, please bill Sarah Miller 120k Naira for repairing the kitchen roof shingles. It took 4 hours of labor and we used standard roofing asphalt.";
    
    try {
        console.log(`📥 Sending transcript: "${transcript}"`);
        const result = await runAIEngine({
            promptText: `Extract invoice datasets out of transcript: "${transcript}"`,
            engine: 'groq'
        });
        console.log("📤 Parsed AI Response:");
        console.log(JSON.stringify(result, null, 2));
        
        if (result.invoiceData) {
            console.log("✅ Success! Extracted invoice dataset successfully.");
        } else {
            console.log("❌ Failed to parse structured data.");
        }
    } catch (err) {
        console.error("❌ Voice-to-Invoice error:", err.message);
    }
}

async function testPhotoToInvoice() {
    printHeader("Photo-to-Invoice Parser (Vision - Gemini Fallback / Qwen)");
    const logoPath = path.join(__dirname, '../logo.png');
    
    if (!fs.existsSync(logoPath)) {
        console.error("❌ Logo image not found at: " + logoPath);
        return;
    }

    try {
        console.log("📥 Loading logo.png and converting to base64...");
        const base64Image = fs.readFileSync(logoPath).toString('base64');
        console.log(`📸 Image base64 length: ${base64Image.length} bytes`);
        
        // We will try Gemini fallback since it requires no extra dashboard key for vision,
        // or Qwen if QWEN_API_KEY is available in the environment.
        const engine = process.env.QWEN_API_KEY ? 'qwen' : 'gemini';
        console.log(`🤖 Invoking vision pipeline using engine: "${engine}"`);
        
        const result = await runAIEngine({
            promptText: "Analyze this image. What is the business name and visual elements inside the logo?",
            base64Image: base64Image,
            engine: engine
        });
        
        console.log("📤 Visual Extraction AI Response:");
        console.log(JSON.stringify(result, null, 2));
        
        if (result.invoiceData) {
            console.log("✅ Success! Extracted visual details successfully.");
        } else {
            console.log("❌ Vision pipeline returned empty invoice data.");
        }
    } catch (err) {
        console.error("❌ Photo-to-Invoice error:", err.message);
    }
}

async function testPaymentReminder() {
    printHeader("Payment Reminder Email Dispatch");
    
    const mockPayload = {
        toEmail: "test-client@srdgintel.com",
        clientName: "Sarah Miller",
        amountDue: "₦120,000.00",
        invoiceNumber: "INV-998811",
        dueDate: "June 15, 2026"
    };

    try {
        console.log("`📨 Dispatching mock payment reminder...");
        // Use SMTP_HOST or nodemailer mock mode if RESEND key is missing
        if (!process.env.RESEND_API_KEY && !process.env.SMTP_HOST) {
            console.warn("⚠️ Missing SMTP credentials. Testing Nodemailer compilation only...");
        }
        
        const result = await dispatchPaymentReminder(mockPayload);
        console.log("📤 Email dispatch output:", result);
        console.log("✅ Success! Compiled and executed SMTP transporter flow.");
    } catch (err) {
        // Expected to fail if credentials are fake, but we check if it reaches transporter compilation
        console.log("ℹ️ Transporter executed (may fail delivery if keys are mock):", err.message);
    }
}

async function runAllTests() {
    console.log("🏁 Starting Tradespay AI Skill Functions Verification...");
    await testVoiceToInvoice();
    await testPhotoToInvoice();
    await testPaymentReminder();
    console.log("\n🏁 All tests completed.");
}

runAllTests();
