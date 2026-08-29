-- NexusOS Phase 0-2 security and data foundation (additive hardening).

-- Profile authority is database-controlled. Browser/session users cannot mutate
-- role or lifecycle fields even when updating their own profile row.
CREATE OR REPLACE FUNCTION public.prevent_profile_role_escalation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (
       NEW.role IS DISTINCT FROM OLD.role
       OR NEW.account_status IS DISTINCT FROM OLD.account_status
       OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
     ) THEN
    RAISE EXCEPTION 'profile authority fields are server controlled'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_profile_role_escalation ON public.profiles;
CREATE TRIGGER prevent_profile_role_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_role_escalation();

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id OR public.is_admin())
  WITH CHECK (auth.uid() = id OR public.is_admin());

-- Every client-facing table below is RLS protected. Service-role callers must
-- still apply explicit client_id predicates in application code.
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_select_own_invoice_items" ON public.invoice_items;
CREATE POLICY "client_select_own_invoice_items" ON public.invoice_items
  FOR SELECT USING (
    invoice_id IN (
      SELECT i.id FROM public.invoices i
      WHERE i.client_id IN (SELECT c.id FROM public.clients c WHERE c.profile_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "client_select_own_payment_transactions" ON public.payment_transactions;
CREATE POLICY "client_select_own_payment_transactions" ON public.payment_transactions
  FOR SELECT USING (
    payment_id IN (
      SELECT p.id FROM public.payments p
      WHERE p.client_id IN (SELECT c.id FROM public.clients c WHERE c.profile_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "client_update_own_support_tickets" ON public.support_tickets;
CREATE POLICY "client_update_own_support_tickets" ON public.support_tickets
  FOR UPDATE
  USING (
    client_id IN (SELECT c.id FROM public.clients c WHERE c.profile_id = auth.uid())
    OR created_by = auth.uid()
  )
  WITH CHECK (
    client_id IN (SELECT c.id FROM public.clients c WHERE c.profile_id = auth.uid())
    OR created_by = auth.uid()
  );

DROP POLICY IF EXISTS "client_insert_own_ticket_messages" ON public.ticket_messages;
CREATE POLICY "client_insert_own_ticket_messages" ON public.ticket_messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid()
    AND COALESCE(is_internal, false) = false
    AND ticket_id IN (
      SELECT t.id FROM public.support_tickets t
      WHERE t.client_id IN (SELECT c.id FROM public.clients c WHERE c.profile_id = auth.uid())
         OR t.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "client_update_own_notifications" ON public.notifications;
CREATE POLICY "client_update_own_notifications" ON public.notifications
  FOR UPDATE
  USING (
    recipient_id = auth.uid()
    OR client_id IN (SELECT c.id FROM public.clients c WHERE c.profile_id = auth.uid())
  )
  WITH CHECK (
    recipient_id = auth.uid()
    OR client_id IN (SELECT c.id FROM public.clients c WHERE c.profile_id = auth.uid())
  );

-- Existing rows may contain unverified plaintext. Browser roles can select only
-- non-secret metadata; application decryption remains server-only.
REVOKE SELECT ON public.service_credentials FROM anon, authenticated;
GRANT SELECT (id, service_id, credential_name, username, login_url,
              is_client_visible, created_at, updated_at)
  ON public.service_credentials TO authenticated;
