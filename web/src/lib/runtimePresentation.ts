import type { RuntimeThread } from './runtime';

// UI copy is a projection of loaded facts, never an alternative Run state.
export function taskPresentation(thread: RuntimeThread) {
  const run=thread.run;
  const unknown=thread.status==='UNKNOWN' || run?.inspection.observations.includes('EXECUTION_RESULT_UNKNOWN')
    || thread.supervision?.outcomeUnresolved;
  if(unknown) return {label:'执行结果不确定',message:run?'尚不能确认调用结果。请查看文件观察与证据；不会自动重试。':'执行状态未能确认。请查看证据；不会自动重试。',tone:'warning' as const};
  if(run?.inspection.traceConsistent===false) return {label:'执行证据需要检查',message:'记录之间存在不一致，暂不能确认任务结果。',tone:'warning' as const};
  const events=run?.events??[];
  const validation=events.filter(e=>e.type==='VALIDATION_PASSED'||e.type==='VALIDATION_FAILED').at(-1);
  const terminal=events.filter(e=>e.type==='RUN_COMPLETED'||e.type==='RUN_FAILED');
  const completed=terminal.length===1&&terminal[0].type==='RUN_COMPLETED'?terminal[0]:null;
  const historyComplete=!!run&&events.length===run.eventCount&&events.every((event,index)=>event.seq===index+1);
  const supervisionConsistent=!thread.supervision||(thread.supervision.coreTerminalObserved
    &&thread.supervision.pendingIntentCount===0);
  if(run?.status==='COMPLETED' && run.endedAt && run.inspection.traceConsistent===true && !run.eventsTruncated
      &&historyComplete&&run.inspection.pendingInvocations.length===0&&supervisionConsistent
      &&validation?.type==='VALIDATION_PASSED'&&completed&&validation.seq<completed.seq
      &&completed.seq===events.at(-1)?.seq&&completed.timestamp===run.endedAt)
    return {label:'任务完成',message:'任务已完成，独立验收通过。',tone:'success' as const};
  if(validation?.type==='VALIDATION_FAILED') return {label:'验收未通过',message:'已记录的结果未满足验收条件。可以查看具体操作和证据。',tone:'error' as const};
  if(thread.status==='FAILED'&&!run&&thread.proposal?.approvedPlanSha256) return {label:'执行未开始',message:'执行前检查未通过，没有启动文件工具。请查看任务详情。',tone:'error' as const};
  if(thread.status==='FAILED'||run?.status==='FAILED') return {label:'任务未完成',message:run?'执行记录包含失败。请查看操作详情；不会自动重试。':'未能生成可执行操作，没有启动文件工具。请检查模型连接或任务要求。',tone:'error' as const};
  if(thread.status==='FINISHED') return {label:'尚无法确认验收结果',message:'任务处理已结束，但已加载的证据尚不足以确认验收通过。',tone:'warning' as const};
  if(thread.status==='AWAITING_APPROVAL'&&thread.readPolicy?.autoApprovalPending) return {label:'正在核对读取授权',message:'',tone:'neutral' as const};
  const labels={QUEUED:'正在等待模型',PLANNING:'正在生成待执行操作',AWAITING_APPROVAL:'等待批准',DISPATCH_RESERVED:'正在启动执行',EXECUTING:'执行中'};
  return {label:labels[thread.status as keyof typeof labels]??'等待执行结果',message:'',tone:'neutral' as const};
}

export const toolLabels:Record<string,string>={read_file:'读取',write_file:'写入',patch_file:'修改',run_tests:'运行测试'};
