# Meeting Minutes 探索性预实验协议 v2

2026-10-28，在任何 baseline 评分或外部调用前修订。初始工程提交 `a1532ed8fb5063602969c948cfa6c931ff66a342`；产品仍为 `0.1.0 Preview`。本协议只准备虚构组织的探索性试验，正式 Holdout 为 NOT_FROZEN_NOT_RUN，论文主实验为 NOT_STARTED。

## 两套 Skill 身份

上游来源为 GitHub awesome-copilot 的 `skills/meeting-minutes/SKILL.md`，固定提交 `0fe6545b950671641b2b14b44eb56678fea6c6b4`；Git blob `63424b8be544169f9206b8ce9e9e6d4e67219f69`，SHA-256 `69420bbe78b2f6c81f9689672360dd97e71e9fc83045a70e3d6924f24973a789`，7894 bytes。原始文件、完整 MIT 许可与来源元数据原样保存在 `third_party/awesome_copilot/meeting_minutes/`。Raw 下载字节、GitHub Contents API 解码字节与 Git blob 哈希独立一致，目录在该提交只有 SKILL.md。未执行任何上游命令，未使用 Hermes 参考内容。

Axis-Evo 执行身份另为 `meeting-minutes.github-pilot@1`：固定 name/description 映射，去除 YAML frontmatter，完整保留后续 instructions 字节，仅准入 write_file。它的 Card 摘要与原文摘要分别计算，状态以实际 Core 记录为准，不能宣称是密码学相同的原始 Skill 或通用 SKILL.md 运行时。

`python -m examples.meeting_minutes_adaptation` 只输出准备对象、兼容矩阵与来源关联，不写库、不授予 TRUSTED、不调用模型。`sourceKind=MANUAL` 仅表示 Core 支持的外部人工准入来源类型；上游出处由独立 provenance JSON 固定，不篡改冻结 SkillCard schema。创建 untrusted CANDIDATE 不等于 S1，也不等于完成信任评价。S0 的研究源 TRUSTED 准入须单独审查；如使用既有 legacy CANDIDATE→SHADOW→TRUSTED 设置，明确标 LEGACY_RESEARCH_SETUP / TRUST_ASSESSMENT_NOT_PERFORMED，不冒称依据历史任务完成信任评估。

| 上游能力 | 兼容类别 | 本轮边界 |
|---|---|---|
| Intake 与最多三次追问 | SUPPORTED_WITH_FIXED_ADAPTER | 资料中预收集问题与答复；当前一次性 planner 不提供同等交互循环 |
| 会议元数据 | SUPPORTED_WITH_FIXED_ADAPTER | 仅有界文字，上游未知值规则保持；没有内容则标 TBD/Unknown |
| 十二节纪要、决策和行动项 | SUPPORTED | 完整保留文本指令；是否正确执行另行评价 |
| 未知负责人、日期及不确定性 | SUPPORTED | 不强迫填值；组织规则要求来源证据，不能据“应有 owner”虚构 |
| 审阅流程 | SUPPORTED_WITH_FIXED_ADAPTER | 生成本地草稿，再作单独 LLM 审阅；不自动联系主持人 |
| 发布、邮件、外部 ticket | UNSUPPORTED | 排除实际操作；保留原文但固定任务范围禁止执行 |
| Markdown 输出 | SUPPORTED_WITH_FIXED_ADAPTER | minutes.md，保留十二节语义，可双语标题；外层 Plan JSON 不是纪要格式 |
| 音频、录音、slides | NOT_APPLICABLE_TO_PILOT | 只有合成文字，无解析能力或集成声明 |
| 上游示例与模板 | NOT_APPLICABLE_TO_PILOT | 原样保留，不进入 pilot 数据或 Oracle |
| 通用包、脚本与动态资源 | UNSUPPORTED | 没有新增引擎、Shell、网络或权限 |

## 格式修订与固定适配器

撤回 v1 对本次试验的 JSON 纪要要求，输出固定为 UTF-8 `minutes.md`。实际 planner 仍按既有协议返回含 write_file 的 JSON Plan；文件正文是 Markdown。

Core 单次规划看不到前一步 read_file 的返回。因此以固定 `AXIS_MEETING_FILE_WRAPPER_V1` 将相同组织规则与会议原文放入 TaskSpec goal；seed 中同时保存 `organization-policy.md` 和 `meeting.md`。这不是通用检索或工具循环。适配器处于 TaskSpec goal 而不是可修订 instructions，S0/S1 输入、路径、工具集、包装器摘要和 Provider revision 必须相同。超出 8192 codepoints/32768 UTF-8 bytes 整条拒绝，不截取证据。

Intake 的问题与答复记录预先固定；无法取得的字段明确记未知及待补途径。不得在不同版本之间改变问题答复、额外透露答案或删掉困难信息。目标只有本地草稿，不发送、不发布、不自动创建任务。

## 三层证据与两个 Oracle

| 层 | 记录 | 能支持的结论 |
|---|---|---|
| A 执行可靠性 | 实际 Core Run、Plan 摘要批准、Intent/Result、独立 Acceptance、Inspector、Failure/UNKNOWN | 文件是否按批准计划生成，执行是否确认；不证明内容正确 |
| B 内容质量 | rubric、输出和输入摘要、行动项/owner/date/决策等逐项证据、评价者与盲态 | 有限质量观察及其分母；LLM 意见不是 Core 事实或人工客观真值 |
| C 演化治理 | 精确 Card、反馈 Run、候选血缘、完整 Trial census、Gate、单独晋升/激活 | 原治理能否接受/拒绝转换；不自动证明语义改善或泛化 |

现有 Shadow Oracle 强制非空 exact expected_files，不能评价开放文本同义结果。保留原 validator 和 Gate 语义：执行 Oracle 只对两个公共输入文件做 exact bytes 保留检查，公共 Acceptance 另要求 minutes.md 存在。为允许新生成纪要，forbid_extra_files=false；因此这一 Oracle 也不保证只产生一个输出，额外写入需在 Plan 审阅及单独输出检查中报告。它不携带 minutes.md 的唯一“标准答案”，不能被称为内容 Gate。

独立私有 `quality-reference.json` 保存行动项、明确 owner/date、未知值、决策/提议、业务状态、来源段落、可接受同义表达和重大虚构项。它不在 seed、TaskSpec、规划请求或修订 objective 中。由 LLM 准备的参考标注须另行审阅；未审阅部分标 PENDING，不伪装为人工 ground truth。用户本轮授权 LLM 审阅，仍分别记录作者/审阅者、上下文独立性、同模型局限、分歧和裁决；没有真实输出时不得填评分。

Development 通过原 Runner 执行的文件任务才产生实际 Run 与工具事件。既有 Shadow 与 Research Runner 在封闭内存文件模型中生成 Trial；将来即使它们使用真实 Provider，也只能标为“真实模型调用＋文件模拟 Trial”，不能算实际文件 Run、生产部署或独立业务效果。

质量指标按 v1 的固定 0–3 各维 rubric，新增明确的 decision/proposal、source traceability 与组织规则逐项核对。每项报命中数/真实分母、遗漏、虚构和 UNKNOWN；阅读性不能抵消重大事实错误。实际对比输出尽可能匿名随机排序并记录算法、种子与揭盲时间。LLM-only 与同模型复核的局限必须随结论一起报告。

由 LLM 打出的可读性、完整性、忠实度或实用性分数标为 LLM_RUBRIC_SCORE。原“人工实用性评价”在没有人类实际评价时仍为 PENDING，不用 LLM 分数填充该字段。三层结果分别保留；Core Gate eligible 而内容质量失败或未决时，不请求晋升，不能合并成一个“质量通过”。

### 内容评分规则（完整冻结口径）

计数单位为单个 case/version 的原文命题或行动项，不是行数、输出长度或 LLM 发言数。预先区分 COMMITTED（明确接受）、PENDING_ASSIGNMENT（明确需要但未分配）、ASSIGNED_REQUIRED_NOT_EXPLICITLY_ACCEPTED（点名所需工作但没有接受记录）、UNCOMMITTED_OFFER、WORKFLOW_REQUIREMENT。只把 COMMITTED 纳入“已承诺行动项召回”的分母；其余必要跟进事项另列覆盖率。不能事后把条件变好理解的项目挪进/挪出分母。

| 指标 | 固定分子/分母与缺失规则 |
|---|---|
| 十二节结构 | 每例必须覆盖上游 Metadata、Attendance、Agenda、Summary、Decisions、Action Items、Notes、Parking Lot、Risks、Next Meeting、References、Version Log 的十二个语义部分；允许中英双语同义标题。单例合规数 / 所有声明输出 slots；无输出单列 missing，并给最坏情况界限 |
| 已承诺行动项召回 | 一对一匹配到的 COMMITTED 项 / 冻结参考中的 COMMITTED 项。匹配需保留动作及关键对象、条件和时间/责任的不确定性；重复输出不重复命中，必要时分开两项，无法确定匹配记 UNKNOWN |
| 待确认事项覆盖 | 明确记录的 PENDING_ASSIGNMENT、ASSIGNED_REQUIRED_NOT_EXPLICITLY_ACCEPTED 和必要 workflow 跟进 / 原文对应参考项；不混入已承诺行动分母 |
| 负责人正确性 | 对每个已匹配行动项，按原文明确指派或规定 Unknown/TBD 判断一次；正确字段 / 全部匹配项。漏项由召回另报；未指派却补具体人名同时计重大虚构 |
| 日期正确性 | 正确保留承诺、范围、未知或冲突性质的 due 字段 / 全部匹配项。明天中午前等须保留原语及可确定的日期，不补时区或小时；希望日、最快估计不算承诺日。未知却编日同时计重大虚构 |
| 决策/提议区分 | 正确区分并忠实匹配的显式决策及未批准提议 / 冻结对应命题数。建议变决策、准备变完成、预测变承诺均计错；同一命题不因重复措辞增加分母 |
| 来源可追溯性 | 所引编号存在且实际支持陈述的关键决策、行动、blocker / 输出中全部此类陈述；另报“关键参考命题中有支持引用”的覆盖率，防止删内容缩小分母 |
| 组织规则遵循 | 逐条对 12 条组织规则记录 COMPLIANT / VIOLATED / UNKNOWN / NOT_APPLICABLE，给出证据；有效分母事先按源材料适用性冻结，UNKNOWN 留在有效分母并单列，不悄悄删去 |
| 无依据事实 | 每个不获原文支持又未标不确定的可核对事实命题计一项；owner/date/完成状态/批准/业务或个人断言分别标类别。重大虚构是任意具体责任/日期凭空补全、未批提议变批准、未完工作或业务改善写成已证明等实质变义，不用可读性抵消 |

没有可评分分母时标 NA 并报告原因，不填 100%。失败、missing、UNKNOWN 均保留在声明 slots census；只对完整配对给出 S0/S1 差异，并另列缺失及最坏情况界限。内容记录、结构诊断、Core Acceptance、模拟 Oracle 和 Gate 各有字段，不能相互填值。

0–3 rubric 单维原始分分别报告，不合并总分：

| 维度 | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| 完整性 | 大部关键信息缺失 | 多个关键遗漏 | 个别次要遗漏 | 关键命题、行动和未知项完整 |
| 可读性 | 难以理解 | 需大量重写 | 清晰但有少量冗余 | 清晰简洁且结构一致 |
| 实用性 LLM proxy | 无法用于跟进 | 需大量回查 | 小量修正后可用 | 可跟进，未确定事项明确 |
| 忠实度 | 严重虚构或颠倒结论 | 有重大无依据推断 | 小偏差且不改关键结论 | 忠于原文并保留不确定性 |

审阅者保留作者草案、独立上下文标注及分歧，逐项引用 source_refs。纯文字同义表达可按上述规则匹配；“需要”与“接受”、估计与承诺等有歧义时保留两种读法并计 UNKNOWN，不以两位 LLM 一致就宣布客观真值。准备作者只能提出逐段裁决建议，注明身份、依据、盲态和版本；未决项在任何输出可见前冻结为争议项，不能事后为某一版本择义。改动参考需追加新版本和父摘要，保留旧稿，不能覆盖。人工评价缺席一直明确标注。

`inspect_output_shape` 是独立只读的 minutes-artifact-shape-v1 诊断：检查新增路径是否只有 minutes.md、输入字节是否改变、输出是否非空 UTF-8；它不判断十二节的实际语义完整性，不推断 Core Acceptance，不给内容评分。实际 Plan 必须另行审阅只有批准的 write_file；不能从提示词要求推出已强制执行了同一规则。

### 解释边界与隔离登记

独立上下文审阅发现 dependency→handoff、未分配 owner、未批提议及“准备不等于完成”等答案逻辑跨分区共享，并且 14 例都使用 I1–I3/S01–S06 scaffold 和较强文字提示。因此这个固定语料只支持“相同组织政策下、强提示合成场景”的有界比较，不支持独立跨 family 泛化、真实企业长会议或通用附件能力结论。共享模板簇另在私有 partition-validity ledger 登记；案例数和相互相关性分别报告，不把标签唯一或低文字相似度当独立证据。

完整独立审阅 JSON 包含 Gate/Reuse 参考答案，严格留在私有审阅区。未来 revision request 只能带真实 Development Run、Assessment 及 Development-only 反馈投影，不能把全分区审阅记录、Gate/Reuse 例子或可还原答案的摘要贴入目标。操作人看到全分区的事实需登记；这是过程隔离，不声称能阻止同一 OS 用户主动泄露。当前材料没有对抗 prompt injection 试验，不声称具备通用提示注入抵抗能力。

两个 Gate 批次复用相同病例，二者是真实调用重复而非独立病例；按 case/共享模板簇报告依赖。首次 Gate 暴露后不再生成或编辑候选、修改数据、Oracle、rubric 或参考，否则停止整个受影响比较并保留原事实。预算 census 计入所有本地 adapter 调用、失败和 UNKNOWN；诊断、补跑和重试没有授权时不能执行，实际远端计费/usage 不可用时明确标不可归因。

## 调用、预算与停机点

保留 6 Development / 5 Gate / 3 独立 Reuse；数据来源统一 SYNTHETIC_OFFICE_SCENARIO，不是公司记录。沿用 v1 family 与 Core role 约束；Reuse 在单独数据集中使用 GATE 角色，不与五例 Web Gate 混合。该分组是探索性场景分层，不因不同文件名或 family 标签就证明统计独立或泛化。

先冻结虚构组织政策、全部数据与两个 Oracle 的摘要及评价 rubric，再观察 baseline。只有 Development 可暴露给修订模型。跨组检查原文重复、公共 scaffold 外的近似重复与答案关联；不能只比较文件名。

用户已说明不设金额上限；仍拟定最多 33 次实际 Provider 调用：S0 Development 6、单次修订 1、五例 Shadow 配对 10、独立研究 Gate 配对 10、Reuse 配对 6。诊断、重试、追加候选不在该预算内。Research Runner 的十次配对是另一次真实试验，不能把先前 Shadow 与研究 Trial 混为同一次或只计算有利结果。B/C 若共享底层 Trial，只算一条观测。

这个数量是上限草案，不是执行批准。本轮离线准备已获授权；任何正式执行须先提供具体阶段、输入/版本/预算/停机点及其摘要供所有者批准。S0 admission、Development 的真实 Plan、反馈、修订、候选、Gate、研究协议和可能的晋升/激活按原流程分别授权。原 `build_research_protocol` 要求真实后代、候选回执、完成 Gate Assessment 与独立首选选择；S1 尚不存在时不能伪造这些字段或提前签发一个假的 Core protocol。后续实际 Core protocol SHA 在相应事实齐备后单独呈现。

任何未授权、UNKNOWN、缺失、Gate 失败、质量未决、来源不一致都停止受影响的转换。研究数据、调用回执与结果全在隔离空间；不改现用 Runtime、生产 Skill 或个人库。当前不进行任何外部 Provider 调用，也不自动进入 live pilot。

## 本轮离线准备状态

十四例原文、执行 Oracle、作者参考标注与独立上下文 LLM 标注分别保留摘要。追加的私有 v2 裁决记录保留双方原稿、逐段依据、状态映射及分母；条件承诺和 ad-hoc 笔记中的承诺保留限定词，纳入已承诺项但不升级其证据层级。原作者将一般缺失项统称 blocker 的地方，改为区分依赖、未决问题与明确高优先级 blocker；争议读法继续保留，不凭两位 LLM 一致宣布真值。没有实际模型输出，所有内容得分均为 NOT_RUN，人工评价为 PENDING。

组织规则逐条冻结适用对象：1–11 面向草稿，12 面向评价报告；不能用尚未产生的报告填写草稿质量。跨部门依赖规则 6 仅在输入明确出现相应依赖的病例取有效分母，其他记 NA 并给出原因；规则 7 的“不虚增优先级”对所有病例适用，突出高优先级的正向要求仅用于明确写出该级别的病例。其他规则的未知字段也保留在预定有效分母，不事后删掉困难项目。

当前独立隔离 Core 库只注册 S0 的 CANDIDATE，无 Run、Trial、反馈或 S1；未执行 trust assessment 或 legacy trust promotion。已有 Provider profile 与凭据可读取，但其限时网络路由已过期，当前状态 PENDING_NETWORK_REAUTHORIZATION。只读取现有非敏感元数据，没有测试模型连接、改路由、换直连或启动调用。有效网络授权、profile revision 与数据摘要必须在正式执行前重新固定；当前私有 preparation 摘要是不可执行的准备记录，不能直接作为 Core 执行协议批准。
