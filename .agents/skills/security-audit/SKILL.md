---
name: security-audit
description: prismd 提交前/推送前安全核查入口。gitleaks 确定性扫描 + agent 语义核查，覆盖暂存 diff 与全仓敏感文件（.env*、*.pem、*.key、配置文件）。当提交、推送、合回、发布前使用（security、secrets、泄漏、安全核查、gitleaks）。
---

# security-audit

提交前/推送前执行，产出分级结论（PASS / FAIL + blocking 清单）。与 `/code-review` 并列分工：本技能只管密钥/凭据泄漏，代码质量走 code-review。

## 时机

- **提交前**：implementer 每次提交前走一遍（总流程强制，见 workflow 技能）。
- **推送前**：向用户确认推送前再走一遍（全仓）。
- **合回 develop / 发布前**：与里程碑验收同批执行。

## 步骤

1. **确定性扫描（gitleaks）**：暂存扫描 `gitleaks git --pre-commit --staged --no-banner -v --config .gitleaks.toml .`；推送前全仓 `gitleaks git --no-banner -v --config .gitleaks.toml .`。git hook（`.githooks/`）会在 commit/push 时自动强制执行，此处手动跑是为提前拿到结果，避免被 hook 拦住。
2. **agent 语义核查**：派 `.agents/agents/security-auditor.md`，范围 = 暂存 diff + 全仓敏感文件快扫（`.env*`、`*.pem`、`*.key`、配置、README 示例密钥）。
3. **判定**：blocking 返回 implementer 修复；advisory/nit 由主 agent 判断是否本次修。
4. **报告**：结论 PASS/FAIL + 分级意见清单，附在提交信息或汇报里。

## 注意事项

- gitleaks 未安装：按 hook 报错提示安装（`brew install gitleaks`），不绕过。
- 误报：用 `.gitleaksignore` 按指纹忽略，不扩 `.gitleaks.toml` 的 allowlist 路径。
- 泄漏已发生：**密钥先轮换**，不能只删文件；历史处理方案与用户确认。
- 不绕过 hook（`--no-verify`）；git-workflow 技能已列为禁止。
