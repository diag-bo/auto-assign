import serverChromium from "@sparticuz/chromium-min";

// The browser is downloaded at run time instead of shipped in every deployment: the
// bundled ~67 MB binary was stored again with each deploy and filled Vercel's 10 GB
// Functions Storage. A cold run fetches it once into /tmp; warm runs reuse it. Keep
// the version in step with @sparticuz/chromium-min in package.json.
const CHROMIUM_PACK = "https://github.com/Sparticuz/chromium/releases/download/v153.0.0/chromium-v153.0.0-pack.x64.tar";
import { chromium } from "playwright-core";
import { authenticator } from "otplib";
import { runMisaSync, readPendingOvertime } from "../../../misa-fetcher/lib/run.mjs";
import { findLeaveConflict, loadLeaveEntriesStrict } from "./leave-config";
import { deleteMasterLeaves, masterLeaveRows } from "./master-leave";

type LeaveSub = { driver_id: string; driver_name: string; loai_nghi: string; ngay_bat_dau: string;
  ngay_ket_thuc: string | null; gio_bat_dau: string | null; gio_ket_thuc: string | null };

/** "Is this day already on file?" — the duplicate check /api/nghi-phep runs, from
 *  one fresh read, so the push only POSTs days that are new. Same candidate the
 *  route builds; a read failure throws and the pusher posts everything as before. */
async function leaveOnFile() {
  const { entries, invalid } = await loadLeaveEntriesStrict();
  return (s: LeaveSub) => !!findLeaveConflict({
    driver_id: s.driver_id, driver_name: s.driver_name,
    loai_nghi: s.loai_nghi === "nua_buoi" ? "Nghỉ nửa buổi" : "Nghỉ nguyên buổi",
    leave_from: s.ngay_bat_dau, leave_to: s.ngay_ket_thuc ?? s.ngay_bat_dau,
    gio_bat_dau: s.loai_nghi === "nua_buoi" ? s.gio_bat_dau : null,
    gio_ket_thuc: s.loai_nghi === "nua_buoi" ? s.gio_ket_thuc : null, subs: [],
  }, entries, invalid);
}

type WithdrawRow = { id: number; revision: number; note: string; driver_id: string | null;
  driver_name: string; leave_from: string | null; leave_to: string | null };
/** Days the sync filed that MISA has since dropped come back off through here.
 *  A plain delete, NOT the leave panel's: that one records a "deleted day" that
 *  would stop the sync putting the day back if MISA charges it again. */
const withdrawLeave = {
  list: async (): Promise<WithdrawRow[]> => (await masterLeaveRows()).map((r) => ({ id: r.id, revision: r.revision,
    note: r.row_data.note ?? "", driver_id: r.linked_driver_id, driver_name: r.row_data.driver ?? "",
    leave_from: r.starts_on, leave_to: r.ends_on })),
  remove: (rows: WithdrawRow[]) => deleteMasterLeaves(rows.map((r) => r.id), new Map(rows.map((r) => [r.id, r.revision]))),
};

// MISA_CHROMIUM_PATH: a local Chrome for `npm run dev` on Windows/macOS, where the
// Linux server build cannot run. Unset on Vercel.
const browserOptions = async () => ({chromium,statePath:"/tmp/misa-session.json",
  launchOptions:process.env.MISA_CHROMIUM_PATH ? {args:[],executablePath:process.env.MISA_CHROMIUM_PATH}
    : {args:serverChromium.args,executablePath:await serverChromium.executablePath(CHROMIUM_PACK)},
  creds:{username:process.env.MISA_USERNAME,password:process.env.MISA_PASSWORD,totpSecret:process.env.MISA_TOTP_SECRET,
    generateTotp:()=>authenticator.generate(process.env.MISA_TOTP_SECRET!)}});

// One month asked for by name (the dashboard's ?month=) reads that month; the
// morning run takes runMisaSync's default, the two open pay periods.
const run = async (months: string[]) => runMisaSync({...await browserOptions(),...(months.length===1?{month:months[0]}:{}),
  writeDump:false,leaveOnFile,withdrawLeave});

/** Overtime requests waiting for approval in MISA (read only). */
export async function readMisaOvertime() {
  return readPendingOvertime(await browserOptions());
}

/** Every month in ONE browser. One launch per month, each its own invocation, kept
 * landing on the same warm instance seconds after the previous Chromium closed, and
 * the third one could not load its first page (net::ERR_INSUFFICIENT_RESOURCES,
 * 2026-10-13). The retry stays as a safety net for a warm instance an earlier sync
 * left short: the failure comes before anything is read or written. */
export async function runNativeMisa(months:string[]) {
  try { return await run(months); }
  catch (e) {
    if (!/ERR_INSUFFICIENT_RESOURCES/.test(e instanceof Error ? e.message : String(e))) throw e;
    console.warn("[misa] Chromium out of resources on start — retrying in 20s");
    await new Promise((r) => setTimeout(r, 20_000));
    return run(months);
  }
}
