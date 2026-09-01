# prismd-core — 代码仓库

prismd：本地优先的 LLM 网关，聚合多个免费/低额度模型 API（OpenRouter、Groq、Cerebras，后续 GitHub Models 等），为编码 agent（Codex CLI、Claude Code、OpenCode 等）提供稳定、可切换的接口。

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
                  # 斜杠入口：/workflow /project-manager /developer /unittest /e2etest /security-audit 等

.githooks/        # gitleaks 钩子（提交前暂存扫描 + 推送前全历史扫描）
                  # 每台机器一次性：git config core.hooksPath .githooks（见 .agents/README.md）
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

## 安全核查

- 提交前/推送前强制 gitleaks 扫描（`.githooks/pre-commit` 暂存、`.githooks/pre-push` 全历史），每台机器一次性 `git config core.hooksPath .githooks`（见 `.agents/README.md`）。
- agent 语义核查走 `/security-audit`（角色 `.agents/agents/security-auditor.md`），覆盖暂存 diff + 全仓敏感文件快扫。
- CI 兜底：`.github/workflows/security-scan.yml`（push/PR 到 develop/main 时全历史扫描）。
- 误报用 `.gitleaksignore` 按指纹忽略；真实泄漏先轮换密钥，再决定是否重写历史。

## 推送

- 默认**不自动推送**到远端；推送前与用户确认。
- 本仓库开源时需先确认可见性策略，再翻 public。

## UI设计

UI 设计应默认收敛、克制、常规；尺寸与间距根据界面类型、信息密度、平台习惯、使用频率和视觉层级判断，不写死统一规格，也不主动放大。辅助入口、设置、开关、工具按钮不应抢视觉中心。常见功能必须使用大众通用、用户一眼可识别的图标隐喻，优先成熟图标库、系统图标或行业通用符号，不为差异化自创奇怪图标；自定义图标也必须保持常见轮廓、比例和语义。除非明确要求强调，否则优先用位置、分组、轻微颜色、hover、tooltip、分隔线和状态反馈表达层级，避免夸张尺寸、重色块、大圆角、厚边框、强阴影、装饰性渐变和营销页式布局。实现后必须与同屏元素对比检查，若显得突兀、过大、过重或破坏信息密度，应主动收敛。
