import { createClient } from "@supabase/supabase-js";

let browserClient: ReturnType<typeof createClient> | undefined;

export function publicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase public configuration is missing");
  if (typeof window === "undefined") {
    return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
  }
  browserClient ??= createClient(url, key);
  return browserClient;
}

export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server configuration is missing");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
