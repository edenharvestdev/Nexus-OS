-- NexusOS Phase 0-2 security and data foundation (additive hardening).

-- Upgrade existing databases instead of relying on edits to an already-applied
-- migration. Public sign-ups always receive the least-privileged role.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (
    id, email, full_name, company_name, avatar_url, role
  ) VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', 'User'),
    NEW.raw_user_meta_data->>'company_name',
    NEW.raw_user_meta_data->>'avatar_url',
    'client'::public.user_role
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

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

-- PostgreSQL ORs permissive policies, so both legacy names must be removed.
DROP POLICY IF EXISTS "client_insert_tickets" ON public.support_tickets;
DROP POLICY IF EXISTS "client_insert_messages" ON public.ticket_messages;
DROP POLICY IF EXISTS "client_update_own_support_tickets" ON public.support_tickets;

DROP POLICY IF EXISTS "client_insert_own_support_tickets" ON public.support_tickets;
CREATE POLICY "client_insert_own_support_tickets" ON public.support_tickets
  FOR INSERT WITH CHECK (
    created_by = auth.uid()
    AND client_id IN (
      SELECT c.id FROM public.clients c WHERE c.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "client_insert_own_ticket_messages" ON public.ticket_messages;
CREATE POLICY "client_insert_own_ticket_messages" ON public.ticket_messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid()
    AND COALESCE(is_internal, false) = false
    AND sender_role = 'client'
    AND ticket_id IN (
      SELECT t.id FROM public.support_tickets t
      WHERE t.client_id IN (SELECT c.id FROM public.clients c WHERE c.profile_id = auth.uid())
         OR t.created_by = auth.uid()
    )
  );

-- Browser callers submit only safe columns. Identity and authority fields are
-- canonicalized by triggers before RLS WITH CHECK expressions run.
REVOKE INSERT ON public.support_tickets FROM anon, authenticated;
REVOKE UPDATE ON public.support_tickets FROM anon;
REVOKE UPDATE ON public.support_tickets FROM authenticated;
GRANT INSERT (client_id, service_id, ticket_number, subject, priority,
              created_by, category, description, department)
  ON public.support_tickets TO authenticated;

REVOKE INSERT ON public.ticket_messages FROM anon, authenticated;
REVOKE UPDATE ON public.ticket_messages FROM anon;
REVOKE UPDATE ON public.ticket_messages FROM authenticated;
GRANT INSERT (ticket_id, sender_id, message, attachments)
  ON public.ticket_messages TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_client_support_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() = 'authenticated' AND NOT public.is_admin() THEN
    NEW.created_by := auth.uid();
    NEW.status := 'open'::public.ticket_status;
    NEW.assigned_to := NULL;
    NEW.deleted_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_client_support_insert ON public.support_tickets;
CREATE TRIGGER enforce_client_support_insert
  BEFORE INSERT ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.enforce_client_support_insert();

CREATE OR REPLACE FUNCTION public.enforce_client_message_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() = 'authenticated' AND NOT public.is_admin() THEN
    NEW.sender_id := auth.uid();
    NEW.sender_role := 'client';
    NEW.is_internal := false;
    SELECT COALESCE(p.full_name, p.email, 'Client')
      INTO NEW.sender_name
      FROM public.profiles p
      WHERE p.id = auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_client_message_insert ON public.ticket_messages;
CREATE TRIGGER enforce_client_message_insert
  BEFORE INSERT ON public.ticket_messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_client_message_insert();

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

-- Recipients may acknowledge a notification, but cannot rewrite its ownership,
-- content, delivery details, action, or metadata.
REVOKE UPDATE ON public.notifications FROM anon, authenticated;
GRANT UPDATE (status, read_at) ON public.notifications TO authenticated;

CREATE OR REPLACE FUNCTION public.prevent_client_notification_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() = 'authenticated' AND NOT public.is_admin() THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.recipient_id IS DISTINCT FROM OLD.recipient_id
       OR NEW.client_id IS DISTINCT FROM OLD.client_id
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.message IS DISTINCT FROM OLD.message
       OR NEW.channel IS DISTINCT FROM OLD.channel
       OR NEW.action_url IS DISTINCT FROM OLD.action_url
       OR NEW.category IS DISTINCT FROM OLD.category
       OR NEW.priority IS DISTINCT FROM OLD.priority
       OR NEW.action_label IS DISTINCT FROM OLD.action_label
       OR NEW.metadata IS DISTINCT FROM OLD.metadata
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.status IS DISTINCT FROM 'read'::public.notification_status
       OR NEW.read_at IS NULL THEN
      RAISE EXCEPTION 'notification recipients may only mark notifications read'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_client_notification_mutation ON public.notifications;
CREATE TRIGGER prevent_client_notification_mutation
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.prevent_client_notification_mutation();

-- Existing rows may contain unverified plaintext. Browser roles can select only
-- non-secret metadata; application decryption remains server-only.
REVOKE SELECT ON public.service_credentials FROM anon, authenticated;
GRANT SELECT (id, service_id, credential_name, username, login_url,
              is_client_visible, created_at, updated_at)
  ON public.service_credentials TO authenticated;
