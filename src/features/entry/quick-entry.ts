import { getAirport } from "@/data/reference";

import type { FormValues } from "./form-model";

/** Deliberately explicit syntax; never infer ambiguous dates or arbitrary email text. */
export function parseQuickEntry(text: string): Partial<FormValues> | null {
  const m =
    /^\s*([A-Za-z]{3,4})\s*(?:→|->|-|\bto\b)\s*([A-Za-z]{3,4})\s+(\d{4}-\d{2}-\d{2})(?:\s+([A-Za-z0-9]{2,3})\s*(\d{1,4}[A-Za-z]?))?\s*$/i.exec(
      text,
    );
  if (!m) return null;
  const from = getAirport(m[1]);
  const to = getAirport(m[2]);
  if (
    !from ||
    !to ||
    from.ident === to.ident ||
    !Number.isFinite(Date.parse(m[3])) ||
    new Date(m[3]).toISOString().slice(0, 10) !== m[3]
  )
    return null;
  return {
    from: from.ident,
    to: to.ident,
    date: m[3],
    datePrecision: "day",
    ...(m[4] ? { flightNumber: `${m[4]}${m[5]}`.toUpperCase() } : {}),
  };
}
