// One capture attempt, with bounded diagnostics. Never retain native error text.
const fail=(code,stage)=>Object.assign(new Error(code),{code,diagnostic:{stage}});
const nativeCode=error=>{
  const message=String(error?.message??'');
  if(/activeTab|all_urls|permission|access.*denied/i.test(message))return 'EDGE_SCREENSHOT_PERMISSION_REQUIRED';
  if(/MAX_CAPTURE|quota|too many|rate limit/i.test(message))return 'EDGE_SCREENSHOT_RATE_LIMITED';
  if(/window.*(?:closed|not found|invalid)|No window/i.test(message))return 'EDGE_SCREENSHOT_WINDOW_UNAVAILABLE';
  return 'EDGE_SCREENSHOT_CAPTURE_FAILED';
};

export async function captureBoundTab(tabs,binding,metadata,matching) {
  let stage='before_identity';
  try {
    const before=await metadata(binding?.tabId);
    matching(before,binding);
    stage='before_active_tab';
    const active=await tabs.query({windowId:before.windowId,active:true});
    if(active.length!==1||active[0].id!==binding.tabId)throw fail('EDGE_SCREENSHOT_REQUIRES_ACTIVE_TAB',stage);
    stage='capture';
    const image=await tabs.captureVisibleTab(before.windowId,{format:'jpeg',quality:35});
    stage='image_validation';
    if(typeof image!=='string'||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image))throw fail('EDGE_SCREENSHOT_INVALID_DATA',stage);
    if(image.length>300000)throw fail('EDGE_SCREENSHOT_TOO_LARGE',stage);
    stage='after_identity';
    matching(await metadata(binding.tabId),binding);
    stage='after_active_tab';
    const after=await tabs.query({windowId:before.windowId,active:true});
    if(after.length!==1||after[0].id!==binding.tabId)throw fail('EDGE_SCREENSHOT_REQUIRES_ACTIVE_TAB',stage);
    return {...before,image,source:'EDGE_VISIBLE_TAB_CAPTURE'};
  } catch(error) {
    if(typeof error?.code==='string'&&/^EDGE_[A-Z_]+$/.test(error.code))throw fail(error.code,stage);
    throw fail(stage==='capture'?nativeCode(error):'EDGE_SCREENSHOT_IDENTITY_UNCONFIRMED',stage);
  }
}
