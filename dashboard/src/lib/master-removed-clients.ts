import { BASE_URL, getHeaders } from "./cartrack";
import { sbRpc, sbSelectAll } from "./supabase-rest";
import { loadTplEntries } from "./psc-config";
import { PSC_ROUTES } from "./psc-routes-data";
import { UUID } from "./master-reconcile";

export type RemovedClient = {customer_id:string;customer_name:string;cartrack_missing_at:string;
  /** Active config rules naming it as pickup, drop-off match or alternate drop-off. */
  active_rules:number;
  /** The one live Cartrack location with exactly the same name — a re-created location. */
  replacement:{customer_id:string;customer_name:string}|null};
type ClientRow={customer_id:string;customer_name:string;cartrack_missing_at:string|null;is_active:boolean};
/** Missing locations not yet retired (retiring marks them {inactive}). */
export async function removedCartrackClients():Promise<RemovedClient[]> {
  const clients=await sbSelectAll<ClientRow>("master_clients","select=customer_id,customer_name,cartrack_missing_at,is_active","customer_id.asc");
  const missing=clients.filter(c=>c.cartrack_missing_at && c.is_active);
  if(!missing.length) return [];
  const ids=missing.map(c=>c.customer_id).join(",");
  const rules=await sbSelectAll<{id:number;pickup_customer_id:string|null;dropoff_customer_id:string|null;alternate_dropoff_customer_id:string|null}>("master_config_rules",
    `select=id,pickup_customer_id,dropoff_customer_id,alternate_dropoff_customer_id&active=eq.true&or=(pickup_customer_id.in.(${ids}),dropoff_customer_id.in.(${ids}),alternate_dropoff_customer_id.in.(${ids}))`,"id.asc");
  return missing.map(c=>{
    const same=clients.filter(o=>o.customer_id!==c.customer_id && o.is_active && !o.cartrack_missing_at && o.customer_name.trim()===c.customer_name.trim());
    return {customer_id:c.customer_id,customer_name:c.customer_name,cartrack_missing_at:c.cartrack_missing_at!,
      active_rules:rules.filter(r=>[r.pickup_customer_id,r.dropoff_customer_id,r.alternate_dropoff_customer_id].includes(c.customer_id)).length,
      replacement:same.length===1 ? {customer_id:same[0].customer_id,customer_name:same[0].customer_name} : null};
  });
}
/** Moves every active rule onto `to`, or switches them off when `to` is absent; then marks the location {inactive}. */
export async function retireRemovedCartrackClient(id:string,missingAt:string,to?:string) {
  if(!UUID.test(id)||(to!==undefined&&!UUID.test(to))||!Number.isFinite(Date.parse(missingAt))) throw new Error("Địa điểm hoặc phiên bản không hợp lệ");
  return sbRpc<{moved:number;switched_off:number}>("master_retire_missing_client",{p_id:id,expected_missing_at:missingAt,p_to:to??null});
}
export async function removedClientReferences(id:string) {
  if(!UUID.test(id)) throw new Error("Mã địa điểm không hợp lệ");
  const [references,tpl]=await Promise.all([
    sbRpc<Record<string,number>>("master_client_references",{p_id:id}),
    loadTplEntries(),
  ]);
  const contains=(value:unknown):boolean=>JSON.stringify(value).includes(id);
  const tplCount=tpl.filter(contains).length,pscCount=PSC_ROUTES.filter(contains).length;
  if(tplCount) references["3PL (Supabase)"]=tplCount;
  if(pscCount) references["PSC routes"]=pscCount;
  return references;
}
export async function dropRemovedCartrackClient(id:string,missingAt:string) {
  if(!UUID.test(id)||!missingAt||!Number.isFinite(Date.parse(missingAt))) throw new Error("Địa điểm hoặc phiên bản không hợp lệ");
  const response=await fetch(`${BASE_URL}/customers/${id}`,{headers:getHeaders(),cache:"no-store"});
  const body=response.status===422 ? await response.json().catch(()=>null) : null;
  const missing=response.status===404||response.status===410||(response.status===422&&body?.error?.code===422&&body?.error?.data?.customer_id?.includes("The selected customer_id is invalid."));
  if(!missing) throw new Error(response.ok ? "Địa điểm còn tồn tại trên Cartrack; đồng bộ lại trước khi xoá" : `Không xác minh được Cartrack (HTTP ${response.status}); chưa xoá`);
  const references=await removedClientReferences(id);
  if(Object.keys(references).length) throw new Error(`Không thể xoá: còn tham chiếu ${JSON.stringify(references)}`);
  await sbRpc("master_drop_removed_client",{p_id:id,expected_missing_at:missingAt});
}
