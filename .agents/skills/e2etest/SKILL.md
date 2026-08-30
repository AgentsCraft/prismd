---
name: e2etest
description: prismd 开发流程的端到端验收阶段入口。当里程碑完成或发布前需要验证完整用户旅程时使用（e2e、端到端、验收、全链路）。
---

# e2etest

按 `workflow` 技能（`.agents/skills/workflow/SKILL.md`）的「里程碑验收」环节执行，职责细节见 `.agents/agents/e2e-test-writer.md`。

## 要点

- 黑盒视角，只通过对外接口（HTTP 端点、CLI）驱动，不读内部实现。
- 典型旅程：客户端（Codex CLI）→ prismd → 上游，验证流式响应完整、failover 切换、软限制生效。
- 上游优先用本地 mock；涉及真实免费上游的用例标注「需要密钥」，默认跳过。

## 产出

- `test/e2e/` 下可重复执行的旅程测试，文件头写明环境准备步骤。
- 失败输出能定位环节：客户端侧 / 网关侧 / 上游侧。
