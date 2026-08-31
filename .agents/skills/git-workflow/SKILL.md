---
name: git-workflow
description: prismd 的分支与提交流程。当需要创建分支、提交代码、合并回 develop 或准备发布时使用（git commit、branch、merge、conventional commits）。
---

# git-workflow

按本仓库 `AGENTS.md` 约定的 Gitflow 三层模型执行所有 git 操作。

## 分支模型

- `main`：稳定发布线，只从 `develop` 合入或 `hotfix/*` 修复。
- `develop`：开发主线，所有特性合入目标。
- `feature/*`：从 `develop` 拉出，命名 `feature/<短横线描述>`（如 `feature/m0-responses-ingress`）。
- `hotfix/*`：从 `main` 拉出，修完合回 `main` 和 `develop`。

## 提交（Conventional Commits）

- 格式：`type: summary`，summary 小写开头、不超过 72 字符、英文。
- 类型：`feat` / `fix` / `docs` / `refactor` / `test` / `chore` / `perf` / `ci`。
- 正文可选，解释 why；破坏性变更加 `BREAKING CHANGE:` 脚注。

示例：

```
feat: add responses ingress adapter

仅透传 Responses 协议，不做语义路由。
```

```
fix(router): filter candidates without free quota
```

## 流程

1. **开工**：从最新 `develop` 拉 `feature/*`。
2. **提交**：小步提交，一个提交只做一件事；不要混入无关改动。提交前先跑 `/security-audit`；`.githooks/pre-commit` 会强制 gitleaks 暂存扫描（本机未装 gitleaks 时提交被阻止，先按提示安装）。
3. **合回**：功能完成后合回 `develop`（保留提交历史，不 squash 无关提交）。
4. **推送**：默认不自动推送。推送前必须向用户确认；推送的是公开仓库时再次确认。推送前再跑 `/security-audit`（全仓）；`.githooks/pre-push` 强制全历史 gitleaks 扫描。
5. **发布**：`develop` → `main`，打 tag `vX.Y.Z`，走 `release` skill（`.agents/skills/release/SKILL.md`）。

## 禁止

- 不推送任何包含密钥、个人路径、本地配置的内容（先跑 `git diff --cached` 自查，再走 `/security-audit`）。
- 不 force push；不绕过 hook（`--no-verify`）——安全 hook 尤甚，绕过需向用户说明。
- 不把规划/设计文档提交进本仓库。
