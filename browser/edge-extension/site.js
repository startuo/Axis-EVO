// Classify browser failures without leaking native messages or URLs.
export async function boundedDocumentRead(read,timeoutMs=6000) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(read),new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(Object.assign(new Error('EDGE_DOCUMENT_TIMEOUT'),{code:'EDGE_DOCUMENT_TIMEOUT'})),timeoutMs);
    })]);
  } finally {clearTimeout(timer);}
}

export function injectionCode(error) {
  if(error?.code==='EDGE_DOCUMENT_TIMEOUT')return error.code;
  const message=String(error?.message??'');
  if(/Cannot access (?:contents|a chrome|an edge)|Missing host permission|must request permission|permission.*(?:denied|required)|cannot be scripted/i.test(message))return 'EDGE_SITE_PERMISSION_REQUIRED';
  if(/(?:could not|cannot|failed to) load file|no such file|file not found/i.test(message))return 'EDGE_CONTENT_SCRIPT_UNAVAILABLE';
  if(/(?:another|already attached).*debugger|debugger.*(?:attached|conflict)/i.test(message))return 'EDGE_DEBUGGER_CONFLICT';
  if(/context invalidated|extension.*(?:reload|updated)/i.test(message))return 'EDGE_EXTENSION_UPDATED';
  return 'EDGE_SCRIPT_INJECTION_FAILED';
}
