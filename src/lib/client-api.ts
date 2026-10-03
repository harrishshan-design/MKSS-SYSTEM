import { publicClient } from "@/lib/supabase";

export class ApiRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { data, error } = await publicClient().auth.getSession();
  if (error) throw new ApiRequestError("Connection to sign-in service lost. Check your connection and retry.", 0);
  let response: Response;
  try {
    response = await fetch(`/api/${path}`, { ...options, headers: { "Content-Type": "application/json", ...(data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}), ...options.headers } });
  } catch {
    throw new ApiRequestError("Connection lost. Check your internet and retry.", 0);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiRequestError(body.error || `Request failed (${response.status})`, response.status);
  return body as T;
}
