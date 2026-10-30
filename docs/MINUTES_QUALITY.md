# 会议纪要独立质量审定 v1

2026-10-31，Stage 2D；产品仍为 **0.1.0 Preview**。这是可审计的离线审定流程，不是自动语义分类器，也不接入历史 Core Acceptance、Gate 或晋升。Stage 2B/2C 的输入、Oracle、S0/S1、分母与评价原件不变。

## 四类证据

| 证据层 | 本实现做什么 | 不能证明什么 |
|---|---|---|
| 确定性产物观察 | 检查两个输入字节保留、输出集合仅增加 minutes.md、非空 UTF-8、无 NUL；绑定文件摘要 | 不证明实际 Runner 执行、Markdown 十二节语义或内容正确 |
| 业务事实审阅 | 固定来源、逐项义务和精确引用，接收归属明确的 PASS/FAIL/MISSING/UNKNOWN | 引用位置正确不代表推理正确，审阅可能遗漏或误判 |
| 主观评价 | 保留 readability/usefulness 0–3 的单独审阅值 | 不作人工真值，不与事实错误加权求总分 |
| 不足或争议 | 无审阅、缺少真值审定、全篇审阅未完成、相互冲突分别保留 | 不把未知计为通过，不用后来的有利审阅覆盖原来的失败 |

原 Core Oracle 是源文件保留判定，公开 Acceptance 是输出存在判定。额外产物形状检查已能发现空文件，但并未改变旧 Gate 的输入指标。新的 `inspect_artifact` 让这些诊断成为独立质量报告的硬性失败；旧 Gate eligible 仍只表示满足原政策。

## 固定标准与来源

`axis_evo.minutes_quality.prepare_reference(case_id, initial_files, criteria)` 只接收 `meeting.md`、`organization-policy.md` 和候选生成前拟定的标准，不接收输出。每项有固定 `id`、`dimension`、`critical`、`obligation`、`source_spans`。

七个检查范围为 ACTION_RECALL、OWNER、DEADLINE、DECISION_STATUS、BUSINESS_FACT、UNCERTAINTY、POLICY。当前实现针对这些范围均适用的 Pilot 任务；无适用项的全新任务域须先另行制定有来源的“无此类事实”检查或协议版本，不能根据候选表现临时删除维度。

一个 criterion 是一次预先声明的检查义务，不等于一行文本或一次模型调用。`dimensions` 的 denominator 是该维度固定检查义务数，**不是历史行动召回率，也不是标准化的通用质量分数**。研究原始标注须分别列出 `committed/<action-id>/...`、`followup/<action-id>/...`，计算已承诺行动召回与必要跟进覆盖时分别取固定 ID 集合；不要合并二者，也不要用多个 owner/date 检查重复增加行动分母。匹配是逐行动一对一，重复提及不增加命中。

引用字段为 `{path, start, end, quote}`，采用 Unicode codepoint 半开区间，源码和输出都核对实际文本。源引用需要保留条件、否定、范围、未知和组织要求，不能只摘支持结论的几个字。日期检查要明确适用字段、原语和允许的换算方式；不同位置矛盾另列问题。

`MinutesReference` 保存 canonical bytes，属性读取返回副本。评估时必须另传 `expected_reference_sha256`，所有输入、义务和源证据变化都会使摘要不匹配。**摘要不是签名或访问控制**：独立保管、时间顺序和候选不可见性仍需外部只追加记录与访问边界；同一操作者完全可以重新生成另一个 reference，库本身无法证明“事前冻结”。

参考标注由 LLM 准备时，人工状态保持 PENDING。`reference_review` 只接收独立保管的人类审定记录的声明和摘要；不认证人员身份或记录真实性。本轮没有真实人类审定，不填这个字段。

## 审阅与输出

`evaluate_minutes` 接收相同输入、最终文件、固定 reference、候选作者声明及独立审阅。每份审阅绑定 reference/output SHA，声明 reviewer_id、kind（HUMAN/LLM/SYNTHETIC_TEST）、context_id、candidate_author。

每个固定 criterion 必须出现一次，不允许漏项、重复或候选新增标准。PASS 必须有可定位输出；MISSING 不伪造引用；UNKNOWN 保留原因。全篇 unsupported_claims 审计独立于有限清单，防止“正确关键词全部出现，但别处又虚构负责人”被漏掉。该审计必须真正阅读全文，不能靠库自动补 CLEAR。所有其他未支持命题、同义变体、注入指令和跨段矛盾都在这里处理。

| disposition | 含义 |
|---|---|
| INVALID_ARTIFACT | 确定性文件诊断失败 |
| REPORTED_MAJOR_FAILURE | 审阅报告至少一个关键失败或重大无依据断言；证据等级仍取决于审阅来源 |
| REPORTED_CRITERIA_FAILURE | 报告非关键标准失败或其他问题 |
| DISPUTED | 审阅对同一义务不一致；该项 UNKNOWN，原失败记录仍保留 |
| INSUFFICIENT_EVIDENCE | 没有足够审阅或全篇审计未完成 |
| PROVISIONAL_NO_FAILURE_REPORTED | 暂未报告失败，但缺人工参考审定或审阅仅为 LLM/合成资料 |
| HUMAN_SUPPORTED_FOR_DECISION | 参考有独立人类审定声明，全部审阅声明为 HUMAN，所有义务通过、全篇审计清楚；仍需外部验证声明及授权 |

所有报告始终为 `quality_improved=NOT_INFERRED`、`adoption_authorized=false`、`historical_gate=NOT_CHANGED`。单份输出的质量审定不证明相对提升，更不能自动采用版本。报告包含完整来源、所有审阅、逐维分母、争议、评价器 ID 与实际源码 SHA、完整报告 SHA。它可能包含私人材料，未经脱敏不能公开。

## 实际可运行与限制

安装项目后运行：

```powershell
python -m pip install -e .
python -m examples.minutes_quality_demo
```

未安装时可在当前 shell 显式使用 `$env:PYTHONPATH=(Resolve-Path src).Path`。示例包含忠实样本、空输出、行动遗漏、补负责人、错/漏日期、丢失“前”、建议变决议、金额失真、抹掉不确定性、违反草稿规则，以及关键词齐全但额外虚构的反例。语义标注是预先给定的合成测试资料，结果证明审定逻辑处理这些证据，**不代表对自然输出的自动检出率**。

本轮另有反证：把每项 PASS 的引用都换成正确存在的“草稿，待审核”，证据位置校验会通过，仍只能得到暂定状态。这说明坏的审阅能骗过语义层；本实现诚实保留该边界，不能宣称仅凭 hash、引用或换一个 LLM 就获得独立真值。

最值得继续投入的是：由未参与候选生成的人类确认原子参考、独立标注封闭挑战集并复核实际输出，以盲态测量错误接受/拒绝及人时成本。当前没有这个测量。新模型调用、数据与预算批准见 [下一轮协议](STAGE2D_RESEARCH_PROTOCOL.md)。
