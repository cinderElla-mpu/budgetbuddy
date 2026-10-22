import { createClient } from '@supabase/supabase-js';

export function createAuthClient(url, anonKey) {
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

export function createUserClient(url, anonKey, accessToken) {
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}