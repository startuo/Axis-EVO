import {useState} from 'react';
import {ArrowDown,ArrowUp,ExternalLink,Globe2,Link2,MousePointer2,RefreshCw,Unplug} from 'lucide-react';
import type {EdgeBrowserController} from '../../hooks/useEdgeBrowser';

const actionLabels:Record<string,string>={click:'点击',type:'输入',select:'选择',scroll:'滚动',read:'读取页面',snapshot:'观察页面',screenshot:'页面截图',bind:'关联标签页',tabs:'获取标签页',focus:'打开标签页'};
export function EdgeBrowserPanel({edge,onAttach}:{edge:EdgeBrowserController;onAttach?:()=>void}) {
  const [ref,setRef]=useState('');
  const [action,setAction]=useState('click');
  const [text,setText]=useState('');
  const observation=edge.operation?.result?.data;
  const page=edge.snapshot;
  const snapshot=page?.snapshot??'';
  const refs=[...snapshot.matchAll(/^\[(e\d+)\]\s+(\S+)\s+"([^"]*)"/gm)].map(match=>({id:match[1],role:match[2],name:match[3]}));
  const selected=refs.find(item=>item.id===ref);
  const proposalTarget=refs.find(item=>item.id===edge.proposal?.request.params.ref)?.name;
  const busy=!!edge.busy;
  const boundInstance=edge.status?.instances.find(instance=>instance.id===edge.binding?.instanceId);
  const selectedInstance=edge.status?.instances.find(instance=>instance.id===(edge.binding?.instanceId||edge.instanceId));
  const connected=selectedInstance?selectedInstance.connected:!edge.instanceId&&edge.status?.instances.some(instance=>instance.connected);
  return <div className="next-edge-panel">
    <div className="next-panel-intro"><Globe2 size={21}/><div><h2>Microsoft Edge</h2><p>{edge.binding?.active?`${boundInstance?.label??'Microsoft Edge'} · ${edge.binding.instanceId.slice(-8)}`:'使用你的浏览器，保留登录状态'}</p></div><span className={`next-connection-dot ${connected?'online':''}`} aria-label={connected?'扩展在线':'扩展未连接'}/></div>
    {edge.error&&<div className="next-inline-notice" role="alert">{edge.error}</div>}
    {edge.busy&&<p className="next-live-state" role="status"><span className="next-state-orbit"/>{edge.busy}</p>}
    <>
      {!edge.status?.instances.length&&<div className="next-edge-start"><h3>等待 Edge 自动连接</h3><p>扩展启用后会自动连接本机工作台。连接后直接选择要处理的标签页。</p><button className="button primary" disabled={busy} onClick={()=>void edge.connect()}><Link2 size={15}/>连接 Microsoft Edge</button></div>}
      {!!edge.status?.instances.length&&<section className="next-edge-chooser"><details open={!edge.binding?.active}><summary>{edge.binding?.active?'选择其他标签页':'选择要处理的标签页'}</summary><div className="next-edge-chooser-content"><label className="field-label">Microsoft Edge 实例<select aria-label="Edge 实例" value={edge.instanceId} disabled={busy} onChange={event=>void edge.loadTabs(event.target.value)}><option value="">选择一个实例</option>{edge.status?.instances.map(instance=><option key={instance.id} value={instance.id} disabled={!instance.connected}>{instance.label} · {instance.id.slice(-8)}{instance.connected?'':' · 离线'}</option>)}</select></label>{edge.instanceId&&<button className="text-button" disabled={busy} onClick={()=>void edge.loadTabs(edge.instanceId)}><RefreshCw size={13}/>刷新标签页</button>}<div className="next-edge-tab-list">{edge.tabs.map(tab=><button key={tab.id} disabled={busy} className={edge.binding?.tabId===tab.id?'selected':''} onClick={()=>void edge.selectTab(tab.id)}><Globe2 size={15}/><span><strong>{tab.title||'未命名页面'}</strong><small>{tab.url}</small></span><span className="next-tab-number">#{tab.id}</span></button>)}</div></div></details></section>}
      {edge.binding&&<section className="next-bound-page"><div className="next-section-heading"><h3>{edge.binding.title||'已选择页面'}</h3><span className="next-eyebrow">标签页 #{edge.binding.tabId}</span></div><p className="next-page-url">{edge.binding.url}</p>{edge.binding.active?<><div className="next-panel-actions"><button className="button secondary" disabled={busy} onClick={()=>void edge.observe('read')}><RefreshCw size={14}/>读取页面</button><button className="button secondary" disabled={busy} onClick={()=>void edge.observe('focus')}><ExternalLink size={14}/>在 Edge 打开</button><button className="text-button" disabled={busy} onClick={()=>void edge.observe('screenshot')}>获取真实预览</button></div><p className="next-preview-hint">预览会切换到已关联的原标签页，仅截取可见区域。</p>{onAttach&&<button className="button primary next-attach-page" disabled={busy} onClick={onAttach}><Link2 size={14}/>用于当前对话</button>}</>:<p className="next-inline-notice">已交还控制或页面身份已变化。继续前请重新选择标签页。</p>}
      {observation?.image&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(observation.image)&&<figure className="next-browser-preview"><img src={observation.image} alt="已绑定 Edge 标签页的真实截图"/><figcaption>Edge 可见标签页截图 · 获取时的页面状态</figcaption></figure>}
      {page&&<p className="next-page-observed" role="status">已取得页面快照 · 操作后使用新快照继续，逐次审批</p>}
      {page?.text&&<details className="next-source-preview"><summary>查看本次读取的页面正文</summary><pre>{page.text}</pre></details>}
      {!!refs.length&&edge.binding.active&&<details className="next-controlled-actions"><summary><MousePointer2 size={14}/>受控网页操作</summary><p>操作绑定当前页面快照；提交、删除、发布与支付交给你在 Edge 中完成。</p><label className="field-label">目标元素<select aria-label="网页目标元素" value={ref} onChange={event=>setRef(event.target.value)}><option value="">从快照中选择</option>{refs.map(item=><option key={item.id} value={item.id}>{item.name||item.role} · {item.id}</option>)}</select></label><label className="field-label">操作<select aria-label="网页操作类型" value={action} onChange={event=>setAction(event.target.value)}><option value="click">点击</option><option value="type">输入文本</option><option value="select">选择选项</option></select></label>{action!=='click'&&<label className="field-label">{action==='type'?'输入内容':'选项值'}<input value={text} maxLength={action==='type'?2000:256} onChange={event=>setText(event.target.value)}/></label>}<button className="button secondary" disabled={busy||!selected} onClick={()=>void edge.prepareAction(action,{ref,...(action==='type'?{text}:action==='select'?{value:text}:{})})}>查看待执行操作</button><div className="next-panel-actions"><button className="text-button" disabled={busy} onClick={()=>void edge.prepareAction('scroll',{direction:'up'})}><ArrowUp size={13}/>向上滚动</button><button className="text-button" disabled={busy} onClick={()=>void edge.prepareAction('scroll',{direction:'down'})}><ArrowDown size={13}/>向下滚动</button></div></details>}
      {edge.proposal&&<section className="next-action-approval" aria-label="网页操作审批">
        <span className="next-eyebrow">等待你的批准</span>
        <h3>{actionLabels[edge.proposal.request.action]} {proposalTarget??String(edge.proposal.request.params.ref??(edge.proposal.request.params.direction==='up'?'当前页面（向上）':'当前页面（向下）'))}</h3>
        <p>{edge.proposal.request.binding.title} · {edge.proposal.request.binding.url}</p>
        {(edge.proposal.request.params.text!==undefined||edge.proposal.request.params.value!==undefined)&&<pre>{String(edge.proposal.request.params.text??edge.proposal.request.params.value)}</pre>}
        <p>仅执行当前标签页、当前快照上的这一次操作。回执不等于业务成功。</p>
        <button className="button primary" disabled={busy} onClick={()=>void edge.approve()}>批准这次操作</button>
        <details><summary>精确批准摘要</summary><code>{edge.proposal.approvalSha256}</code></details>
      </section>}
      {edge.binding.active&&<button className="text-button next-handoff" disabled={busy} onClick={()=>void edge.handoff()}><Unplug size={14}/>由我接管这个页面</button>}
      </section>}
      {!!edge.status?.instances.length&&<button className="text-button" disabled={busy} onClick={()=>void edge.connect()}>刷新 Edge 连接</button>}
    </>
    {edge.operation&&<details className="next-browser-evidence"><summary>浏览器执行证据</summary><dl><div><dt>操作</dt><dd>{actionLabels[edge.operation.action]??edge.operation.action}</dd></div><div><dt>记录状态</dt><dd>{edge.operation.state}</dd></div>{edge.operation.result?.error&&<><div><dt>回执代码</dt><dd>{edge.operation.result.error.code}</dd></div>{edge.operation.result.error.diagnostic&&<div><dt>截图失败阶段</dt><dd>{edge.operation.result.error.diagnostic.stage}</dd></div>}</>}<div><dt>实例</dt><dd>{edge.operation.instanceId}</dd></div><div><dt>操作身份</dt><dd>{edge.operation.id}</dd></div></dl><ol>{edge.operation.facts.map(fact=><li key={fact.seq}><strong>{fact.kind}</strong><time>{fact.createdAt}</time></li>)}</ol><p>派发、扩展回执和页面观察分别记录。模型文本不能替代这些事实。</p></details>}
  </div>;
}
