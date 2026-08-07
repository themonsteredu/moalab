import { createClient } from '@supabase/supabase-js';

/** 서버 전용. service_role 키를 쓰므로 절대 클라이언트에서 import 하지 말 것. */
export function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
