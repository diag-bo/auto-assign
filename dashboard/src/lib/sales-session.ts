/**
 * Signed session for the /sales page. A sales rep signs in with their own
 * Labcenter account; the session carries the email Labcenter confirmed, and
 * client lookups are scoped to the clients that email owns or supervises
 * (`owner` / `supervisor_email` on the spc-pos client record). Same HMAC shape
 * as driver-session.ts, with a `k` marker so neither cookie verifies as the other.
 */
import crypto from "crypto";
import type { NextRequest } from "next/server";
import { sbSelect } from "./supabase-rest";

export const SALES_COOKIE = "sales_session";
const TTL_MS = 12 * 60 * 60 * 1000;
export const SALES_COOKIE_MAX_AGE = TTL_MS / 1000;

export type SalesUser = { email: string; name: string };

/** Sign-ins that see and act on EVERY client, not only their own. The address with
 *  any "+tag" dropped must match exactly: long.nguyen+delivery_admin@diag.vn is an
 *  admin, long.nguyen4@ / long.nguyen4+x@ are ordinary reps. */
const SALES_ADMINS = new Set(["long.nguyen@diag.vn"]);
export const isSalesAdmin = (email: string) => SALES_ADMINS.has(email.trim().toLowerCase().replace(/\+[^@]*@/, "@"));

function hmac(body: string): string {
  const s = process.env.DRIVER_SESSION_SECRET || process.env.CARTRACK_WEB_PASS || "";
  return crypto.createHmac("sha256", s).update(body).digest("base64url");
}

export function signSalesSession(user: SalesUser): string {
  const body = Buffer.from(JSON.stringify({ k: "sales", ...user, exp: Date.now() + TTL_MS })).toString("base64url");
  return `${body}.${hmac(body)}`;
}

export function verifySalesSession(token: string | undefined | null): SalesUser | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(hmac(body));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    if (p.k !== "sales" || typeof p.exp !== "number" || Date.now() > p.exp || !p.email) return null;
    return { email: p.email, name: p.name ?? "" };
  } catch {
    return null;
  }
}

export const salesUser = (req: NextRequest) => verifySalesSession(req.cookies.get(SALES_COOKIE)?.value);

/** "\n👤 Name (email)" for an admin-group notice, "" when nobody is signed in
 *  (the dashboard's own copy of the sales tool has no session). */
export function salesByline(req: NextRequest): string {
  const u = salesUser(req);
  return u ? `\n👤 ${u.name ? `${u.name} (${u.email})` : u.email}` : "";
}

/** Master client rows (one per Cartrack customer) matching a PostgREST filter that
 *  `email` owns or supervises (every row for a SALES_ADMINS address). Owner and
 *  supervisor come from Labcenter via the morning sync, so a client reassigned today
 *  follows its new rep tomorrow. The database narrows by owner (ilike: Labcenter's
 *  case is not trusted); the exact match is re-checked here, since `_` in an address
 *  is a one-character wildcard to ilike. */
export async function repClients<T extends object = object>(email: string, filter: string, select = "customer_id,client_code"):
  Promise<(T & { customer_id: string; client_code: string | null })[]> {
  const me = email.trim().toLowerCase();
  if (!me || me.includes('"')) return [];
  const admin = isSalesAdmin(me);
  const rows = await sbSelect<T & { customer_id: string; client_code: string | null; sales_email: string | null; supervisor_email: string | null }>(
    "master_clients_read",
    `select=${select},sales_email,supervisor_email&${filter}` +
      (admin ? "" : `&and=(or(sales_email.ilike.${encodeURIComponent(`"${me}"`)},supervisor_email.ilike.${encodeURIComponent(`"${me}"`)}))`) +
      "&limit=5000");
  return admin ? rows : rows.filter((r) => r.sales_email?.toLowerCase() === me || r.supervisor_email?.toLowerCase() === me);
}
