---
name: release
description: prismd 发布流程：develop → main、版本号、changelog、npm 发布与 GitHub release。
---

# release

## 前置条件

- `develop` 已通过全部测试，功能与规划里程碑一致。
- 仓库可见性符合当期策略（`AgentsCraft/prismd` 开源时翻 public，翻之前与用户确认）。

## 步骤

1. **版本号**：遵循 SemVer（`vX.Y.Z`），破坏性变更 bump major，新功能 minor，修复 patch。先与用户确认版本号。
2. **changelog**：按 Conventional Commits 历史整理 `CHANGELOG.md`（feat/fix 为主，标注破坏性变更）。
3. **合入**：`develop` → `main`（fast-forward 或 merge 提交）。
4. **打 tag**：`git tag vX.Y.Z`，推送前确认。
5. **npm 发布**：包名走 `@prismd/prismd`（scope 已注册）；发布动作与用户确认后执行。
6. **GitHub release**：基于 tag 创建 release，附 changelog。

## 注意

- 所有远端写操作（push、publish、release 创建）逐项与用户确认。
- 发布后如发现严重缺陷：从 `main` 拉 `hotfix/*`，修完合回 `main` + `develop`，patch 版本再发。
