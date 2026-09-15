---
name: release
description: prismd 发布核查：确认测试与安全状态，触发 CI 发布通道，并核对 tag、npm 包与 GitHub Release。
---

# release

## 前置条件

- `develop` 已通过类型检查、单测、端到端测试和安全核查。
- 工作区、暂存区和待推送提交中没有密钥或本地配置。
- 发布动作所需的分支推送、PR 合并或 workflow 触发已与用户逐项确认。

## 发布通道

- 合入 `develop`：CI 发布 RC 到 `@agentscraft/prismd`，并创建 pre-release。
- 合入 `main`：CI 发布正式版到 `@prismd/prismd`，并创建 GitHub Release。

## 步骤

1. **确认版本影响**：检查自上一个正式版以来的提交，确认 patch、minor 或 major 级别；需要非 patch 版本时，通过 Release workflow 手动触发对应级别。
2. **确认 CI 输入**：检查目标分支、workflow、npm 包名和 Trusted Publisher 配置。
3. **触发发布**：合入对应稳定或开发分支，由 CI 完成版本、tag、发布和 Release。
4. **核对结果**：确认 workflow 成功、tag 与 npm 版本一致、GitHub Release 内容正确。
5. **异常处理**：CI 失败时先停止后续发布；不要手工补 tag 或直接改写 `package.json` version。

## 禁止

- 禁止手动打 tag。
- 禁止手动修改 `package.json` version。
- 禁止绕过 CI 直接发布 npm 包，首次建包的引导步骤除外。
