---
name: unittest
description: prismd 开发流程的补测试阶段入口。当需要给存量代码补充单元/集成测试、修复审查指出的覆盖缺口时使用（单测、单元测试、测试覆盖）。
---

# unittest

按 `workflow` 技能（`.agents/skills/workflow/SKILL.md`）的「补测试」环节执行，职责细节见 `.agents/agents/unit-test-writer.md`。

## 要点

- 白盒视角，覆盖核心算法（路由、额度、软限制、配置合并）与协议透传的边界/异常路径。
- 禁止只测 happy path：额度耗尽、上游超时、配置缺项必须有覆盖。
- 只补测试，不改被测实现；发现 bug 先报告，不顺手改。

## 产出

- 与源码同构的测试文件（`test/*.test.ts`），全部通过。
- `test:` 前缀提交。
