# 办公 Skill 反馈演化预实验协议 v1

> 阶段 2 在首次实验前以 [Meeting Minutes 协议 v2](MEETING_MINUTES_PILOT_V2.md) 修订输出格式和指定来源。v1 保留历史准备身份；其中 JSON 约定不适用于指定上游 Markdown Skill。阶段 2 状态、实际准入和协议批准分别记录，不能由下文 v1 的 PENDING 模板推断已执行。

准备日期：2026-10-28。主题：会议纪要与行动项提取。此文档固定探索性预实验的设计与评价口径，不包含实际研究文档、私有 Oracle 或试验结果。

`PILOT_PROTOCOL_READY = PREPARATION_READY`；`REAL_SKILL_AVAILABLE = PENDING_REAL_SKILL`；`LIVE_PILOT_EXECUTED = NOT_RUN`；`FINAL_HOLDOUT = NOT_FROZEN_NOT_RUN`；`FORMAL_THESIS_EXPERIMENT = NOT_STARTED`。

## 真实材料准入

需要所有者提供一个明确授权的 Skill 路径，以及可脱敏使用的会议材料与独立评价人员。本轮不搜索个人库，不冒称已取得真实 Skill，不修改源库。

收到源文件后先列出相对文件清单、原始 SHA-256、版本和许可证/使用许可；保持源文件只读。逐项映射：名称与描述 → Card name/description；可独立执行的文本指令 → instructions；经授权的 read_file/write_file/patch_file 子集 → allowed_tools；原始来源与摘要 → 私有准入记录。外部 references 需明确读取范围并人工内联审查；脚本、联网、插件、附件解析、Shell、动态资源及 SKILL.md 调度语义均非现有 SkillCard 能力。存在未映射行为时记录部分兼容或拒绝，不能丢弃后宣称完整兼容。

独立审阅者确认等价性后，才通过既有显式流程建立原始 TRUSTED v1；准入不等于自动授予 TRUSTED。没有实际源 Skill、独立 Oracle、Provider 授权或协议批准时对应项目持续 PENDING。

## 数据分配与隔离

公开可复用模板由 `python -m examples.office_skill_pilot` 输出，仅含准备元数据。`validate_pilot` 检查 6 DEVELOPMENT、5 GATE、3 PILOT_REUSE 的完整预分配、身份唯一、family 不跨组与修订暴露清单；它不替代 Core 数据集校验器。

| 组 | 数量 | 预定场景 | Core 角色及用途 |
|---|---:|---|---|
| DEVELOPMENT | 6 | 行动项遗漏、虚构负责人、虚构日期、状态偏差、格式、关键信息保留 | DEVELOPMENT，原始失败与用户反馈可进入修订模型 |
| GATE | 5 | 跨团队交接、决策记录、依赖梳理、含糊承诺、多主题纪要 | GATE，完整五例封闭套件，Web 配对最多十次模型请求 |
| PILOT_REUSE | 3 | 复盘纪要、客户跟进、运营简报 | 独立数据集中的 GATE，单独的研究复用观察，不能混进五例 Web Gate |

每组使用不同 task_family；同一 seed+Oracle 指纹不得跨角色。复用组与 Gate 组也按 group 做更严格的 family 隔离。这测试跨 family 迁移，不自动建立同分布泛化。Reuse 不是 Final Holdout。任何已向修订模型展示的输入、反馈、输出或答案必须进入 Development 暴露清单，不能继续算作该修订的未见测试。

真实数据放在仓库外所有者明确授权的研究根；每例存 `task.json`、独立 `seed/`、`oracle.json`。文件和清单逐一计算实际摘要，不填伪造占位摘要。通过原 `load_research_dataset` 校验角色、fingerprint、路径与内容身份，再调用 `validate_private_dataset` 对照准备清单。对三个数据集汇总检查输入重复；不能仅凭每个独立清单各自通过而宣称跨数据集无重复。模板当前材料状态始终是 PENDING_SANITIZED_INPUT。

TaskSpec 的验收只能声明对模型公开的格式/文件存在等要求；私有逐项答案置于 Oracle 或独立人工评价表，不向规划或修订模型暴露。现有 Shadow Oracle 使用 exact expected_files 与文件保留断言；自由文本摘要的语义等价性不能由字节相等替代，以下内容指标需独立人工核对或冻结的离线分析。不得临时增加通用 Oracle 引擎或修改 validator 迁就样例。

## 输出约定及独立评价

准备阶段先审定 UTF-8 JSON 输出约定：summary、project_status、action_items、uncertainties。行动项包含 action、owner、due_date、source_ref；不确定的 owner/date 为 null，source_ref 指向脱敏材料固定段落编号。若实际 Skill 的既有输出不同，先审查兼容性和协议修订，在任何结果产生前冻结新口径。

独立评价者预先在私有 Oracle 中标注原文命题、行动项同义匹配规则、负责人/日期是否明确、项目状态及允许的未知值；两人分歧记录原始意见及裁决依据。审阅者不能参与 Candidate 生成；评价表记录 reviewer_id、rubric 版本/摘要、来源摘要、输出摘要、时间、盲态与裁决。LLM judge 若另行批准，只能附列未验证辅助意见。

| 客观或核对指标 | 固定定义与分母 |
|---|---|
| 结构合规 | 可严格解析且必填字段及类型合规的输出数 / 所有已声明 case-version slots；缺失另列 |
| 行动项召回 | 被独立标注规则匹配的真实行动项数 / Oracle 行动项数；重复项不增加命中；无真实项时分母标 NA |
| 负责人/日期正确率 | 与原文明确值或规定 null 一致的字段数 / 所有匹配真实行动项的两类字段；遗漏行动项另报召回，不以缩小分母掩盖遗漏 |
| 无依据断言数 | 原文不支持且未标不确定的事实命题数，逐项列证据；虚构 owner/date 计入且单列，不作两个独立样本 |
| 独立执行 Acceptance | Core VALIDATION 结果及引用；与内容质量评价分别报告，不把用户“满意”换算为通过 |
| 配对回归 | 相同 case、相同模型配置下 A 通过而 B/C 失败的配对数 / 完整配对数；部分结果与最坏情况边界另列 |
| UNKNOWN / missing | 结果未确认和未提交 slots 分别计数 / 所有预先声明 slots；不得删除或计为成功 |

人工评分每维 0–3，评价前冻结：

| 维度 | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| 完整性 | 大部关键信息缺失 | 多个关键遗漏 | 个别次要遗漏 | 关键命题和行动项完整 |
| 可读性 | 难以理解 | 结构混乱、需大量重写 | 清晰、有少量冗余 | 清晰、简洁且结构一致 |
| 实用性 | 无法用于跟进 | 需大量原文核查 | 小量修正后可用 | 可直接跟进，未知项明确 |
| 忠实度 | 严重虚构或颠倒结论 | 有重大无依据推断 | 小偏差且不改变关键结论 | 忠于来源并保留不确定性 |

每个维度分别报告原始分数，不用总分抵消虚构事实或执行回归。任何重大虚构、独立验收失败、UNKNOWN、缺失、配对回归都阻断“已改善”的工程结论；Gate 的真实准入仍只由原 Core policy 决定，本表不给自动晋升权。

## 配对、盲评与实际参数

预先固定所有 case、顺序、尝试次数、候选选择、缺失规则、数据/Oracle SHA 和源码身份。A 是原 TRUSTED v1；B 是隔离未门控 Candidate；C 只在 Gate eligible 且获单独批准/激活时选择 Candidate，否则保持合格 reference。B/C 共用同一版本/trial 时标共享依赖，不增加独立样本数。报告完整 case 配对分母和独立 trial 数，不将条件标签当重复观测。

相同版本配对固定同一 Provider profile revision/config SHA。保存实际发出的 model、stream=false、n=1 和已明确支持的参数；未传的温度、seed 等标 PROVIDER_DEFAULT_UNPINNED，不假定默认值，模型别名不证明服务端权重身份。所有尝试、失败、UNKNOWN 与耗时原样保留，token/费用缺失则标不可用。小样本仅作探索描述。

独立评价前用事先登记的随机种子打乱匿名输出标签，版本映射由非评价者保存；记录算法、种子、顺序与揭盲时间。盲态做不到则显式标 OPEN_REVIEW。不得观察结果后更换不利用例、Oracle 或评价口径。

## 复用原有研究 Runner

实际材料齐备后按 [既有研究协议](RESEARCH_EXPERIMENTS.md) 依次使用 `load_research_dataset` → `build_research_protocol` → 审查并批准完整 protocol SHA → `create_research_experiment` → `execute_research_experiment` → `seal_research_experiment` → `inspect_research_experiment` / `export_research_results`。`LIVE_PILOT` 必须单独批准；本轮没有调用它，不自动开启正式论文实验或 Final Holdout。

本轮工程夹具验证仅证明反馈、关联、授权和隔离机制可用，不构成真实会议 Skill 的改进结果或论文结论。
