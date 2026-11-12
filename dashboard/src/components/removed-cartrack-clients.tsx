"use client";
import { useEffect,useState } from "react";
import { toast } from "sonner";
import { AlertTriangle,ArrowRightLeft,Ban,RefreshCw,Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import type { RemovedClient } from "@/lib/master-removed-clients";

export function RemovedCartrackClients({refreshKey,onDeleted}:{refreshKey:number;onDeleted:()=>Promise<void>}) {
  const [rows,setRows]=useState<RemovedClient[]>([]);
  const [checks,setChecks]=useState<Record<string,Record<string,number>>>({});
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");
  useEffect(()=>{
    let live=true;
    fetch("/api/master-client-info/removed",{cache:"no-store"}).then(async res=>{
      const data=await res.json();if(!res.ok) throw new Error(data.error||`HTTP ${res.status}`);
      if(live){setRows(data.rows);setChecks({});setError("");}
    }).catch(e=>{if(live)setError(`Không tải được danh sách địa điểm thiếu trên Cartrack: ${String(e)}`);});
    return ()=>{live=false;};
  },[refreshKey]);
  const check=async(id:string)=>{
    setBusy(id);
    try{const res=await fetch(`/api/master-client-info/removed?id=${id}`,{cache:"no-store"});const data=await res.json();if(!res.ok)throw new Error(data.error);setChecks(old=>({...old,[id]:data.references}));}
    catch(e){toast.error(String(e));}finally{setBusy("");}
  };
  const drop=async(row:RemovedClient)=>{
    if(!window.confirm(`Xoá vĩnh viễn ${row.customer_name} khỏi Supabase?\n${row.customer_id}\nChỉ xoá nếu vẫn không có tham chiếu. Cartrack và Labcenter không bị thay đổi.`))return;
    setBusy(row.customer_id);
    try{const res=await fetch("/api/master-client-info/removed",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:row.customer_id,missingAt:row.cartrack_missing_at,confirmed:true})});const data=await res.json();if(!res.ok)throw new Error(data.error);setRows(old=>old.filter(r=>r.customer_id!==row.customer_id));toast.success("Đã xoá địa điểm không còn tham chiếu khỏi Supabase");await onDeleted();}
    catch(e){toast.error(String(e));}finally{setBusy("");}
  };
  const retire=async(row:RemovedClient,to?:RemovedClient["replacement"])=>{
    const what=to
      ? `Chuyển ${row.active_rules} config của ${row.customer_name}\n${row.customer_id}\nsang địa điểm mới cùng tên\n${to.customer_id}?\nTài xế, giờ, khu vực và điểm giao giữ nguyên; config trống của địa điểm mới sẽ tắt. Địa điểm cũ được đánh dấu {inactive}.`
      : `Tắt ${row.active_rules} config của ${row.customer_name}\n${row.customer_id}\nvà đánh dấu {inactive}? Lịch sử config vẫn được giữ.`;
    if(!window.confirm(what))return;
    setBusy(row.customer_id);
    try{const res=await fetch("/api/master-client-info/removed",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:row.customer_id,missingAt:row.cartrack_missing_at,to:to?.customer_id,confirmed:true})});const data=await res.json();if(!res.ok)throw new Error(data.error);setRows(old=>old.filter(r=>r.customer_id!==row.customer_id));toast.success(to?`Đã chuyển ${data.moved} config sang địa điểm mới`:`Đã tắt ${data.switched_off} config`);await onDeleted();}
    catch(e){toast.error(String(e));}finally{setBusy("");}
  };
  if(error)return <p role="alert" className="text-xs text-amber-800">{error}</p>;
  if(!rows.length)return null;
  return <details className="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
    <summary className="cursor-pointer font-semibold"><AlertTriangle aria-hidden="true" className="mr-2 inline size-4" />{rows.length} địa điểm không còn trong danh sách Cartrack · Kiểm tra trước khi xoá</summary>
    <p className="mt-2 leading-5">Supabase đang giữ các địa điểm này. Chuyển config sang địa điểm mới cùng tên (nếu Cartrack đã tạo lại), hoặc tắt config; địa điểm cũ được đánh dấu {"{inactive}"} và rời khỏi danh sách. Chỉ xoá hẳn khi không còn tham chiếu nào.</p>
    <ul className="mt-2 max-h-64 overflow-y-auto divide-y divide-amber-200">{rows.map(row=>{
      const refs=checks[row.customer_id],blocked=refs&&Object.keys(refs).length>0;
      return <li key={row.customer_id} className="flex flex-col items-start gap-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full min-w-0 sm:flex-1"><p className="font-medium">{row.customer_name}</p><p className="mt-0.5 break-all text-[11px] text-amber-800">{row.customer_id}</p><p className="mt-1">{row.active_rules?`${row.active_rules} config đang dùng địa điểm này`:"Không còn config đang dùng"}{row.replacement&&<> · Địa điểm mới cùng tên: <span className="break-all">{row.replacement.customer_id}</span></>}</p>{refs&&<p className="mt-1">{blocked?`Giữ lại: ${Object.entries(refs).map(([name,count])=>`${name} (${count})`).join(" · ")}`:"Không có tham chiếu; có thể yêu cầu xoá."}</p>}</div>
        <div className="flex flex-wrap gap-2">
        {row.replacement&&row.active_rules>0&&<Button size="sm" variant="outline" disabled={!!busy} onClick={()=>void retire(row,row.replacement)}><ArrowRightLeft className="size-3.5" />Chuyển config sang địa điểm mới</Button>}
        <Button size="sm" variant="outline" disabled={!!busy} onClick={()=>void retire(row)}><Ban className="size-3.5" />{row.active_rules?`Tắt ${row.active_rules} config`:"Ngừng dùng"}</Button>
        <Button size="sm" variant="outline" disabled={!!busy} onClick={()=>void check(row.customer_id)}><RefreshCw className={`size-3.5 ${busy===row.customer_id?"animate-spin":""}`} />Kiểm tra</Button>
        {refs&&!blocked&&<Button size="sm" variant="outline" className="text-red-700" disabled={!!busy} onClick={()=>void drop(row)}><Trash2 className="size-3.5" />Xoá khỏi Supabase</Button>}</div>
      </li>;
    })}</ul>
  </details>;
}
