-- TradesPay AI - Database Migration & Setup (Safe / Non-Destructive)
-- This script adds new columns and tables without deleting existing data.

-- 1. ENSURE USER PROFILES TABLE
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    plan VARCHAR(50) DEFAULT 'free',
    whatsapp_number VARCHAR(20),
    instagram_handle VARCHAR(100),
    bank_details TEXT,
    ai_sales_enabled BOOLEAN DEFAULT FALSE,
    business_service TEXT,
    pricing_list TEXT,
    ai_tone VARCHAR(50) DEFAULT 'professional',
    flutterwave_ref VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. ENSURE INVOICES TABLE
CREATE TABLE IF NOT EXISTS public.invoices (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    invoice_number VARCHAR(50) NOT NULL,
    client_name VARCHAR(255) NOT NULL,
    client_email VARCHAR(255),
    job_description TEXT,
    subtotal DECIMAL(12,2) DEFAULT 0.00,
    tax_rate DECIMAL(5,4) DEFAULT 0.0750,
    tax_amount DECIMAL(12,2) DEFAULT 0.00,
    total DECIMAL(12,2) DEFAULT 0.00,
    status VARCHAR(50) DEFAULT 'draft',
    source VARCHAR(50) DEFAULT 'manual',
    due_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. ENSURE LINE ITEMS TABLE
CREATE TABLE IF NOT EXISTS public.line_items (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    invoice_id UUID REFERENCES public.invoices(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity DECIMAL(10,2) DEFAULT 1.00,
    unit_price DECIMAL(12,2) DEFAULT 0.00,
    amount DECIMAL(12,2) DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. SAFE COLUMN UPDATES (MIGRATION)
DO $$ 
BEGIN 
    -- Add new columns to user_profiles if they don't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_profiles' AND column_name='instagram_id') THEN
        ALTER TABLE public.user_profiles ADD COLUMN instagram_id VARCHAR(255);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_profiles' AND column_name='whatsapp_id') THEN
        ALTER TABLE public.user_profiles ADD COLUMN whatsapp_id VARCHAR(255);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_profiles' AND column_name='currency') THEN
        ALTER TABLE public.user_profiles ADD COLUMN currency VARCHAR(10) DEFAULT '₦';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_profiles' AND column_name='meta_webhook_recipient_id') THEN
        ALTER TABLE public.user_profiles ADD COLUMN meta_webhook_recipient_id VARCHAR(255);
    END IF;
END $$;


-- 5. MESSAGES TABLE (Chat History)
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    platform VARCHAR(50), -- 'instagram', 'whatsapp'
    sender_id VARCHAR(255),
    recipient_id VARCHAR(255),
    text TEXT,
    direction VARCHAR(10) DEFAULT 'inbound', -- 'inbound' or 'outbound'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. RLS POLICIES (SAFE CREATION)
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view their own invoices') THEN
        CREATE POLICY "Users can view their own invoices" ON public.invoices FOR SELECT USING (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view their own messages') THEN
        CREATE POLICY "Users can view their own messages" ON public.messages FOR SELECT USING (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can insert their own messages') THEN
        CREATE POLICY "Users can insert their own messages" ON public.messages FOR INSERT WITH CHECK (auth.uid() = user_id);
    END IF;
END $$;

-- 7. AUTH TRIGGER (SAFE)
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, plan)
  VALUES (new.id, new.email, 'free')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created') THEN
        CREATE TRIGGER on_auth_user_created
        AFTER INSERT ON auth.users
        FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
    END IF;
END $$;

-- Add client_email to invoices if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='client_email') THEN
        ALTER TABLE public.invoices ADD COLUMN client_email VARCHAR(255);
    END IF;
END $$;

-- 8. WEBHOOK QUEUE (guaranteed message processing — zero missed DMs)
CREATE TABLE IF NOT EXISTS public.webhook_queue (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    platform VARCHAR(50),          -- 'instagram' or 'whatsapp_business_account'
    sender_id VARCHAR(255),
    recipient_id VARCHAR(255),
    message_text TEXT,
    status VARCHAR(20) DEFAULT 'pending',  -- pending / processing / completed / failed
    retry_count INT DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    processed_at TIMESTAMP WITH TIME ZONE
);

-- Auto-clean completed queue items older than 7 days
CREATE OR REPLACE FUNCTION clean_old_queue_entries()
RETURNS void AS $$
BEGIN
    DELETE FROM public.webhook_queue
    WHERE status IN ('completed', 'failed')
      AND processed_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- Index for fast queue polling
CREATE INDEX IF NOT EXISTS idx_webhook_queue_status ON public.webhook_queue(status, created_at);
