# prismd-core — 代码仓库

prismd：本地优先的 LLM 网关，聚合多个免费/低额度模型 API（OpenRouter、Groq，后续 Cerebras、GitHub Models 等），为编码 agent（第一期 Codex CLI）提供稳定、可切换的接口。

## 仓库边界

- 本仓库**只放代码**与工具无关的 agent 配置（`.agents/`）。规划与设计文档不随本仓库发布。
- 除标准 `AGENTS.md` 与 `.agents/` 外，不接受任何特定客户端配置（如 `.codebuddy/`、`.cursor/` 等）。

## `.agents/` 目录

工具无关、可移植的 agent 配置（单一事实来源，详见 [`.agents/README.md`](.agents/README.md)）：

```
.agents/
├── README.md     # 兼容矩阵与各工具桥接说明
├── agents/       # 子代理定义：frontmatter（name、description）+ 职责说明
└── skills/       # Agent Skills 开放标准：每技能一个目录，含 SKILL.md
                  # 斜杠入口：/workflow /project-manager /developer /unittest /e2etest 等
```

## 分支模型（Gitflow）

| 分支 | 用途 | 规则 |
|---|---|---|
| `main` | 稳定发布线 | 只从 `develop` 合入，或 `hotfix/*` 修复 |
| `develop` | 开发主线 | 所有特性合入目标 |
| `feature/*` | 特性分支 | 从 `develop` 拉出，完成合回 `develop` |
| `hotfix/*` | 紧急修复 | 从 `main` 拉出，修完合回 `main` 和 `develop` |

## 提交规范（Conventional Commits）

提交信息一律英文，格式 `type: summary`（summary 小写开头、不超过 72 字符）：

- `feat:` 新功能；`fix:` 修复；`docs:` 文档；`refactor:` 重构
- `test:` 测试；`chore:` 杂项（构建、依赖）；`perf:` 性能；`ci:` 流水线

正文可选，用于解释 why；破坏性变更加 `BREAKING CHANGE:` 脚注。

## 推送

- 默认**不自动推送**到远端；推送前与用户确认。
- 本仓库开源时需先确认可见性策略，再翻 public。
