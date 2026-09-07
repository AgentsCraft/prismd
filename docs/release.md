# 版本与发布（GitHub Actions）

> 运维向文档：发布流水线机制与一次性配置，供人类维护者查阅。AI 日常开发所需的行为边界（自动发版触发条件、禁止手动 tag）见根目录 [`AGENTS.md`](../AGENTS.md)。

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
