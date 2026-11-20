/**
 * The Phụ cấp xăng workbook, laid out like the hand-built "2026.09 Gasoline
 * Allowance.xlsx": Gas Allowance → Data>>> → Tháng M-YYYY → Trip Details, with the
 * same cells, formulas, number formats, widths and merges. Formulas carry their
 * computed value too, so a viewer that does not recalculate still shows numbers.
 *
 * Two differences, both forced: driver_name is a value rather than a VLOOKUP into
 * a master_drivers sheet (that sheet only fed the lookup), and the trip list is a
 * filtered range rather than an Excel table. And no fonts or fills — the xlsx
 * package this repo uses cannot write them.
 *
 * ponytail: plain sheet-building, no I/O; runs in the browser (the month's legs are
 * too big for one Vercel response).
 */
import * as XLSX from "xlsx";
import { KM_PER_LITRE, PAY_THRESHOLD, type AllowanceRow, type PricePeriod } from "./gas-allowance";

const ACC0 = '_(* #,##0_);_(* \\(#,##0\\);_(* "-"??_);_(@_)';
const ACC2 = '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)';

/** VN wall clock "YYYY-MM-DDTHH:MM[:SS]" → Excel serial day. */
const serial = (wall: string) => Date.parse(`${wall.length === 16 ? `${wall}:00` : wall.slice(0, 19)}Z`) / 86_400_000 + 25_569;

type Cell = XLSX.CellObject;
const num = (v: number, z?: string): Cell => ({ t: "n", v, ...(z ? { z } : {}) });
const str = (v: string): Cell => ({ t: "s", v });
const fml = (f: string, v: number | string, z?: string): Cell =>
  typeof v === "number" ? { t: "n", f, v, ...(z ? { z } : {}) } : { t: "s", f, v };

function sheet(cells: Record<string, Cell>, cols: number[], merges: string[] = []): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = { ...cells };
  const addrs = Object.keys(cells).map((a) => XLSX.utils.decode_cell(a));
  const maxR = Math.max(0, ...addrs.map((a) => a.r)), maxC = Math.max(0, cols.length - 1, ...addrs.map((a) => a.c));
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
  ws["!cols"] = cols.map((wch) => ({ wch }));
  ws["!merges"] = merges.map((m) => XLSX.utils.decode_range(m));
  return ws;
}

export interface GasWorkbookInput {
  month: string; base: number; average: number; periods: PricePeriod[]; rows: AllowanceRow[];
  trips: { columns: readonly string[]; rows: unknown[][] };
}

export function gasWorkbook({ month, base, average, periods, rows, trips }: GasWorkbookInput): XLSX.WorkBook {
  const [yyyy, mm] = month.split("-");
  const m = Number(mm);
  const lastDay = new Date(Date.UTC(Number(yyyy), m, 0)).getUTCDate();
  const priceTab = `Tháng ${m}-${yyyy}`;
  const paid = (average - base) / base >= PAY_THRESHOLD;

  /* ---- Tháng M-YYYY: the hour-weighted average price ---------------------- */
  const p: Record<string, Cell> = {
    A1: str(`GIÁ THAM CHIẾU TRUNG BÌNH XĂNG E10 RON 95-III — THÁNG ${m}/${yyyy}`),
    A2: str(`Giá carry-over: ${periods[0]?.price.toLocaleString("vi-VN") ?? "?"} đ/lít  |  Kỳ tính: 01/${mm} 00:00 → ${lastDay}/${mm} 24:00  |  Tổng: ${periods.reduce((t, x) => t + x.hours, 0)} giờ`),
    A4: str("#"), B4: str("Giá (đ/lít)"), C4: str("Từ"), D4: str("Đến"), E4: str("Số giờ"), F4: str("Giá × Giờ"),
  };
  periods.forEach((x, i) => {
    const r = 5 + i;
    Object.assign(p, {
      [`A${r}`]: num(i + 1), [`B${r}`]: num(x.price, "#,##0"),
      [`C${r}`]: num(serial(x.from), "dd/mm hh:mm"), [`D${r}`]: num(serial(x.to), "dd/mm hh:mm"),
      [`E${r}`]: fml(`(D${r}-C${r})*24`, x.hours, "0"), [`F${r}`]: fml(`B${r}*E${r}`, x.price * x.hours, "#,##0"),
    });
  });
  const t = 5 + periods.length, last = t - 1;
  const hours = periods.reduce((s, x) => s + x.hours, 0), weighted = periods.reduce((s, x) => s + x.price * x.hours, 0);
  Object.assign(p, {
    [`A${t}`]: str("TỔNG"), [`E${t}`]: fml(`SUM(E5:E${last})`, hours, "0"), [`F${t}`]: fml(`SUM(F5:F${last})`, weighted, "#,##0"),
    [`A${t + 2}`]: str("Giá base"), [`E${t + 2}`]: num(base, "#,##0"), [`F${t + 2}`]: str("đ/lít"),
    [`A${t + 3}`]: str(`Giá tham chiếu trung bình tháng ${m}`), [`E${t + 3}`]: fml(`F${t}/E${t}`, average, "#,##0"), [`F${t + 3}`]: str("đ/lít"),
    [`A${t + 4}`]: str("Chênh lệch = MAX(0, Giá TB − Giá base)"), [`E${t + 4}`]: fml(`MAX(0,E${t + 3}-E${t + 2})`, Math.max(0, average - base), "#,##0"), [`F${t + 4}`]: str("đ/lít"),
    [`A${t + 6}`]: str("Ghi chú:"),
    [`A${t + 7}`]: str("Giá và thời điểm điều chỉnh: Xăng E10 RON 95-III, pvoil.com.vn/tin-gia-xang-dau. Số giờ, tổng và giá TB tự tính bằng công thức."),
    [`A${t + 8}`]: str(`Chỉ trả phụ cấp khi giá TB cao hơn giá base từ ${PAY_THRESHOLD * 100}% trở lên.`),
  });
  const priceSheet = sheet(p, [5, 14, 18, 18, 14, 18, 10],
    ["A1:F1", "A2:F2", `A${t}:D${t}`, `A${t + 2}:D${t + 2}`, `A${t + 3}:D${t + 3}`, `A${t + 4}:D${t + 4}`]);

  /* ---- Gas Allowance ------------------------------------------------------- */
  const variance = (average - base) / base;
  const g: Record<string, Cell> = {
    E2: str("Giá xăng Tham Chiếu (A)"), F2: str("Giá xăng Cơ Bản (B)"), G2: str("Km/1 lít Xăng (C)"),
    E3: fml(`'${priceTab}'!E${t + 3}`, average, ACC0), F3: num(base, ACC0), G3: num(KM_PER_LITRE, ACC0),
    D4: str(`Chênh lệch (≥ ${PAY_THRESHOLD * 100}% mới trả)`), E4: fml("E3/F3-1", variance, "0.0%"),
    F4: fml(`IF(E4>=${PAY_THRESHOLD},"Được trả","Không trả")`, paid ? "Được trả" : "Không trả"),
    B5: str(`1/${m} -> ${lastDay}/${m}`),
  };
  const header = (r: number, title: string) => Object.assign(g, {
    [`A${r}`]: str(title), [`B${r}`]: str("Sum of distance_km"), [`D${r}`]: str("Xăng Cần (E) = (D)/(C)"),
    [`E${r}`]: str("Tiền Xăng Tham Chiếu (E)*(A)"), [`F${r}`]: str("Tiền Xăng Cơ Bản (E)*(A)"), [`G${r}`]: str("Phụ Cấp Chênh Lệch"),
  });
  let r = 6;
  for (const [kind, title] of [["FT", "Giao Nhận Mẫu"], ["PT", "Giao Nhận Mẫu Part-time"]] as const) {
    header(r++, title);
    for (const row of rows.filter((x) => x.kind === kind)) {
      const litres = row.km / KM_PER_LITRE;
      Object.assign(g, {
        [`A${r}`]: str(row.name), [`B${r}`]: num(row.km),
        [`D${r}`]: fml(`B${r}/$G$3`, litres, ACC2), [`E${r}`]: fml(`D${r}*$E$3`, litres * average, ACC2),
        [`F${r}`]: fml(`D${r}*$F$3`, litres * base, ACC2),
        [`G${r}`]: fml(`IF($E$4>=${PAY_THRESHOLD},E${r}-F${r},0)`, paid ? litres * (average - base) : 0, ACC2),
      });
      r++;
    }
    r++; // blank row between the blocks
  }
  const total = rows.reduce((s, x) => s + (paid ? (x.km / KM_PER_LITRE) * (average - base) : 0), 0);
  g.G5 = fml(`SUM(G7:G${r - 2})`, total, ACC0);
  const allowanceSheet = sheet(g, [35.5, 18.4, 9, 19, 25.5, 21.4, 18.3]);

  /* ---- Trip Details ---------------------------------------------------------- */
  const tsCols = new Set(["departed_ts", "arrived_ts", "archived_at", "available_at"]);
  const aoa = [trips.columns as unknown as string[], ...trips.rows];
  const trip = XLSX.utils.aoa_to_sheet(aoa);
  trips.columns.forEach((c, ci) => {
    if (c !== "trip_date" && !tsCols.has(c)) return;
    trips.rows.forEach((row, ri) => {
      const v = row[ci];
      if (typeof v !== "string" || !v) return;
      trip[XLSX.utils.encode_cell({ r: ri + 1, c: ci })] = c === "trip_date"
        ? num(serial(`${v}T00:00`), "dd/mm/yyyy") : num(serial(v), "dd/mm/yyyy hh:mm:ss");
    });
  });
  trip["!autofilter"] = { ref: trip["!ref"]! };
  trip["!cols"] = trips.columns.map((c) => ({ wch: /name|customer_id|driver_id|^master_/.test(c) ? 36 : /_id$/.test(c) ? 14 : /_ts$|_at$/.test(c) ? 19 : 11 }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, allowanceSheet, "Gas Allowance");
  XLSX.utils.book_append_sheet(wb, sheet({}, []), "Data>>>");
  XLSX.utils.book_append_sheet(wb, priceSheet, priceTab);
  XLSX.utils.book_append_sheet(wb, trip, "Trip Details");
  return wb;
}

export const gasFileName = (month: string) => `${month.replace("-", ".")} Gasoline Allowance.xlsx`;
