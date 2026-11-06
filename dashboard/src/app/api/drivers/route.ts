import { NextRequest, NextResponse } from "next/server";
import { createMasterDriver } from "@/lib/master-driver-create";
import { invalidateConfigCache, invalidateDriversCache } from "@/lib/config";
import { getActiveDriversFast, getDrivers, type Env } from "@/lib/cartrack";

export async function GET(req: NextRequest) {
  const env = (req.nextUrl.searchParams.get("env") ?? "prod") as Env;
  try {
    // Active accounts from the RPC list (~0.2s); REST only when it cannot answer.
    const drivers = (await getActiveDriversFast(env)) ?? (await getDrivers(env));
    return NextResponse.json({ data: drivers });
  } catch (e) {
    return NextResponse.json(
      { data: [], error: String(e) },
      { status: 500 }
    );
  }
}

/** Public profile creation follows the dashboard's explicitly authorized profile editing policy. */
export async function POST(req:NextRequest) {
  try {
    const body=await req.json();
    const result=await createMasterDriver(body?.request_id,body?.profile);
    invalidateDriversCache();await invalidateConfigCache();
    return NextResponse.json({ok:true,...result});
  }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Không tạo được tài xế"},{status:400});}
}
