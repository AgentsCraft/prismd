# .agents/ — 可移植 agent 配置

本目录是 prismd 的 agent 配置单一事实来源，与根目录 `AGENTS.md` 配套。设计目标：**不绑定任何单一客户端**，可在 Claude Code、Codex、dsh、OpenCode、pi 等工具间移植。

## 目录

```
.agents/
├── agents/       # 角色定义：frontmatter 只含可移植子集（name、description）
└── skills/       # Agent Skills 开放标准：每技能一个目录，含 SKILL.md
                  # 工作流与阶段入口都以 skill 形式存在，支持斜杠调用与自动匹配
```

- `agents/` 是**规范文档**：主 agent 编排时按角色文件派生子代理，各工具无统一的加载机制。
- `skills/` 是**可被工具原生加载的开放标准**（SKILL.md）。skill 即斜杠命令（支持的工具中），也可靠 description 自动匹配（渐进式披露）。

## 斜杠入口

| 入口 | 用途 |
|---|---|
| `/workflow` | 开发总流程（主入口） |
| `/project-manager` | 规划/对齐阶段 |
| `/developer` | 实现 + 单测阶段 |
| `/unittest` | 补测试阶段 |
| `/e2etest` | e2e 验收阶段 |
| `/release` | 发布流程 |
| `/git-workflow` | 分支与提交规范 |
| `/code-review` | 提交前审查清单 |

## 兼容矩阵

| 能力 | Claude Code | Codex | dsh | OpenCode | pi |
|---|---|---|---|---|---|
| AGENTS.md | 支持 | 支持 | 支持 | 支持 | 支持 |
| `.agents/skills` 原生识别 | 否（读 `.claude/skills`） | 否（读 `.codex/skills`） | **是** | 否（扫 `skills/`） | **是** |
| skill 斜杠调用 | `/skill-name` | 以文档为准 | 以文档为准 | 以文档为准 | 以文档为准 |
| 子代理定义 | `.claude/agents/` | `.codex/agents/` | 无 | `.opencode/` 配置 | 无 |

> 具体行为以各工具最新文档为准。

## 桥接方式（每台机器一次性本地操作，不入库）

`.claude/`、`.codex/` 等目录已被 `.gitignore` 忽略，本地符号链接不会污染仓库：

```bash
# Claude Code
mkdir -p .claude && ln -s ../.agents/skills .claude/skills

# Codex
mkdir -p .codex && ln -s ../.agents/skills .codex/skills

# OpenCode（从仓库根向上扫 skills/*/SKILL.md）
ln -s .agents/skills skills
```

dsh 与 pi 无需操作，原生读取 `.agents/skills`。

## 角色与模型

- 角色文件里**不写死模型**：模型 ID 各工具不通用，绑定属于本地配置。
- `skills/workflow/SKILL.md` 的角色对照表给出语义级建议（`lite` / `reasoning` / `inherit`），各工具按自身机制绑定（如 Claude Code 的 `--model` / settings、Codex 的模型选择、dsh 的 settings.yaml、OpenCode 的 opencode.json、pi 的本地配置）。
