import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { sbUpsert } from "@/lib/supabase-rest";
import { parseVnTimestamp } from "@/lib/time";

/**
 * Labcenter (Delivery Module) tells us when it failed to create a job in Cartrack.
 *
 *   POST  Authorization: Bearer <LABCENTER_WEBHOOK_SECRET>
 *         { "reference_number": "...", "created_at": "2026-11-06T09:15:00+07:00" }
 *         → 200 { ok: true }. Idempotent per reference; a repeat re-opens it.
 *
 * Stored in Supabase `labcenter_failed_jobs`; nothing reads it yet.
 */

function authorized(req: NextRequest): boolean {
  const secret = process.env.LABCENTER_WEBHOOK_SECRET;
  if (!secret) return false; // a public write endpoint stays shut until the secret is set
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? req.headers.get("x-webhook-secret") ?? "";
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(given), h(secret));
}

/** ISO with an offset is taken as given; a bare "2026-11-06 09:15:00" is VN time. */
function parseCreatedAt(v: unknown): Date | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const s = v.trim();
  const d = /(Z|[+-]\d{2}:?\d{2})$/i.test(s) ? new Date(s) : parseVnTimestamp(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const ref = typeof body?.reference_number === "string" ? body.reference_number.trim() : "";
  const createdAt = parseCreatedAt(body?.created_at);
  if (!ref || ref.length > 100) return NextResponse.json({ ok: false, error: "reference_number is required" }, { status: 400 });
  if (!createdAt) return NextResponse.json({ ok: false, error: "created_at must be a timestamp, e.g. 2026-11-06T09:15:00+07:00" }, { status: 400 });

  await sbUpsert("labcenter_failed_jobs", [{
    reference_number: ref,
    lc_created_at: createdAt.toISOString(),
    received_at: new Date().toISOString(),
    payload: body,
    resolved_at: null, resolved_by: null, cartrack_job_id: null,
  }], "reference_number");
  return NextResponse.json({ ok: true });
}
