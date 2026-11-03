import { NextRequest } from "next/server";
import { handleClientBot } from "@/lib/client-bot-webhook";

export const runtime = "nodejs";
export const preferredRegion = "sin1";

export const POST = (req: NextRequest) => handleClientBot(req, "an-sinh");
