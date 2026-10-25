import {runtimeApi} from './runtime';

// Called at module evaluation, before React effects, font loading or API reads.
export function consumeLaunchFragment(url:URL,history:Pick<History,'replaceState'>):string|null {
  const fragment=url.hash.slice(1);
  const query=fragment.indexOf('?');
  if(query<0)return null;
  const params=new URLSearchParams(fragment.slice(query+1));
  if(!params.has('launch'))return null;
  // Clean malformed capabilities too. A fragment never becomes an HTTP query.
  history.replaceState(null,'',url.pathname+'#/runtime');
  const values=params.getAll('launch');
  return url.protocol==='http:'&&url.hostname==='127.0.0.1'&&!!url.port
    &&fragment.slice(0,query)==='/runtime'&&values.length===1&&/^[A-Za-z0-9_-]{40,128}$/.test(values[0])
    ?values[0]:null;
}

export function createLaunchHandoff(capability:string|null,exchange:(value:string)=>Promise<unknown>) {
  let pending:Promise<boolean>|undefined;
  return ()=>{
    if(!pending){
      const value=capability;capability=null;
      // This shared request owns its timeout and survives StrictMode cleanup.
      pending=value?Promise.resolve().then(()=>exchange(value)).then(()=>true,()=>false):Promise.resolve(true);
    }
    return pending;
  };
}

export const completeLaunchHandoff=createLaunchHandoff(
  consumeLaunchFragment(new URL(window.location.href),window.history),
  value=>runtimeApi.launchSession(value),
);
