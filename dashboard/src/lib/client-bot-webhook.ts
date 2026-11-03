import { NextRequest, NextResponse } from "next/server";
import { getPickupReply } from "./scheduled-pickup-cancel";
import { clientBots } from "./scheduled-pickup-reminder";
import { sendZaloMessage } from "./zalo";

type Update = {
  event_name?: string;
  message?: {
    text?: string;
    chat?: { id?: string | number; chat_type?: string };
    from?: { is_bot?: boolean };
  };
};

/** Webhook for one client's own pickup bot (see clientBots). */
export async function handleClientBot(req: NextRequest, key: string) {
  const bot = clientBots()[key];
  if (!bot?.secret || req.headers.get("x-bot-api-secret-token") !== bot.secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: Update;
  try {
    const body = await req.json();
    if (!body || typeof body !== "object") return NextResponse.json({ ok: true });
    update = body.result ?? body;
    if (!update || typeof update !== "object") return NextResponse.json({ ok: true });
  }
  catch { return NextResponse.json({ ok: true }); }

  console.info(`[zalo-${key}] received`, {
    event: update.event_name,
    chatId: update.message?.chat?.id,
    chatType: update.message?.chat?.chat_type,
  });

  if (update.event_name !== "message.text.received" || update.message?.from?.is_bot) {
    return NextResponse.json({ ok: true });
  }
  const chat = update.message?.chat;
  const chatId = chat?.id == null ? "" : String(chat.id);
  if (!chatId || chat?.chat_type !== "GROUP") return NextResponse.json({ ok: true });

  const token = bot.token;
  if (!token) return NextResponse.json({ ok: true });
  const text = typeof update.message?.text === "string" ? update.message.text : "";

  // Setup command: the group can reveal its own chat ID before it is allowlisted.
  if (!bot.chatId && /^(?:@.+?\s+)?\/id(?:\s+@.+)?$/i.test(text.trim())) {
    const sent = await sendZaloMessage(token, chatId, `Chat ID: ${chatId}`);
    if (!sent) console.error(`[zalo-${key}] chat ID reply failed`, { chatId });
    return NextResponse.json({ ok: true });
  }
  if (chatId !== bot.chatId) {
    return NextResponse.json({ ok: true });
  }

  const reply = await getPickupReply(bot.customerId, text, chatId);
  if (reply) await sendZaloMessage(token, chatId, reply);
  return NextResponse.json({ ok: true });
}
