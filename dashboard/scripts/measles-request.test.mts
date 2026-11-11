import assert from "node:assert/strict";
import { measlesRequest } from "../src/lib/client-bot-actions";

// NĐTP bot: "sởi" books the 06:00 next-day trip to D001; "không có mẫu sởi" is ignored.
for (const t of ["@Bot Trợ Lý Diag mẫu sởi", "có 2 mẫu Sởi", "SỞI", "lay mau soi giup em", "có mẫu sởi, không có mẫu khác"])
  assert.equal(measlesRequest(t), "trip", t);
for (const t of ["không có mẫu sởi", "Hôm nay ko có mẫu sởi ạ", "k co mau soi", "chưa có mẫu sởi", "không sởi"])
  assert.equal(measlesRequest(t), "none", t);
for (const t of ["lấy mẫu", "không có mẫu", "soi giúp em", "sợi dây"])
  assert.equal(measlesRequest(t), null, t);
console.log("measles-request: ok");
