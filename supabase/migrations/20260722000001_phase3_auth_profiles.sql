-- =============================================================================
-- NexusOS Database Architecture — Phase 3 Auth & Profiles Migration
-- Engine: Supabase PostgreSQL (v15+)
-- Features: Profile Extensions, Auto User Provisioning Trigger, RLS Guard Functions
-- =============================================================================

-- 1. Extend Profiles Table for Phase 3 Requirements
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS account_status TEXT DEFAULT 'active';

-- 2. Create automatic user provisioning trigger on auth.users (Error-Safe)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  target_role public.user_role;
BEGIN
  IF NEW.raw_user_meta_data->>'role' = 'admin' THEN
    target_role := 'admin'::public.user_role;
  ELSE
    target_role := 'client'::public.user_role;
  END IF;

  BEGIN
    INSERT INTO public.profiles (
      id,
      email,
      full_name,
      company_name,
      avatar_url,
      role
    ) VALUES (
      NEW.id,
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', 'User'),
      NEW.raw_user_meta_data->>'company_name',
      NEW.raw_user_meta_data->>'avatar_url',
      target_role
    )
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      full_name = EXCLUDED.full_name,
      role = EXCLUDED.role;
  EXCEPTION WHEN OTHERS THEN
    -- Fallback to ensure auth.users creation never fails HTTP 500
    NULL;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Re-attach trigger safely to auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
