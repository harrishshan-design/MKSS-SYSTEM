import { z } from "zod";

export const INDUCTION_VERSION = "pcg-contractor-v1";
export const INDUCTION_URL = "https://forms.gle/gxBUR5XNPesDPL8CA";
export const inductionConfirmation = z.object({ confirmed: z.literal(true), version: z.literal(INDUCTION_VERSION) });
export function inductionComplete(person: { induction_version?: string | null; induction_confirmed_at?: string | null }) {
  return person.induction_version === INDUCTION_VERSION && Boolean(person.induction_confirmed_at);
}
