import { publicClient } from "@/lib/supabase";

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { data } = await publicClient().auth.getSession();
  const response = await fetch(`/api/${path}`, { ...options, headers: { "Content-Type": "application/json", ...(data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}), ...options.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body as T;
}
