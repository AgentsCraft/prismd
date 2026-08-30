---
name: developer
description: prismd 开发流程的实现阶段入口。当任务已明确、需要编写或修改代码时使用（实现、编码、写代码、开发某个功能）。
---

# developer

按 `workflow` 技能（`.agents/skills/workflow/SKILL.md`）的「实现 + 单测」环节执行，职责细节见 `.agents/agents/implementer.md`。

## 要点

- 任务 brief 不明确时先回 project-manager 环节对齐，不猜。
- 从 `develop` 拉 `feature/*` 分支再动手。
- 单测随实现同提交编写；保持最小范围。
- 完成后按 Conventional Commits 提交，等待审查环节。

## 禁止

- 不擅自扩大范围；范围爆炸立即停，回规划确认。
- 不硬编码密钥/路径；不引入规划外的依赖。
