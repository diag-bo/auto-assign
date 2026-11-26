/** Opening hours of a client location (Supabase `location_hours`). Every field is
 *  optional: a day left out is "not given", which is not the same as closed. */
export type DayHours = { closed?: boolean; open?: string; close?: string; break_from?: string; break_to?: string };
/** Keyed "1" (Thứ 2) … "7" (Chủ nhật). */
export type WeekHours = Partial<Record<string, DayHours>>;

export const WEEKDAYS = ["1", "2", "3", "4", "5", "6", "7"] as const;
export const WEEKDAY_LABEL: Record<string, string> = { "1": "T2", "2": "T3", "3": "T4", "4": "T5", "5": "T6", "6": "T7", "7": "CN" };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const FIELDS = ["open", "close", "break_from", "break_to"] as const;

/** Clean what a browser sent: drop blank days and fields, refuse anything that is
 *  not HH:MM or whose order makes no sense. Returns the cleaned week or an error. */
export function cleanWeekHours(raw: unknown): { hours: WeekHours } | { error: string } {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return { error: "Giờ làm việc không hợp lệ" };
  const out: WeekHours = {};
  for (const [day, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(WEEKDAYS as readonly string[]).includes(day)) return { error: `Ngày không hợp lệ: ${day}` };
    if (v == null || typeof v !== "object") continue;
    const d = v as Record<string, unknown>;
    const label = WEEKDAY_LABEL[day];
    if (d.closed === true) { out[day] = { closed: true }; continue; }
    const clean: DayHours = {};
    for (const f of FIELDS) {
      const t = typeof d[f] === "string" ? (d[f] as string).trim() : "";
      if (!t) continue;
      if (!TIME.test(t)) return { error: `${label}: giờ "${t}" không hợp lệ` };
      clean[f] = t;
    }
    if (clean.open && clean.close && clean.open >= clean.close) return { error: `${label}: giờ mở cửa phải trước giờ đóng cửa` };
    if (!!clean.break_from !== !!clean.break_to) return { error: `${label}: giờ nghỉ cần cả bắt đầu và kết thúc` };
    if (clean.break_from && clean.break_to) {
      if (clean.break_from >= clean.break_to) return { error: `${label}: giờ nghỉ bắt đầu phải trước kết thúc` };
      if ((clean.open && clean.break_from < clean.open) || (clean.close && clean.break_to > clean.close))
        return { error: `${label}: giờ nghỉ phải nằm trong giờ mở cửa` };
    }
    if (Object.keys(clean).length) out[day] = clean;
  }
  return { hours: out };
}

/** "T2–T6 07:00–17:00 (nghỉ 12:00–13:00) · T7 07:00–11:30 · CN nghỉ" — runs of
 *  identical days are joined. "" when nothing was given. */
export function summarizeWeekHours(h: WeekHours | null | undefined): string {
  if (!h) return "";
  const text = (d: DayHours) => {
    if (d.closed) return "nghỉ";
    const span = d.open || d.close ? `${d.open ?? "?"}–${d.close ?? "?"}` : "";
    const brk = d.break_from ? `nghỉ ${d.break_from}–${d.break_to}` : "";
    return span && brk ? `${span} (${brk})` : span || brk;
  };
  const parts: string[] = [];
  let i = 0;
  while (i < WEEKDAYS.length) {
    const d = h[WEEKDAYS[i]];
    const t = d ? text(d) : "";
    let j = i;
    while (t && j + 1 < WEEKDAYS.length && h[WEEKDAYS[j + 1]] && text(h[WEEKDAYS[j + 1]]!) === t) j++;
    if (t) parts.push(`${WEEKDAY_LABEL[WEEKDAYS[i]]}${j > i ? `–${WEEKDAY_LABEL[WEEKDAYS[j]]}` : ""} ${t}`);
    i = j + 1;
  }
  return parts.join(" · ");
}
