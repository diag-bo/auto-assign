// /corp — corporate clinics that send samples to D001 (DYM D7 to D006). Shared by the page and the API
// (whitelist: the client never picks a customer_id the server has not listed).

/** Marks a trip as booked from /corp; the page lists only trips carrying it. */
export const CORP_LABEL = "Mẫu Corp";

const D001 = { id: "3927b076-3af9-11ed-b939-506b8dbc8dfb", name: "BRA - D001", code: "D001" };
const D006 = { id: "c07bc96a-3d81-11ed-989f-506b8dbc8dfb", name: "BRA - D006", code: "D006" };

export const CORP_CLINICS: {
  customer_id: string; name: string; short: string; phone: string;
  dropoff: { id: string; name: string; code: string };
}[] = [
  { customer_id: "afe6f722-4daf-11f1-9378-fa163ee8d8ac", name: "22303 - D3 - DBPhu - Vietmedi Điện Biên Phủ", short: "Vietmedi Điện Biên Phủ", phone: "0363823675", dropoff: D001 },
  { customer_id: "8109495e-580f-11f1-9378-fa163ee8d8ac", name: "49787862 - D1 - NTMKhai - Phòng Khám Đa Khoa DHA Healthcare", short: "DHA Healthcare", phone: "0937192725", dropoff: D001 },
  { customer_id: "6c9c33de-8745-11ee-98f4-506b8d9879b5", name: "18564 - D1 - NTrai - PHÒNG KHÁM ĐA KHOA IVY HEALTH", short: "IVY Health", phone: "0908710710", dropoff: D001 },
  // Default phone is the one saved on the clinic in Cartrack (none was given).
  { customer_id: "3354bbe0-9495-11f1-9378-fa163ee8d8ac", name: "46539523 - D3 - TDinh - PHÒNG KHÁM ĐA KHOA QUỐC TẾ YERSIN", short: "PK Quốc tế Yersin", phone: "0964925150", dropoff: D001 },
  { customer_id: "459f3456-6644-11ee-b1dc-506b8d9879b5", name: "18513 - D7 - HVThai - DYM Medical Center D7", short: "DYM D7", phone: "0362340850", dropoff: D006 },
  { customer_id: "e95894d4-ed77-11ed-941b-506b8dbc8dfb", name: "46511528 - D1 - TVCan - Công ty TNHH Bệnh viện Đa Khoa Quốc Tế Sài Gòn", short: "BV Quốc tế Sài Gòn Q1", phone: "0934855808", dropoff: D001 },
];

/** "0937 192 725" / "+84937192725" → "937192725", the national form Cartrack stores
 *  beside contact_code 84. null when it is not a Vietnamese mobile or landline. */
export function normalizeVnPhone(raw: string): string | null {
  const digits = raw.replace(/[\s.\-()]/g, "").replace(/^\+?84/, "").replace(/^0/, "");
  return /^\d{9,10}$/.test(digits) ? digits : null;
}
