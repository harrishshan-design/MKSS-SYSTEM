"use client";

import { ApiRequestError } from "./client-api";
import { publicClient } from "./supabase";

export async function downloadCsv(path: string, filename: string): Promise<void> {
  const { data, error } = await publicClient().auth.getSession();
  if (error || !data.session) throw new ApiRequestError("Sign in again to export CSV.", 401);
  let response: Response;
  try {
    response = await fetch(`/api/export/${path}`, {
      headers: { Authorization: `Bearer ${data.session.access_token}` },
      cache: "no-store",
    });
  } catch {
    throw new ApiRequestError("Connection lost. Check your internet and retry.", 0);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiRequestError(body.error || `Export failed (${response.status})`, response.status);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  setTimeout(() => { URL.revokeObjectURL(url); link.remove(); }, 1000);
}
