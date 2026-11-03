import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { classifyPickupReply, cancelableScheduleJobs } from "../src/lib/scheduled-pickup-cancel";
import { SAMPLE_PICKUP_CUSTOMER_ID } from "../src/lib/scheduled-pickup-reminder";
import { vnDate } from "../src/lib/time";
import { PROXY_DRIVER_ID } from "../src/lib/cartrack";
import type { Job } from "../src/lib/types";

process.env.ZALO_KIOT_WEBHOOK_SECRET = "mock-secret";
process.env.ZALO_KIOT_BOT_TOKEN = "mock-bot";
process.env.ZALO_KIOT_ALLOWED_CHATS = "zgr-authorized";
process.env.CARTRACK_AUTH = "mock-auth";
process.env.SUPABASE_URL = "https://sb.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-key";

const PHARMACY_PICKUP_CUSTOMER_ID = "51bfb168-446f-11ed-888f-506b8dbc8dfb";
const CHAT_BY_CUSTOMER_ID: Record<string, string> = {
  [PHARMACY_PICKUP_CUSTOMER_ID]: "zgr-1c7aa981bbcf52910bde",
  "f88dfab6-b522-11ee-bb52-506b8d9879b5": "zgr-5f2b2b46331ada44830b",
};
const groupRow = (chat_id: string, customer_id: string, cancel = true, request = false) =>
  ({ bot: "dieu_phoi", chat_id, customer_id, label: "", remind: true, cancel, request, guide: false, guide_time: "07:30" });
let groupRows = [
  ...Object.entries(CHAT_BY_CUSTOMER_ID).map(([customer, chat]) => groupRow(chat, customer)),
  groupRow("zgr-quiet", PHARMACY_PICKUP_CUSTOMER_ID, false),
  // Another bot's group must not count for this webhook.
  { ...groupRow("zgr-sample-only", PHARMACY_PICKUP_CUSTOMER_ID), bot: "giao_nhan_mau" },
  groupRow("zgr-request", PHARMACY_PICKUP_CUSTOMER_ID, false, true),
];
const botRows = [
  { id: "dieu_phoi", name: "Bot Điều Phối X", token: null, webhook_secret: null },
  { id: "giao_nhan_mau", name: "Bot Giao nhận mẫu", token: null, webhook_secret: null },
];
let groupsDown = false;
const creates: string[] = [];

const { POST } = await import("../src/app/api/zalo/webhook/route");
const originalFetch = globalThis.fetch;
const sent: string[] = [];
let dropRows: { default_dropoff_id: string | null }[] = [];
let jobReads = 0;
let lookupJobs: Job[] = [];
globalThis.fetch = async (input, init) => {
  if (String(input).startsWith("https://sb.test/rest/v1/client_bot_groups")) {
    return groupsDown ? new Response("down", { status: 503 }) : Response.json(groupRows);
  }
  if (String(input).startsWith("https://sb.test/rest/v1/client_bots?")) return Response.json(botRows);
  if (String(input).startsWith("https://sb.test/rest/v1/client_bot_settings")) return Response.json([{ request_keywords: ["qua lấy mẫu", "đặt chuyến"] }]);
  if (String(input).startsWith("https://sb.test/rest/v1/master_clients_read")) return Response.json(dropRows);
  if (String(input).includes("cartrack.com") && init?.method === "POST") {
    creates.push(String(init?.body));
    return Response.json({ data: { job_id: 9001 } });
  }
  if (String(input).startsWith("https://fleetapi-vn.cartrack.com/rest/delivery/jobs?")) {
    jobReads++;
    return Response.json({ data: lookupJobs });
  }
  sent.push(String(init?.body));
  return Response.json({ ok: true });
};

const request = (chatId: string, text: string) => new NextRequest(
  "https://example.test/api/zalo/webhook?key=mock-secret",
  { method: "POST", body: JSON.stringify({ event_name: "message.text.received", message: { chat: { id: chatId, chat_type: "GROUP" }, from: { is_bot: false }, text } }) },
);

try {
  for (const chatId of ["zgr-1c7aa981bbcf52910bde", "zgr-5f2b2b46331ada44830b"]) {
    for (const text of ["id", "doanh thu", "hello"]) {
      const response = await POST(request(chatId, text));
      assert.equal(response.status, 200);
    }
  }
  assert.equal(sent.length, 0, "pickup group must receive no webhook reply");

  await POST(request("zgr-other", "doanh thu"));
  assert.equal(sent.length, 1, "other unauthorized groups retain the existing response");
  assert.match(sent[0], /không có quyền xem doanh thu/);

  const pharmacyChat = CHAT_BY_CUSTOMER_ID[PHARMACY_PICKUP_CUSTOMER_ID];
  const webhookRequest = (text: string, overrides: Record<string, unknown> = {}, secret = "mock-secret") => new NextRequest(
    "https://example.test/api/zalo/webhook", {
      method: "POST", headers: { "x-bot-api-secret-token": secret },
      body: JSON.stringify({ ok: true, result: { event_name: "message.text.received", message: {
        text, chat: { id: pharmacyChat, chat_type: "GROUP" }, from: { is_bot: false }, ...overrides,
      } } }),
    },
  );
  const positives = ["dạ có mẫu ạ", "@Bot Điều Phối X dạ có mẫu a", "có mẫu nhe", "có mẫu", "hôm nay có mẫu", "đã có mẫu", "có mẫu rồi"];
  for (const text of positives) {
    assert.equal(classifyPickupReply(text), "ignore", text);
    for (const chatId of Object.values(CHAT_BY_CUSTOMER_ID)) {
      await POST(webhookRequest(text, { chat: { id: chatId, chat_type: "GROUP" } }));
    }
  }
  assert.equal(jobReads, 0, "positive/ambiguous replies must never enter cancellation");
  assert.equal(sent.length, 1, "positive replies in the pickup group stay silent");
  const negatives = ["@Bot Điều Phối X Dạ hong có ạ", "ko mẫu", "không mẫu", "k mẫu", "ko mẫu nha", "chưa có mẫu nhé", "dạ hôm nay không có mẫu ạ", "@Bot Điều Phối X dạ ko mẫu a", "dạ ko mẫu a", "chưa có mẫu", "không có mẫu", "k có mẫu", "chua co mau", "hôm nay chưa có mẫu", "hôm nay k có mẫu", "ko có", "chưa có", "k có", "@Bot Điều Phối X ko có"];
  for (const chatId of Object.values(CHAT_BY_CUSTOMER_ID)) {
    const before = sent.length;
    for (const text of negatives) {
      assert.equal(classifyPickupReply(text), "cancel", text);
      await POST(webhookRequest(text, { chat: { id: chatId, chat_type: "GROUP" } }));
    }
    assert.ok(sent.slice(before).every((body) => JSON.parse(body).chat_id === chatId));
  }
  const expectedReads = negatives.length * Object.keys(CHAT_BY_CUSTOMER_ID).length;
  assert.equal(jobReads, expectedReads, "all configured pickup groups must handle negative replies");
  assert.equal(sent.length, 1 + expectedReads);
  const reviewStart = sent.length;
  for (const chatId of Object.values(CHAT_BY_CUSTOMER_ID)) {
    for (const text of ["không có mẫu nhưng chiều có mẫu", "mai không có mẫu", "chưa có mẫu?", "chưa có mẫu nhưng lát có mẫu"]) {
      assert.equal(classifyPickupReply(text), "review", text);
      await POST(webhookRequest(text, { chat: { id: chatId, chat_type: "GROUP" } }));
    }
    for (const text of ["lát nữa", "để em báo lại", "cho em xác nhận"]) {
      assert.equal(classifyPickupReply(text), "ignore", text);
      await POST(webhookRequest(text, { chat: { id: chatId, chat_type: "GROUP" } }));
    }
  }
  assert.equal(jobReads, expectedReads, "review and ignored replies must never enter the cancellation path");
  assert.ok(sent.slice(reviewStart).every(body => JSON.parse(body).text.includes("Bot chưa huỷ")));
  await POST(webhookRequest("chưa có mẫu", { from: { is_bot: true } }));
  await POST(webhookRequest("chưa có mẫu", { chat: { id: pharmacyChat, chat_type: "PRIVATE" } }));
  await POST(webhookRequest("chưa có mẫu", { chat: { id: "zgr-unmapped", chat_type: "GROUP" } }));
  assert.equal((await POST(webhookRequest("chưa có mẫu", {}, "wrong-secret"))).status, 401);
  assert.equal(jobReads, expectedReads, "bots, unmapped groups, private chats and invalid secrets cannot cancel");
  assert.equal(classifyPickupReply("chưa có mẫu"), "cancel", "all clients share the negative phrases");
  const today = "2026-10-05";
  const pickupJob: Job = {
    job_id: 1, job_status_id: 4, scheduled_delivery_ts: today + " 10:30:00", labels: ["📅 Lịch cố định"],
    stops: [{ stop_type_id: 1, stop_status_id: 1, customer_id: PHARMACY_PICKUP_CUSTOMER_ID }],
  };
  assert.equal(cancelableScheduleJobs([pickupJob], today, PHARMACY_PICKUP_CUSTOMER_ID).length, 1);
  assert.equal(cancelableScheduleJobs([pickupJob], today, SAMPLE_PICKUP_CUSTOMER_ID).length, 0);
  assert.equal(cancelableScheduleJobs([{ ...pickupJob, labels: [] }], today, PHARMACY_PICKUP_CUSTOMER_ID).length, 0);
  assert.equal(cancelableScheduleJobs([{ ...pickupJob, scheduled_delivery_ts: "2026-10-06 10:30:00" }], today, PHARMACY_PICKUP_CUSTOMER_ID).length, 0);
  assert.equal(cancelableScheduleJobs([{ ...pickupJob, stops: [{ ...pickupJob.stops![0], activity_started_ts: today + " 09:30:00" }] }], today, PHARMACY_PICKUP_CUSTOMER_ID).length, 0);
  const dueJob = { ...pickupJob, send_to_driver_at: "2026-01-01 08:30:00+07", delivery_driver_id: "real-driver" };
  const futureJob = { ...pickupJob, job_id: 2, send_to_driver_at: "2099-01-01 14:00:00", delivery_driver_id: PROXY_DRIVER_ID };
  assert.deepEqual(cancelableScheduleJobs([dueJob, futureJob], today, PHARMACY_PICKUP_CUSTOMER_ID, true).map((j) => j.job_id), [1], "only the released current pickup is eligible");
  assert.equal(cancelableScheduleJobs([{ ...futureJob, delivery_driver_id: null }], today, PHARMACY_PICKUP_CUSTOMER_ID, true).length, 0, "a failed parking operation cannot expose a future pickup");
  assert.equal(cancelableScheduleJobs([{ ...dueJob, send_to_driver_at: "invalid" }], today, PHARMACY_PICKUP_CUSTOMER_ID, true).length, 0);
  assert.equal(cancelableScheduleJobs([{ ...dueJob, delivery_driver_id: PROXY_DRIVER_ID }], today, PHARMACY_PICKUP_CUSTOMER_ID, true).length, 0, "a pickup still parked must not be cancelled");
  assert.equal(cancelableScheduleJobs([pickupJob], today, PHARMACY_PICKUP_CUSTOMER_ID, true).length, 0, "unknown release state must fail closed");
  lookupJobs = [{ ...dueJob, scheduled_delivery_ts: vnDate() + " 10:30:00" }];
  const otherCustomerChat = Object.entries(CHAT_BY_CUSTOMER_ID).find(([customerId]) => customerId !== PHARMACY_PICKUP_CUSTOMER_ID)![1];
  await POST(webhookRequest("ko có", { chat: { id: otherCustomerChat, chat_type: "GROUP" } }));
  assert.equal(JSON.parse(sent.at(-1)!).text, "Hiện không có chuyến lấy mẫu cố định nào đủ điều kiện huỷ.", "a group cannot cancel another customer's current pickup");
  // A group with cancel off is still a client group: silent, no lookup, no revenue reply.
  const quietReads = jobReads, quietSent = sent.length;
  await POST(webhookRequest("ko có", { chat: { id: "zgr-quiet", chat_type: "GROUP" } }));
  await POST(webhookRequest("doanh thu", { chat: { id: "zgr-quiet", chat_type: "GROUP" } }));
  // Unreadable group list: stay silent rather than risk the revenue reply in a client group.
  groupsDown = true;
  await POST(webhookRequest("ko có", { chat: { id: pharmacyChat, chat_type: "GROUP" } }));
  await POST(request("zgr-other", "doanh thu"));
  groupsDown = false;
  assert.equal(jobReads, quietReads, "cancel off / unreadable list must never cancel");
  assert.equal(sent.length, quietSent, "cancel off / unreadable list must stay silent");
  await POST(webhookRequest("ko có", { chat: { id: "zgr-sample-only", chat_type: "GROUP" } }));
  assert.equal(jobReads, quietReads, "another bot's group is not this bot's client group");
  // Trip request: a keyword books client → its default drop-off (D001 if none); negated replies and request-off groups never do.
  const lastReply = () => JSON.parse(sent.at(-1)!).text as string;
  await POST(webhookRequest("@Bot Điều Phối X Dạ qua lấy mẫu giúp em", { chat: { id: "zgr-request", chat_type: "GROUP" } }));
  assert.equal(creates.length, 1, "keyword in a request group creates one trip");
  const created = JSON.parse(creates[0]);
  const stops = created.stops ?? created.data?.stops ?? created.params?.data?.stops;
  assert.ok(JSON.stringify(created).includes(PHARMACY_PICKUP_CUSTOMER_ID) && JSON.stringify(created).includes("3927b076-3af9-11ed-b939-506b8dbc8dfb"), JSON.stringify(stops));
  assert.match(lastReply(), /Đã nhận yêu cầu lấy mẫu \(Job #9001\)\. Diag sẽ sắp xếp/);
  assert.ok(creates[0].includes("Dạ qua lấy mẫu giúp em") && !creates[0].includes("@Bot"), "the client's words, minus the tag, are the pickup note");
  await POST(webhookRequest("không cần qua lấy mẫu", { chat: { id: "zgr-request", chat_type: "GROUP" } }));
  await POST(webhookRequest("hôm nay không có mẫu", { chat: { id: "zgr-request", chat_type: "GROUP" } }));
  await POST(webhookRequest("qua lấy mẫu", { chat: { id: "zgr-quiet", chat_type: "GROUP" } }));
  await POST(webhookRequest("hello qua lấy mẫuxyz", { chat: { id: "zgr-request", chat_type: "GROUP" } }));
  assert.equal(creates.length, 1, "negated, request-off and partial-word messages never create a trip");
  // A default drop-off on the master client list replaces D001 (here D010).
  dropRows = [{ default_dropoff_id: "9a15e7a4-3d83-11ed-be4e-506b8dbc8dfb" }];
  await POST(webhookRequest("qua lấy mẫu", { chat: { id: "zgr-request", chat_type: "GROUP" } }));
  assert.ok(creates[1]?.includes("9a15e7a4-3d83-11ed-be4e-506b8dbc8dfb") && !creates[1].includes("3927b076") && creates[1].includes("→D010_"), creates[1]);
  dropRows = [];
  creates.length = 1;
  await POST(webhookRequest("@Bot Điều Phối X hướng dẫn", { chat: { id: "zgr-request", chat_type: "GROUP" } }));
  assert.equal(lastReply(), "💡 Gợi ý 💡 khách hàng có thể tag **@Bot Điều Phối X** và nhắn “qua lấy mẫu” hoặc “đặt chuyến” để có thể được hỗ trợ lấy mẫu nhanh nhất.");
  const beforeNoGuide = sent.length;
  await POST(webhookRequest("@Bot Điều Phối X hướng dẫn", { chat: { id: pharmacyChat, chat_type: "GROUP" } }));
  assert.equal(sent.length, beforeNoGuide, "no tip where trip request is off");

  // A reply that promises a staff check also alerts the admin group; clients never read "Cartrack"/"điều phối".
  process.env.ZALO_ADMIN_BOT_TOKEN = "admin-bot";
  process.env.ZALO_ADMIN_CHAT_ID = "zgr-admin";
  await POST(webhookRequest("mai không có mẫu", { chat: { id: pharmacyChat, chat_type: "GROUP" } }));
  const [alert, reply] = sent.slice(-2).map(b => JSON.parse(b));
  assert.equal(reply.text, "Bot chưa huỷ chuyến lấy mẫu. Vui lòng đợi nhân viên Diag kiểm tra thêm, xin cám ơn!");
  assert.equal(alert.chat_id, "zgr-admin");
  assert.match(alert.text, /Bot Zalo cần kiểm tra[\s\S]*mai không có mẫu/);
  const clientTexts = sent.map(b => JSON.parse(b)).filter(m => m.chat_id !== "zgr-admin").map(m => String(m.text ?? "").replace("@Bot Điều Phối X", ""));
  assert.ok(clientTexts.every(t => !/cartrack|điều phối/i.test(t)), "no client reply names Cartrack or điều phối (the bot's own name aside)");

  groupRows = [];
  console.log("Zalo pickup cancellation and revenue isolation check passed.");
} finally {
  globalThis.fetch = originalFetch;
}
