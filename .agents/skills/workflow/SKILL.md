---
name: workflow
description: prismd 开发总流程（工作流主入口），编排所有开发任务。定义角色对照、目标制定、执行顺序与迭代规则。当用户提出任何开发/编码/实现/修 bug/重构任务、或说「开始做某个功能」时，先激活本技能再动手。各阶段另有独立入口：project-manager、developer、unittest、e2etest。
---

# workflow

主 agent 编排开发工作的总流程。所有开发任务按本循环走。

## 阶段入口

| 斜杠入口 | 阶段 | 对应角色 |
|---|---|---|
| `/workflow` | 总流程（本技能） | 主 agent 编排 |
| `/project-manager` | 规划/对齐 | 主 agent 自身 |
| `/developer` | 实现 + 单测 | `.agents/agents/implementer.md` |
| `/unittest` | 补测试 | `.agents/agents/unit-test-writer.md` |
| `/e2etest` | e2e 验收 | `.agents/agents/e2e-test-writer.md` |

各阶段入口是薄包装：按本技能的对应环节执行，职责细节见对应角色文件。

## 角色对照

| 环节 | 角色文件 | 何时派生 | 模型建议（语义级） |
|---|---|---|---|
| 规划/对齐 | 主 agent 自身 | 需求不明、范围存疑时先与用户对齐 | inherit |
| 实现 + 单测 | `.agents/agents/implementer.md` | 任务目标明确后 | inherit |
| 审查 | `.agents/agents/reviewer.md` | 每次实现完成、合回前 | reasoning（支持时） |
| 补测试 | `.agents/agents/unit-test-writer.md` | reviewer 指出覆盖缺口时 | inherit |
| e2e 验收 | `.agents/agents/e2e-test-writer.md` | 里程碑完成、发布前 | inherit |

模型建议只写语义级（`lite` / `reasoning` / `inherit`），不写具体模型 ID——模型 ID 各工具不通用。实际绑定在各工具的本地配置里完成，不入仓库（见 `.agents/README.md` 兼容矩阵）。

派生规则：一次只派一个子代理做一件事。子代理看不到主对话，**brief 必须自包含**。

## Goal 怎么定

1. **来源**：规划文档的里程碑与功能边界（入口由工作区约定指明）+ 用户当前指令。
2. **分解**：里程碑 → 特性 → 任务；一次派发只含一个任务。
3. **写法**：目标 = 可验收的完成标准，不是活动描述。
   - 坏：「重构 router」
   - 好：「router 候选过滤在额度耗尽、上游超时、配置缺项三种场景下行为与规划一致，且对应测试通过」
4. **brief 四要素**：背景（为什么做）、目标（验收标准）、边界（不做什么）、输入（读哪些文档/文件）。

## 执行顺序

1. **对齐**：读规划文档确认功能边界；不明先问用户。
2. **分支**：从 `develop` 拉 `feature/*`。
3. **实现**：派 implementer（单测随实现），保持最小范围。
4. **审查**：派 reviewer 审 diff。
5. **修复**：blocking 返回 implementer 修；advisory/nit 由主 agent 判断。
6. **合回**：干净后合回 `develop`。
7. **里程碑验收**：派 e2e-test-writer。
8. **推送**：向用户确认。

## Loop 规则

- **审查循环**：审查 → 修 blocking → 复审，最多 3 轮；3 轮后仍有 blocking，停下来与用户对齐（说明分歧在哪）。
- **范围爆炸**：实现中发现范围比预想大 → 立即停，回规划确认，禁止擅自扩范围。
- **规划缺口**：发现规划文档没有该功能 → 停，先补规划文档再实现。
- 每轮循环留下记录：做了什么、结论、下一步（落在提交信息或向用户的汇报里）。

## 升级条件（必须停下来问用户）

- 推送、发布等远端写操作。
- blocking 超过 3 轮。
- 范围、技术选型与规划文档冲突。
- 涉及密钥、账号、支付等敏感操作。
