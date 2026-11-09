export function runMisaSync(options: {
  creds:{username?:string,password?:string,totpSecret?:string,generateTotp:()=>string};
  chromium:unknown;launchOptions?:{args:string[],executablePath:string};month?:string;flags?:string[];
  statePath?:string;outDir?:string;writeDump?:boolean;
  leaveOnFile?:()=>Promise<(sub:any)=>boolean>;
}):Promise<{shiftRows:number;leave:unknown;gaps:number;unlinked:number;unresolvedPt:number}|undefined>;
