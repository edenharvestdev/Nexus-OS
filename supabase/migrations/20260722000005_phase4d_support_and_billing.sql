-- =============================================================================
-- NexusOS — Phase 4d: Database-Driven Billing & Support Tickets Migration
-- =============================================================================

-- 1. Extend support_tickets
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS description TEXT;

-- 2. Extend ticket_messages for simple role/name display
ALTER TABLE public.ticket_messages
  ADD COLUMN IF NOT EXISTS sender_name TEXT,
  ADD COLUMN IF NOT EXISTS sender_role TEXT DEFAULT 'client';

-- 3. Extend invoices for custom titles & terms
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS terms TEXT,
  ADD COLUMN IF NOT EXISTS billing_type TEXT DEFAULT 'recurring';

-- 4. Enable RLS and create policies for tickets and billing
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_messages ENABLE ROW LEVEL SECURITY;

-- Admins full access
CREATE POLICY "admin_all_invoices" ON public.invoices FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

CREATE POLICY "admin_all_invoice_items" ON public.invoice_items FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

CREATE POLICY "admin_all_support_tickets" ON public.support_tickets FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

CREATE POLICY "admin_all_ticket_messages" ON public.ticket_messages FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Clients read their own invoices & tickets
CREATE POLICY "client_select_own_invoices" ON public.invoices FOR SELECT USING (
  client_id IN (SELECT id FROM public.clients WHERE profile_id = auth.uid())
);

CREATE POLICY "client_select_own_tickets" ON public.support_tickets FOR SELECT USING (
  client_id IN (SELECT id FROM public.clients WHERE profile_id = auth.uid())
  OR created_by = auth.uid()
);

CREATE POLICY "client_insert_tickets" ON public.support_tickets FOR INSERT WITH CHECK (
  auth.role() = 'authenticated'
);

CREATE POLICY "client_select_messages" ON public.ticket_messages FOR SELECT USING (
  ticket_id IN (
    SELECT id FROM public.support_tickets 
    WHERE client_id IN (SELECT id FROM public.clients WHERE profile_id = auth.uid())
       OR created_by = auth.uid()
  )
);

CREATE POLICY "client_insert_messages" ON public.ticket_messages FOR INSERT WITH CHECK (
  auth.role() = 'authenticated'
);
