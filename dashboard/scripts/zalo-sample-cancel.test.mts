import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST } from "../src/app/api/zalo/sample-cancel/route";
import { cancelableScheduleJobs, classifyPickupReply } from "../src/lib/scheduled-pickup-cancel";
const SAMPLE_PICKUP_CUSTOMER_ID = "81f0d4a6-acf9-11f1-9378-fa163ee8d8ac";
import type { Job } from "../src/lib/types";

const cases: Record<"cancel" | "review" | "ignore", string[]> = {
  cancel: [
    "@Bot Giao nhận mẫu Dạ hong có ạ", "hong có", "dạ hông có ạ", "hổng có mẫu", "hôm nay hong có mẫu",
    "ko mẫu", "không mẫu", "k mẫu", "ko mẫu nha", "chưa có mẫu nhé", "dạ hôm nay không có mẫu ạ",
    "@Bot Giao nhận mẫu dạ ko mẫu a", "@Bot Điều Phối X chưa có mẫu nhé", "không mẫu ạ", "ko có", "k có",
    "chưa có mẫu", "chưa có", "chưa có hàng", "chưa có bệnh phẩm", "chưa c mẫu", "chx có mẫu", "chưa có mẫu nha",
    "/không có mẫu", "@Bot Giao nhận mẫu /không có mẫu", "không có mẫu @Bot Giao nhận mẫu",
    "hôm nay k có mẫu", "không có mẫu nào", "hết mẫu", "không còn mẫu", "không có bệnh phẩm",
    "không có hàng", "không có gì gửi", "không có gì để gửi", "không cần lấy", "không cần qua lấy",
    "không cần đến", "không cần ghé", "không cần chạy", "khỏi lấy", "khỏi qua", "khỏi ghé", "không phải qua",
    "đừng qua", "hôm nay nghỉ", "hôm nay đóng cửa", "nghỉ lễ", "nghỉ phép", "tạm nghỉ", "bên em nghỉ",
    "phòng khám nghỉ", "hôm nay không lấy", "bỏ lượt hôm nay", "huỷ lịch lấy", "huỷ pick", "0 có mẫu", "o có mẫu",
    "ko có hàng", "k có hàng", "ko cần lấy", "k cần lấy", "ko cần qua", "k cần qua", "hnay ko co",
    "hnay k có mẫu", "hnay nghỉ", "hnay ko lấy", "hnay k lay", "nay không có mẫu", "hum nay ko có",
    "không cần qua lấy giúp em", "không cần lấy dùm", "không còn mẫu, không cần qua lấy", "không có gì",
    "@Bot Giao nhận mẫu không có mẫu, không cần qua lấy",
  ],
  review: [
    "dạ hong có mẫu nhưng chiều có mẫu", "mai hong có mẫu", "hong có mẫu nhưng vẫn lấy", "hong có mẫu?",
    "không có mẫu nhưng chiều có mẫu", "không có hàng nhưng vẫn lấy", "ko mẫu nhưng cần lấy giúp",
    "không mẫu nhưng nhờ qua", "không có mẫu gấp", "dạ ko mẫu a?", "mai ko mẫu",
    "hôm nay không có mẫu, ngày mai có mẫu", "@Bot Giao nhận mẫu hôm nay có mẫu nhưng chiều ko mẫu",
    "@Bot Điều Phối X có mẫu, không cần qua", "dạ ko mẫu nhưng chiều có", "ko có mẫu nhưng lát có",
    "chưa có mẫu nhưng lát có mẫu", "chưa có mẫu?", "không có mẫu?", "còn mẫu nhưng không cần qua",
  ],
  ignore: [
    "chị Hồng có mẫu", "dạ có ạ", "hong có?",
    "dạ có mẫu ạ", "@Bot Giao nhận mẫu dạ có mẫu a", "có", "có nhe", "có mẫu nhe", "/có mẫu",
    "hôm nay có mẫu", "còn mẫu", "còn hàng", "mẫu gấp", "nhờ qua lấy", "doanh thu", "hello",
    "lúc nữa", "lát nữa", "chiều có", "chiều mới có", "để em báo lại", "để em báo", "cho em xác nhận",
  ],
};
for (const [expected, messages] of Object.entries(cases)) {
  for (const text of messages) assert.equal(classifyPickupReply(text), expected, text);
}
for (const date of ["mai", "ngày mai", "mốt", "hôm sau", "ngày kia", "thứ 2", "thứ 3", "thứ 4", "thứ 5", "thứ 6", "thứ 7", "chủ nhật", "cn", "thứ hai", "thứ ba", "thứ tư", "thứ năm", "thứ sáu", "thứ bảy", "tuần sau", "tuần tới", "tháng sau", "tháng tới"]) {
  assert.equal(classifyPickupReply(`${date} không có mẫu`), "review", date);
  assert.equal(classifyPickupReply(`hôm nay không có mẫu, ${date} vẫn lấy`), "review", date);
}

const today = "2026-10-01";
const job = (overrides: Partial<Job> = {}): Job => ({
  job_id: 1,
  job_status_id: 4,
  scheduled_delivery_ts: today + " 10:30:00",
  labels: ["📅 Lịch cố định"],
  stops: [{ stop_type_id: 1, stop_status_id: 1, customer_id: SAMPLE_PICKUP_CUSTOMER_ID }],
  ...overrides,
});
assert.deepEqual(cancelableScheduleJobs([job()], today, SAMPLE_PICKUP_CUSTOMER_ID).map((j) => j.job_id), [1]);
assert.equal(cancelableScheduleJobs([job({ labels: [] })], today, SAMPLE_PICKUP_CUSTOMER_ID).length, 0);
assert.equal(cancelableScheduleJobs([job({ scheduled_delivery_ts: "2026-10-02 10:30:00" })], today, SAMPLE_PICKUP_CUSTOMER_ID).length, 0);
assert.equal(cancelableScheduleJobs([job({ stops: [{ stop_type_id: 1, stop_status_id: 2, customer_id: SAMPLE_PICKUP_CUSTOMER_ID }] })], today, SAMPLE_PICKUP_CUSTOMER_ID).length, 0);
assert.equal(cancelableScheduleJobs([job({ stops: [{ stop_type_id: 1, stop_status_id: 1, customer_id: "other" }] })], today, SAMPLE_PICKUP_CUSTOMER_ID).length, 0);

// A real handler request: Zalo's documented envelope and tagged commands must reply.
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const sends: { chat_id: string; text: string }[] = [];
try {
  process.env.ZALO_SAMPLE_BOT_TOKEN = "test-token";
  process.env.ZALO_SAMPLE_WEBHOOK_SECRET = "test-secret";
  let jobReads = 0;
  process.env.CARTRACK_AUTH = "test-auth";
  process.env.SUPABASE_URL = "https://sb.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
  let groupRows: object[] = [];
  const sampleRow = (chat_id: string) => ({ bot: "giao_nhan_mau", chat_id, customer_id: SAMPLE_PICKUP_CUSTOMER_ID, label: "", remind: true, cancel: true });
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://sb.test/rest/v1/client_bot_groups")) return Response.json(groupRows);
    if (String(url).startsWith("https://sb.test/rest/v1/client_bots?")) return Response.json([
      { id: "giao_nhan_mau", name: "Bot Giao nhận mẫu", token: null, webhook_secret: null },
      { id: "an_sinh", name: "Bot Trợ Lý Diag", token: null, webhook_secret: null },
    ]);
    if (String(url).startsWith("https://fleetapi-vn.cartrack.com/rest/delivery/jobs?")) {
      jobReads++;
      return Response.json({ data: [] });
    }
    sends.push(JSON.parse(String(init?.body)));
    return Response.json({ ok: true });
  };
  const message = (text: string, chatType = "GROUP") => ({
    event_name: "message.text.received",
    message: { text, chat: { id: "test-group", chat_type: chatType }, from: { is_bot: false } },
  });
  const request = (body: unknown, secret = "test-secret") => new NextRequest("https://example.test/api/zalo/sample-cancel", {
    method: "POST", headers: { "Content-Type": "application/json", "x-bot-api-secret-token": secret },
    body: JSON.stringify(body),
  });
  for (const text of ["/id", "@Bot Giao nhận mẫu /id", "/id @Bot Giao nhận mẫu"]) {
    const response = await POST(request({ ok: true, result: message(text) }));
    assert.equal(response.status, 200);
  }
  await POST(request(message("/id")));
  assert.equal(sends.length, 4);
  assert.ok(sends.every((reply) => reply.chat_id === "test-group" && reply.text === "Chat ID: test-group"));
  assert.equal((await POST(request(message("/id"), "wrong-secret"))).status, 401);
  await POST(request({ ok: true, result: message("/id", "PRIVATE") }));
  await POST(request({ ok: true, result: message("/k co mau") }));
  await POST(request(null));
  assert.equal(sends.length, 4, "Unauthorized/private/cancellation messages must not act during setup");
  assert.equal(jobReads, 0);
  groupRows = [sampleRow("test-group")];
  await POST(request(message("hôm nay có mẫu")));
  groupRows = [sampleRow("another-group")];
  await POST(request(message("hôm nay không có mẫu")));
  assert.equal(jobReads, 0, "Positive replies and other groups cannot trigger a cancellation lookup");
  groupRows = [sampleRow("test-group")];
  const negatives = ["@Bot Giao nhận mẫu Dạ hong có ạ", "ko mẫu", "không mẫu", "k mẫu", "ko mẫu nha", "chưa có mẫu nhé", "dạ hôm nay không có mẫu ạ", "@Bot Giao nhận mẫu dạ ko mẫu a", "dạ ko mẫu a", "không có mẫu", "hôm nay không có mẫu", "hôm nay k có mẫu", "ko có", "chưa có", "k có", "ko có mẫu", "chưa có mẫu", "@Bot Giao nhận mẫu ko có"];
  for (const text of negatives) {
    await POST(request({ ok: true, result: message(text) }));
  }
  assert.equal(jobReads, negatives.length, "Natural replies must enter the cancellation handler");
  assert.equal(sends.length, 4 + negatives.length);
  assert.ok(sends.slice(4).every((reply) => reply.text === "Hiện không có chuyến lấy mẫu cố định nào đủ điều kiện huỷ."));
  const readsBeforeReview = jobReads;
  for (const text of cases.review) await POST(request({ ok: true, result: message(text) }));
  assert.equal(jobReads, readsBeforeReview, "mixed and future-date replies must never read or cancel Cartrack jobs");
  assert.ok(sends.slice(4 + negatives.length).every(reply => reply.chat_id === "test-group" && reply.text.includes("Bot chưa huỷ")));
  // A table row serves its own customer; cancel off keeps the group silent.
  groupRows = [{ bot: "giao_nhan_mau", chat_id: "test-group", customer_id: "other-customer", label: "", remind: true, cancel: false }];
  const beforeOff = { reads: jobReads, sent: sends.length };
  await POST(request(message("không có mẫu")));
  await POST(request(message("/id")));
  assert.deepEqual({ reads: jobReads, sent: sends.length }, beforeOff, "cancel off: no lookup, no reply, no /id once set up");
  groupRows = [{ ...groupRows[0], cancel: true }];
  await POST(request(message("không có mẫu")));
  assert.equal(jobReads, beforeOff.reads + 1, "a group added in the table cancels for its own customer");

  // An Sinh's route: secret = sha256(token) hex, first 32 — as registered with Zalo before the table.
  const { POST: anSinh } = await import("../src/app/api/zalo/an-sinh/route");
  const { createHash } = await import("node:crypto");
  process.env.ZALO_ANSINH_BOT_TOKEN = "ansinh-token";
  const anSinhSecret = createHash("sha256").update("ansinh-token").digest("hex").slice(0, 32);
  const anSinhReq = (secret: string) => new NextRequest("https://example.test/api/zalo/an-sinh", {
    method: "POST", headers: { "Content-Type": "application/json", "x-bot-api-secret-token": secret },
    body: JSON.stringify({ ok: true, result: { ...message("@Bot Trợ Lý Diag không có mẫu"), message: { ...message("").message, text: "@Bot Trợ Lý Diag không có mẫu", chat: { id: "zgr-ansinh", chat_type: "GROUP" } } } }),
  });
  groupRows = [{ bot: "an_sinh", chat_id: "zgr-ansinh", customer_id: "f0773008-0f51-11ee-951b-506b8dbc8dfb", label: "An Sinh", remind: true, cancel: true }];
  assert.equal((await anSinh(anSinhReq("wrong"))).status, 401);
  const beforeAnSinh = { reads: jobReads, sent: sends.length };
  assert.equal((await anSinh(anSinhReq(anSinhSecret))).status, 200);
  assert.equal(jobReads, beforeAnSinh.reads + 1, "An Sinh's group cancels through its own route");
  assert.equal(sends.at(-1)?.chat_id, "zgr-ansinh");
} finally {
  globalThis.fetch = originalFetch;
  process.env = originalEnv;
}
