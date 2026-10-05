# Contributing to Code Converter

感谢参与！本插件是 Obsidian 社区插件，目标是"安全地把非 UTF-8 文件转成 UTF-8"。

贡献前请先读完 [Security Policy](SECURITY.md)——本项目对涉及文件写入的改动有严格红线。

---

## 本地开发

```bash
npm install
npm run dev      # watch 模式，改 src 自动重打包
```

把本目录（或软链）放到 Vault 的 `.obsidian/plugins/code-converter/`，在 Obsidian 里 `Ctrl/Cmd+R` 重载即可。

## 常用命令

| 命令 | 作用 |
|------|------|
| `npm run build` | 打包 → `main.js`（开发构建，含 sourcemap） |
| `npm run build:release` | 生产构建 → `dist/`（压缩、无 sourcemap） |
| `npm run release` | 完整发布流程：版本一致性闸门 + 生产构建 + 打包 + 校验 |
| `npm test` | 完整测试链：编码单测（18 项）+ 日志冒烟（13 项）+ VIP/广告回归（78 项）+ tsc strict |
| `npm run test:mojibake` | 乱码修复回归（29 组夹具） |
| `npm run locales` | 10 语言 × 102 keys 齐全性校验 |
| `npm run docs` | 重新生成项目架构文档 |
| `npm run typecheck` | `tsc --noEmit`（已并入 `npm test`） |

## 提交与 PR 规范

- **分支**：从 `main` 拉出，前缀 `feat-` / `fix-` / `docs-`。
- **提交信息**：`feat:` / `fix:` / `docs:` / `test:` / `chore:` + 一句话讲清做了什么。
- **PR 描述**：套用 `.github/PULL_REQUEST_TEMPLATE.md`（功能说明 + 隐私声明）。
- **发版**：改 `manifest.json` / `package.json` / `versions.json` 的 version 三处一致，并补 [`CHANGELOG.md`](CHANGELOG.md) 里的 `## Unreleased` 段落。

## 安全红线（改动前必读）

改动涉及"会毁文件"的行为时，先加/改单测再提交：

- 合法 UTF-8 文件**任何路径都不许改动**。
- 低置信度**不许静默强转**，必须走确认框。
- 转换前必须备份（除非用户显式关闭）。
- 自写文件事件必须经 `selfWritten` 防回环。

**这些红线来自真实事故**——Obsidian 只认 UTF-8，保存非 UTF-8 文件会导致字节永久丢失，插件的核心价值就是让"救得回"成为可能。任何绕过这套保护机制的改动都要三思。

## 加入新语言

1. 新建 `src/locales/<code>.ts`，导出与 `src/locales/types.ts` 里 `Locale` 接口匹配的翻译对象。
2. 在 `src/locales/types.ts` 的 `LocaleCode` 联合类型里加入新代码。
3. 在 `src/locales/index.ts` 注册 `LOCALE_NAMES` 与新 locale 对象。
4. 如果是 RTL 语言（阿拉伯语、希伯来语等），加入 `isRtlLocale` 判定集合。
5. 跑 `npm run locales` 校验 10+ 语言 × 102 keys 齐全。
6. 无需改 `settings.ts`——UI 会自动列出所有已注册语言。

**注**：新语言若属于前 4 种（简中/英语/日语/韩语）之外的语言，需要加到 VIP 门禁清单里（见 `src/vip/gate.ts`），并同步更新 [`README.md`](README.md) / [`README.zh-CN.md`](README.zh-CN.md) / [`USER_GUIDE.md`](USER_GUIDE.md) 三处的"免费 vs VIP"披露段。

## 加入新候选编码

1. 在 `src/encoding.ts` 的候选池（`CANDIDATE_ENCODINGS`）里加入新编码名。
2. 若该编码有独特特征（如 CJK 扩展区、假名、朝鲜文），在 `scoringRatio` 里为对应脚本族加权。
3. 跑 `npm test` 补对应单测。
4. 若新编码可能误判为合法 UTF-8，加进"边界场景"测试集。

## Obsidian API 使用铁律

**任何 `obsidian` 模块的导入/API 必须先 `grep node_modules/obsidian/obsidian.d.ts` 验证存在。**

esbuild 不查类型，编造 API 会**静默放过**——直到 Obsidian 运行时才炸。历史踩过 4 个坑：

- `export default` 缺失（应为 `import { ... } from "obsidian"` 命名导入）
- `addCss()` **不存在**（用 `styles.css` 文件 + 运行时 `applyStylesheet` 自动加载）
- `getAbstractFile` 不存在（应为 `getAbstractFileByPath` 或直接 `vault.getAbstractFileByPath`）
- `vault.write` 不存在（应为 `vault.modify` 或 `vault.process`）

**纯逻辑用 mock 测试；vault 调用链用 Proxy 冒烟测试**——真实 Obsidian 环境难自动化，Proxy 是最小可行验证。

## 版本控制

- 版本唯一事实源是 `manifest.json` 的 `version` 字段。
- `package.json` 与 `versions.json` 里的 version 必须与 manifest 一致。
- `npm run release` 内置版本一致性闸门，任一处不一致立即失败。
- 版本号遵循 SemVer：功能新增 → minor，修复 → patch，破坏性变更 → major。

## 报告安全问题

**不要**通过 GitHub Issues 报告安全漏洞——用 [Security Policy](SECURITY.md) 里说明的私下通道。

## License

除非另有说明，本仓库所有代码遵循 [MIT License](LICENSE)。
