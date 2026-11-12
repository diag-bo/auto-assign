import { NextRequest,NextResponse } from "next/server";
import { dropRemovedCartrackClient,removedCartrackClients,removedClientReferences,retireRemovedCartrackClient } from "@/lib/master-removed-clients";
import { invalidateConfigCache } from "@/lib/config";
export const runtime="nodejs";
export const preferredRegion="sin1";
export async function GET(req:NextRequest) {
  try {
    const id=req.nextUrl.searchParams.get("id");
    return NextResponse.json(id ? {references:await removedClientReferences(id)} : {rows:await removedCartrackClients()});
  } catch(e) {return NextResponse.json({error:String(e)},{status:502});}
}
// Retire: move the rules to `to` (the same-name replacement) or switch them off.
export async function POST(req:NextRequest) {
  try {
    const body=await req.json();
    if(body.confirmed!==true||typeof body.id!=="string"||typeof body.missingAt!=="string"||(body.to!==undefined&&typeof body.to!=="string")) return NextResponse.json({error:"Cần xác nhận địa điểm"},{status:400});
    const result=await retireRemovedCartrackClient(body.id,body.missingAt,body.to);
    await invalidateConfigCache();
    return NextResponse.json({ok:true,...result});
  } catch(e) {return NextResponse.json({error:String(e)},{status:409});}
}
export async function DELETE(req:NextRequest) {
  try {
    const body=await req.json();
    if(body.confirmed!==true||typeof body.id!=="string"||typeof body.missingAt!=="string") return NextResponse.json({error:"Cần xác nhận địa điểm muốn xoá"},{status:400});
    await dropRemovedCartrackClient(body.id,body.missingAt);
    await invalidateConfigCache();
    return NextResponse.json({ok:true});
  } catch(e) {return NextResponse.json({error:String(e)},{status:409});}
}
