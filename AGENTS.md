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

## 版本与发布（GitHub Actions）

tag、npm 发布与 Release 全部自动生成，无需手动打 tag（见 `.github/workflows/`）。两条通道对应两个 npm 包：

| 触发 | workflow | npm 包 | tag | GitHub Release |
|---|---|---|---|---|
| 合入 `develop` | `release-rc.yml` | `@agentscraft/prismd`（RC 通道） | `vX.Y.Z-rc.N`（对齐下一个正式版本：最近正式 tag patch +1；无正式 tag 时基线 `v0.0.1`） | pre-release，自动带 changelog |
| 合入 `main` | `release.yml` | `@prismd/prismd`（正式） | 最近正式 tag patch +1（首次为 `v0.0.1`） | 正式 Release，自动带 changelog |

- 版本线从 `v0.0.1` 起步逐步 patch 累进；API 稳定后再手动 major 升 `v1.0.0`。
- RC 序号 N 按同一目标版本下已有 rc 数自动递增（`v0.0.2-rc.1`、`rc.2`…），与正式版同族可追溯。
- major/minor 发版：在 Actions 页手动触发 `Release` workflow，选择 `major`/`minor`/`patch` 级别。
- tag 已存在时跳过，不报错；发布版本与 tag 同步（`npm version` 同步 package.json，不提交改动）。`package.json` 存在前发布步骤自动跳过；已在 npm 上的版本跳过。
- 仓库 `package.json` 的 `name` 以正式包 `@prismd/prismd` 为准；RC 发布时 workflow 临时改写为 `@agentscraft/prismd`（不提交）。
- npm 发布走 **Trusted Publishing（OIDC）**，无需 token。包不存在时无法配置 Trusted Publisher（无 API，需网页操作）：首次先本地 `npm login` + `npm publish` 发占位版本建包（72h 内可 unpublish），再到 npmjs 包设置配置 Trusted Publisher（GitHub Actions，workflow 文件名分别填 `release-rc.yml` / `release.yml`），此后 CI 全自动发布。
- `NODE_AUTH_TOKEN` 仅作可选兜底（本仓库未配置）；bypass-2FA token 的 direct publish 计划 2027-01 停用。
- scoped 包需在 `package.json` 声明 `"publishConfig": { "access": "public" }`；开源公开后 provenance 要求 `repository` 字段精确指向 GitHub 仓库。

## 推送

- 默认**不自动推送**到远端；推送前与用户确认。
- 本仓库开源时需先确认可见性策略，再翻 public。
