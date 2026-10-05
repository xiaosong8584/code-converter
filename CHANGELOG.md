# Changelog

## 1.7.0 (2026-10-05)

### 版本亮点

本次发版是**1.6.1 之后第一轮大改动**，包含：
- **发布流程标准化**：发布清单对齐 obsidian-sample-plugin（styles.css 抽到仓库根）、发布审计（CONTRIBUTING / CHANGELOG / SECURITY / CODE_OF_CONDUCT 全部就绪）
- **文档系统化**：新增 AD-BANNER.md（广告横幅机制）、MOJIBAKE-SAFETY.md（乱码防护全景）、AD-BANNER 章节
- **功能增强**：默认白名单覆盖源码、BOM 写入支持、乱码修复测试套件 29 组夹具
- **VIP 门禁调整**：autoConvertOnImport 从 VIP 移到永久免费（插件灵魂功能）

### 详细条目

### 本轮调整：新增 AD-BANNER.md — 支持者横幅机制与链接配置系统化

起因：用户询问「启动广告窗口出现是什么机制？这几个按钮的链接是在哪里定义的？」，进一步
追问「还有其它的链接么，比如长期的微信群/支付宝收款的方法」。发现广告横幅的知识散落在
`VIP.md`（一句话提及）、`ad-banner.ts` 代码里（DEFAULT_CONFIG 常量）、`FUNDING.yml`
（GitHub 仓库页链接，跟横幅是两个独立系统）、`Developer_Todos.md`（作者待办），缺少一份
专门面向「想加新渠道 / 想改链接」的开发者指南。

**改动**：

- **新建 `AD-BANNER.md`**（约 200 行）：完整讲清楚
  - 触发链路（`main.ts` onload 里的 `new AdBanner` → `mount` → `shouldShowAd` → `show` → 落盘）
  - 频控规则（`DAILY_INTERVAL_MS = 24h`、VIP 强制不展示、× 关闭也算已展示）
  - DOM 结构与 CSS 类（`.cc-ad-banner*`）
  - **链接定义位置**（`src/ad/ad-banner.ts:43-51` 的 `DEFAULT_CONFIG` 常量）
  - 当前渠道清单表格（4 个 URL + 占位状态标注）
  - i18n key 清单（`ad.message` / `ad.openBtn` / `ad.channel.*`）
  - GitHub 仓库页 Sponsor 按钮（`FUNDING.yml`，独立于横幅）
  - **添加新渠道的 6 步操作**（含 i18n 补齐、locales 校验、release 打包）
  - **国内支付渠道的特殊性**（微信/支付宝没有 URL 能直接打开收款，需要图片承载）
  - 作者待办（指向 `Developer_Todos.md:1.2`）
  - 测试覆盖（`test/vip-ad.test.mjs:160-172` 的 8 条断言）
  - data.json 里 `adState.config` 是**首次快照**，作者改代码后老用户不重刷的坑
- **`VIP.md` 顶部加指针**：说明横幅细节见独立文档 `AD-BANNER.md`
- **`README.md` 索引**：VIP.md 描述从「VIP 激活与支持者横幅」收敛为「VIP 激活」，
  新增 `AD-BANNER.md` 条目

**关键设计决策**：

- **拆出独立文档而非塞进 VIP.md**：横幅的**链接定义**跟 VIP 激活机制（Ed25519 验签、
  seal 指纹）是完全不同的主题，混在一起会让「想改链接」的作者翻不到；参考
  `MOJIBAKE-SAFETY.md` 的先例，跨模块主题独立成文。
- **诚实标注每个 URL 的状态**：GitHub Sponsors username、爱发电 URL 仍是占位符，
  B 站空间 ID 已确认为 `505631203`（原占位 `12345678`，本轮同步替换），
  文档里逐个标注，方便作者对照 `Developer_Todos.md` 逐项替换剩余占位。
- **明确「微信/支付宝的特殊性」**：这两条渠道的 URL 无法直跳（微信不允许，支付宝
  `qr.alipay.com/xxx` 才行），需要建一个赞助说明页承载收款码图片。避免作者以为加个 URL
  就行了。
- **指出 data.json 快照坑**：`adState.config` 是首次展示时快照的 `defaultAdConfig()`，
  作者改代码后老用户升级不重刷——这是运行时行为，不是文档能改的，得写清楚提醒作者。

**代码/测试影响**：纯文档改动，未触碰源码。`npm test` 全绿。

---

### 本轮调整：发布清单对齐 obsidian-sample-plugin（styles.css 抽到仓库根）

起因：用户要求 `npm run release` 不要打包 LICENSE 和 versions.json，改成打包 main.js /
manifest.json / styles.css 三件套，参考 obsidian-sample-plugin。sample-plugin README 原
文明确写 "Upload the files `manifest.json`, `main.js`, `styles.css` as binary attachments"
——3 件套是 Obsidian 社区目录审查时的标准形态。

**改动**：

- **`styles.css` 抽到仓库根**：CSS 此前写在 `src/main.ts` 顶部的 `const CSS = ...` 常量里，
  `onload()` 时通过 `document.createElement("style")` 运行时注入。现在整体搬到仓库根的
  `styles.css`，由 Obsidian 加载插件时自动 `applyStylesheet` 加载——**不再需要运行时注入**。
  `src/main.ts` 里的 CSS 常量和 onload 里 5 行注入代码全部删除，主类瘦身约 105 行。
- **`scripts/release.mjs` 的 `MANIFEST_FILES` 更新**：从
  `["manifest.json", "versions.json", "LICENSE"]` 改为 `["manifest.json", "styles.css"]`。
  `versions.json` 留在仓库根供社区目录系统读取（旧版 Obsidian 用它判断能否下载此版本），
  **不属于插件目录内容**；`LICENSE` 是仓库级协议文件，跟插件运行无关。
- **`TROUBLESHOOTING.md` 第四节改写**：标题从「为什么插件目录里没有这个文件」改为
  「本插件采用打包文件方式」，三种注入方式表格里明确标注本插件现在走方式 ①（v1.6.1 起），
  历史沿革（v1.0~v1.6.0 走方式 ②）也记录下来，便于日后追溯。

**收益**：
- 发布包形态与 sample-plugin 完全一致，社区目录审查时可以直接对照官方模板；
- `main.ts` 瘦身，CSS 与逻辑分离，改样式不用再跑 tsc 编译；
- `EXPECTED_FILES` 自动同步为 `["main.js", "manifest.json", "styles.css"]`，
  release 校验闸门会明确失败如果 dist/ 少任何一份。

**代码/测试影响**：CSS 内容与原先完全一致（只是搬运位置），无功能变化。
tsc 0 错误、npm test 全绿。

---

### 本轮调整：乱码防护知识系统化（新增 MOJIBAKE-SAFETY.md）

起因：用户要求把「以上所有经验和成果写入 docs 目录，特别是乱码方面的信息」。
前几轮的灵魂功能升级（file-open 监听 + onLayoutReady 扫描）相关知识散落在
USER_GUIDE.md 能力边界、README 描述、CHANGELOG 段落里，缺少一份专门的、
面向「看到乱码该怎么做」的诊断与救援全景文档。

- **新增 `MOJIBAKE-SAFETY.md`**：八节结构，把散落的
  知识收拢成完整威胁模型：
  1. **威胁模型**——Obsidian 只认 UTF-8 的完整机制（TextDecoder 硬编码 + 忽略 BOM
     + 静默容错解码 + 保存即不可逆），含 Python 实测验证 GBK→U+FFFD 后编码回转失败。
  2. **三类乱码的救援路径**——编码标注错（转换命令，无损可逆）/ 二次编码乱码
     （修复工具，多数可修）/ U+FFFD 已写入磁盘（信息论不可逆，只能从外部副本恢复）。
  3. **插件的三道防线**——file-open 监听（灵魂）+ onLayoutReady 启动扫描（覆盖
     历史遗留 tab）+ 备份兜底（.code-converter/backups/），含实现代码位置与关键
     obsidian.d.ts 类型（FileView.file: TFile | null）。
  4. **诊断决策树**——看到乱码按字节特征判断属于哪一类，走对应救援路径。
  5. **已知残留缺口**——Obsidian 无 pre-save 事件，抢先保存无法拦截；诚实交代
     框架限制，不是插件 bug。
  6. **实操建议**——保持 autoConvertOnImport 与 backupBeforeConvert 开启、别在
     Obsidian 里直接保存非 UTF-8 文件、看到乱码别按保存先跑检测、重要 vault 用 git。
  7. **相关测试与回归**——encoding 18 / mojibake 29 / log 13 三套回归覆盖点。
  8. **相关文件索引**——src/ 下所有相关模块的映射。
- **`ENCODINGS.md`** 末尾新增「Obsidian 的编码模型」小节：Obsidian 只认
  UTF-8、完全忽略 BOM 声明，链接到 MOJIBAKE-SAFETY.md 的完整威胁模型。
- **`REPAIR.md`** 第一节末尾新增「Obsidian 是 U+FFFD 的最常见来源」小节：
  在 Obsidian 生态里，含 U+FFFD 的文件几乎总是由 Obsidian 保存造成的，比「上游
  工具误转」常见得多。链接到 MOJIBAKE-SAFETY.md。
- **`TROUBLESHOOTING.md`** 新增第六节「文件变乱码的诊断决策树」：三条决策
  路径（非 UTF-8 → 转换命令 / 二次编码 → 修复命令 / U+FFFD → 外部副本），
  含「为什么必须先检测而不是直接转换」的坑（文件已被 Obsidian 保存过一次时
  转换命令会误报「已是 UTF-8」并退出）；原第六节「根因反思」顺延为第七节。
- **`README.md`** 索引新增 MOJIBAKE-SAFETY.md 条目，放在 REPAIR.md 之后。

**代码/测试无改动**——本轮纯文档系统化，无源码变更。产物与 1.6.1 版本保持
一致。CHANGELOG 记录本条为文档轮，便于日后追溯「乱码防护知识首次系统化的时间点」。

---

### 本轮调整：导入自动转换升级为灵魂功能（默认开、免费、覆盖 file-open）

起因：用户报告「打开 GBK 文件，运行『检测（只报告）』命令，切换到别的文件保存，再切回发现文件被转换成 UTF-8 且中文乱码」。经排查：检测命令本身是纯读的（只有 `vault.readBinary` + `new Notice`），真正把文件写坏的是 **Obsidian 自己**——Obsidian 只认 UTF-8，打开 GBK 文件时会用 `TextDecoder('utf-8')` 解码成乱码缓存在编辑器里，用户按 Ctrl+S / Ctrl+Shift+S / autosave 就会把这个乱码按 UTF-8 写回磁盘，**原始字节永久丢失、信息论层面不可逆**。

这是插件必须堵住的第一优先级——因此「导入时自动转换」从 VIP 增强功能升级为**插件灵魂**：

- **默认开启、永久免费**：`DEFAULT_SETTINGS.autoConvertOnImport` 改为 `true`，从 `VIP_ONLY_SETTINGS` 移除（现在只留 `textExtensions`）。设置界面不再置灰，`handleAutoDetect` 里的 VIP 运行时拦截也一并移除。
- **补上 `file-open` 监听**（此前只监 `create` + `modify`）：文件在 Obsidian 里被打开的瞬间立刻读磁盘、检测编码、转 UTF-8 写回。这是拦截「Obsidian 用 UTF-8 解码 GBK → 用户按保存」的唯一窗口——触发时磁盘上还是原字节，插件转换落盘后 Obsidian 看到磁盘变了 + view 是干净的，会自动重新加载成正确的中文。
- **补上 `onLayoutReady` 启动扫描**：Obsidian 恢复 workspace 时不会为已有 tab 触发 `file-open`（它们是上次启动就打开的），插件在布局就绪后遍历一次 `getLeavesOfType("markdown")` 里的所有 view，把里面白名单内、非 UTF-8 的文件也转掉。
- **i18n 删除 `vip.gate.autoConvertDesc`**（不再引用），10 种语言同步。**102 keys × 10 locales 完整**。
- **测试同步**：`vip-ad.test.mjs` 的两条「autoConvertOnImport VIP 锁定/解锁」断言合并为一条「永久免费」→ **vip-ad 78 条 78/78**。
- **回归全绿**：encoding 18/18 · mojibake 29/29 · log 13/13 · vip-ad 78/78 · tsc 0 错误 · build + build:release 成功。
- **产物核验**：`file-open` / `onLayoutReady` / `getLeavesOfType` 各 1 次命中 `main.js` 与 `dist/main.js`；`autoConvertDesc` 归零。

**已知残留缺口**（记录但不追求完美）：如果文件被 Obsidian 打开时其内存 view 已缓存乱码，且用户在插件转换落盘前抢先 Ctrl+S，插件无法拦截 Obsidian 的写盘——Obsidian 没有 pre-save 事件，这是框架限制。此时唯一出路是插件转换前的备份。实操建议已写入 USER_GUIDE.md 能力边界。

### 本轮新增：文件类型白名单 / 二进制黑名单 / BOM 写入

插件现在能安全处理源码类文件（C/C++/C#/Python 等），并保证永不把二进制当文本改写。
新增模块 `src/file-filter.ts`（纯逻辑、不依赖 obsidian、可直接单测）。

- **扩展名白名单**（新设置「转换的文件扩展名」，默认 `md;h;hpp;cpp;c;cc;py;txt`）：控制「导入时自动转换」
  与「转换当前文件夹」的范围，分号 / 逗号 / 空白均可分隔。**手动「转换当前文件」故意
  不经过白名单**——用户已经明确指定了目标文件，拦它没有意义（仍受二进制黑名单保护）。
  批量路径由 `getMarkdownFiles()` 换成 `getFiles()` + 白名单过滤，否则范围被焊死在 md 上。
  空串 / 纯空白 / 纯分隔符一律回退默认值，**绝不返回空数组**——空清单会让自动转换
  静默失效且用户无感知，比默认值更糟。
- **二进制黑名单**（`BINARY_EXTENSIONS`，硬编码常量、不做设置项）：图片 / 文档 /
  压缩包 / 字体 / 音视频 / 编译产物 / 数据库共 70 余种格式一律拒绝按文本改写。
  用户不该有权限解禁 `.zip`。
- **NUL 字节嗅探**（前 8KB）：兜住没写进清单的未知二进制，与黑名单互补。
  **`ts` 刻意不进黑名单**——它既是 TypeScript 源码又是 MPEG 流格式，只能靠内容区分；
  `svg` 保持文本（XML），`svgz` 才是二进制；`csv` / `json` / `yaml` / `ipynb` / `log`
  也不在列。
- **BOM 写入选项**（新设置「转换后写入 UTF-8 BOM」，默认关）：MSVC 在源文件无 BOM 时
  按系统代码页（中文 Windows 是 936/GBK）读取，C++ 项目转成无 BOM UTF-8 后中文会
  **再次**乱码；gcc/clang 自动跳过 BOM，开启对它们安全。实现上「先去再加」，保证最终
  恰好一个 BOM，不会叠成两个。
- **安全核心**：二进制拦截放在编码探测**之前**——把二进制当文本解码再写回是不可逆损坏，
  越早拦下越便宜。跳过项进 `skippedList`，批量命令在通知与控制台里都能查到原因。
- **i18n**：新增 5 个 key（`setting.textExtensions.name/desc`、`setting.writeBom.name/desc`、
  `notice.binarySkipped`），10 种语言全部补齐 → **102 keys × 10 locales 完整**。
- **测试**：`test/encoding.test.mjs` 从 14 条扩到 **18 条**，新增 `file-filter.ts` 的
  `parseExtensions`（分隔符 / 大小写 / 去前导点 / 去重 / 空回退）、`isTextExtension`、
  `isBinaryFile`（黑名单 + NUL 嗅探含 ts/svg 特判）、`hasNulByte`（8KB 扫描边界）用例。

### 本轮调整：默认白名单覆盖源码 + 非 VIP 锁定白名单编辑
- **默认白名单由 `md` 扩为 `md;h;hpp;cpp;c;cc;py;txt`**：Markdown + 常见源码 + 纯文本，
  对齐 STM32 / Qt 头文件这类实际场景。`parseExtensions` 的「留空回退」同步改为返回完整
  解析结果——原来写死 `["md"]`，默认值扩成多扩展名后会静默塌缩回单个 md。
- **非 VIP 禁止编辑白名单**（`vip/gate.ts` 的 `VIP_ONLY_SETTINGS` 新增 `textExtensions`）：
  该清单只被两条 VIP 增强功能消费，非 VIP 改了也不会产生任何效果，留着可编辑会让人
  误以为设置已生效。新 i18n key `vip.gate.textExtensionsDesc`，10 种语言补齐 →
  **103 keys × 10 locales 完整**。
- **测试同步**：`parseExtensions` 空回退用例改为钉死 8 项预期清单，并额外断言
  `DEFAULT_TEXT_EXTENSIONS` 的解析结果与之一致——默认值再变会明确失败，而非静默通过。
### Added
- **乱码修复全面测试套件**（`test/mojibake-gen.mjs` / `test/mojibake-suite.mjs` +
  `test/mojibake-cases/`，共 **29** 组夹具）：覆盖 3 误读编码（latin-1 / cp1252 / gbk）
  × 9 真值候选（utf-8 / gbk / big5 / shift-jis / euc-kr / cp1251 / koi8-r / cp1252 /
  cp1254）修复链路，正例 P01-P16（完整还原 / 部分还原 / 安全不修 / 真实文件形态
  BOM + CRLF / 繁體中文與日文 UTF-8 被误读）+ 负例 N01-N13（正常多语种文档纹丝不动，
  含阿拉伯文 / 希伯来文）。
  `npm run test:mojibake` 一键生成夹具 + 跑套件 + 出 `MOJIBAKE_REPORT.md`，
  当前 **29/29 PASS**。

### Changed
- **默认产物路径收敛到 `VaultRoot/.code-converter/`**：备份目录默认值由
  `.code-converter-backups/` 改为 `.code-converter/backups/`，日志文件默认值由
  `.code-converter.log` 改为 `.code-converter/log.json`（内容是 JSONL，文件名与
  `defaultExportName()` 产出的 `.json` 扩展对齐）。插件自建的产物不再散在仓库根。
- **默认值抽成唯一事实源**（`src/types.ts` → `DATA_DIR` / `DEFAULT_BACKUP_DIR` /
  `DEFAULT_LOG_FILE`）：`DEFAULT_SETTINGS`、设置界面 placeholder、以及「备份目录留空
  回退」全部引用常量，消除原先 `settings.ts` 里 4 处硬编码路径字符串。历史上漏改其中
  一份会让「界面提示的默认值」与「实际写入位置」不一致——现在结构上不可能再分叉。
  日志文件仍允许留空（= 禁用文件日志），该处回退值保持 `""`，不套用备份目录的非空回退。
- 点开头目录仍在 vault 索引之外，日志与备份写入继续走 `adapter.exists/read/write/
  writeBinary` + 逐级 `ensureDir`；对 `.code-converter/` 及其子目录同样生效，
  IO 逻辑无需改动。

### Tests
- `test/_log-smoke.mjs` 从 5 条扩到 **13 条**：新增真实默认值断言（`DEFAULT_LOG_FILE`
  / `DEFAULT_BACKUP_DIR` 常量值、`DEFAULT_SETTINGS` 引用一致性、默认日志路径逐级创建
  隐藏目录、日志文件落在 `.code-converter/` 下而非仓库根、备份文件落在默认备份目录下），
  mock 补 `readBinary` / `adapter.writeBinary` 以覆盖 `backupFile`。原 5 条自定义路径
  断言（根级 / 嵌套逐级建目录 / 串行队列不互相覆盖）保留。

### Notes
- **既有安装不会自动迁移**：`data.json` 里已持久化的旧值优先（`Object.assign` 合并
  顺序），升级后仍写旧路径。这是刻意取舍——旧备份与旧日志继续可读可用，不会变成
  孤立文件；想要新布局，请在设置里手动改，或清空 `data.json` 后重启。

### Fixed
- **乱码修复再补三道安全门**（在 1.6.1 文档级/行级一致性门之上）：
  1. **F6 拉丁邻接门**（`hasLatinAdjacentScript`）：异文脚本字符（han/kana/hkana/
     hangul/cyrillic）紧贴 `A-Za-z` 即拒修，挡住德文 `Größe` 被误修成西里尔（N07）
     等拉丁扩展区伪命中。
  2. **半角假名主导输出拒修**：`post === "hkana"` 一律拒（除真 shift-jis 链），挡住
     俄文 koi8-r 被 cp1251 解码出的 `戝ﾊﾌ` 型半角假名垃圾反杀（P06）。
  3. **西里尔让位自有文字系统**：best 候选为 cyrillic 但存在 kana/hangul/hkana 候选
     时，让位给后者（不含 han，避免真俄文被 gbk 汉字垃圾误让位）。
- **脚本感知质量门槛**：仅真 `shift-jis` 链且 post 为 kana/hkana 时把 `REPAIR_MIN_SCORE`
  放宽到 0.80（cp1251 的 hkana 巧合不放宽），修复日文行被西里尔反杀（P03）。
- `src/encoding.ts`：`scoringRatio` 补西里尔区 0x400-0x4FF，俄文 cp1251/koi8-r 真链
  可打印分压不再被压到 0.1 全灭。
- **中韩字节同构歧义（P04）**：`latin-1 → gbk`（中文）与 `latin-1 → euc-kr`（韩文）在
  latin-1 误读层字节完全同构，算法无法区分；标 `ambiguous`，由确认弹窗让用户选语言
  兜底，绝不强行修。

### Fixed (第二轮审查)
- **严重健壮性缺陷：cp1252 误读层静默破坏非 CP1252 文本**。原 `encodeBack` 对
  `> 0xFF` 且不在 `CP1252_HIGH` 映射表的字符（阿拉伯文 / 希伯来文 / 泰文 / 西里尔等）
  直接 `out.push(code)`，把 Unicode 码点当字节截断写入，产生可解码但错误的字节序，
  导致**正常阿拉伯文/希伯来文被静默"修"成乱码**（如 نص → `F5 91(J...`），直接违反
  第一原则"正确文本绝不动"。修复：`encodeBack` 的 cp1252 分支对这类字符 `return null`
  令该链失效（latin-1 / gbk 误读层本就对 `> 0xFF` 返回 null，仅 cp1252 旧分支曾漏）。
  新增负例 **N12（阿拉伯文）/ N13（希伯来文）** 固化回归。
- **`lineIsCoherent` 误拒真日文**：原实现把 `han` 与 `kana` 当独立脚本类，遇到
  "漢字+平仮名+片仮名"混排的正常日文行即判为"跨脚本混合垃圾"而拒修，与
  `scriptDominant`（已合并 CJK）口径不一致。修复：合并 han/kana/hkana 为单一 `cjk`
  类，`lineIsCoherent` 现正确接受真日文修复行（CJK 与 cyrillic/hangul 混仍判垃圾）。

### Fixed (第三轮审查)
- **UTF-8 BOM 导致首行被静默跳过**。插件以 `new TextDecoder("utf-8")`（不带
  `ignoreBOM`）解码文件，带 BOM 文件的第一行行首保留 `U+FEFF`；而 `U+FEFF` 不在任何
  误读编码可无损回转的字符集内（latin-1 拒 `>0xFF`、cp1252 不在 `CP1252_HIGH` 映射表、
  GBK 回转表无此码点），三条误读链全部失效 → **整个首行被静默跳过**。首行往往是标题，
  是最重要的一行。修复：`repairLine` 先剥离行首 BOM 再做候选搜索，命中后把 BOM 拼回
  （只修 BOM 之后的乱码，保留文件原有编码标记，不越权改动正文）。新增夹具
  **P13-bom-firstline** 固化回归。
- **性能**：三处等价的安全优化，2 万行 / 449 KB 混合文档从 **3167 ms 降至 911 ms（约 3.5×）**
  （Obsidian 内为同步调用，原先 >2 s 会明显卡顿）：
  1. `TextDecoder` 实例按编码名缓存复用（非流式 `decode` 无状态，可安全复用），
     省掉 3 误读 × 9 真值 × 行数 量级的实例新建。
  2. `repairLine` 内 `dominantScriptOf(decoded, SCRIPT_RATE)` 原先对同一 `decoded`
     计算两次（一次算 `minPlaus`、一次取 `post`），合并为一次。
  3. `repairMojibake` 增加逐行结果缓存：`repairLine` 对给定行是纯函数，而真实文档
     重复行极多（标题、表格行、分隔线、键名），命中即省掉整条候选链扫描。

### Notes (第三轮审查)
- **`charToGbk` 无需补表**（已核实，非缺陷）：以 Node `TextDecoder("gbk")` 全量枚举
  23940 个可解码双字节字符，其中 2148 个不在 `charToGbk` 内（2048 个 PUA 私有区 +
  52 个 CJK 扩展A + 40 个标点 + 8 个 CJK 基本汉字）。但 `charToGbk` 由
  `scripts/gen-encode-tables.py` 以 **Python `gbk` 权威编解码器**生成，Python 侧对这
  2148 个映射经全量枚举**一个都不存在**——它们只是 Node `TextDecoder` 的宽松映射，
  不是真实 GBK 字符，真实文档也不可能含 PUA。已用 2148 个表外字符逐一验证
  「绝不修坏」不变量（宁可不修）全部通过。
- 第三轮探针还验证通过：CRLF 行尾逐字节保留（P14）、修复结果幂等（不二次修改）、
  空串 / 纯换行 / 仅 CR / 单非 ASCII / 纯 FFFD 行 / BOM+FFFD 等 11 类边界输入
  均满足「found=false 则文本逐字符不变」。

### Fixed (第四轮审查)
- **UTF-8 BOM 与正文矛盾时谎报 "UTF-8 100%"**（`src/encoding.ts` → `detectEncoding`）。
  原 BOM 强信号分支见到 `EF BB BF` 就无条件返回 `isUtf8@100`，从未校验 BOM 之后的正文。
  而 BOM 只是"作者声称这是 UTF-8"，不等于正文合法——有些工具会写出 UTF-8 BOM 却跟
  非法 UTF-8 正文（手工拼接字节、半截转换产物）。这类文件被谎报成完全正常的 UTF-8，
  用户永远看不到"它其实是别的编码"，`detectCurrentFile` 的置信度提示就此失去意义。
  影响面核实：`convertFileToUtf8` / `doAutoDetect` / `detectCurrentFile` 三处 `isUtf8`
  分支**均不写文件**，故无数据毁灭路径，属正确性/口径缺陷。修复：对整个字节串做
  `isStrictUtf8` 校验（BOM 本身是合法的 UTF-8 U+FEFF，一并通过即覆盖正文），
  矛盾时不信任 BOM、剥离 BOM 后走候选探测——与无 BOM 分支口径完全一致。
  `encoding.test.mjs` 新增 **#14**（矛盾不谎报 / 与无 BOM 口径一致 / 纯 BOM 空文件不误伤 /
  正常 BOM 不受影响 / BOM+合法 mojibake 仍判 isUtf8 以免阻断 repair 路径），
  编码测试 17 → 18 项。
- **第三轮新增代码实证自校验**（本轮专门覆盖前几轮未触及的探测层/转换层，并回头
  验证第三轮自己加的性能优化没有偷换语义）：解码器缓存 200 轮随机交错调用结果逐位
  一致（`TextDecoder` 非流式 `decode` 确无状态，缓存安全）、修复结果幂等、逐行 memo
  在「单独文档」与「2000 行大文档」中输出一致（memo 语义等价且不跨调用泄漏）。
  探测/解码边界 11 项（截断 BOM / UTF-16LE/BE / UTF-32 识别与显式拒绝 / 不支持标签
  抛错 / 奇数字节 UTF-16 / 字节交换解码）与评分不变量 8 项（空串 / 纯 BOM 不除零 /
  U+FFFD 计坏字符 / 全角 / 西里尔 / 拉丁扩展 / 损坏分析计数）全部通过。

### Changed (第四轮审查)
- 清理纯格式瑕疵：`repair.ts` 导入尾逗号、`main.ts` `detectCurrentFile` 签名与开括号
  同行。行为零变更。

### Notes (第四轮审查)
- **`plausibility` 计入 U+FEFF 属展示层噪音，非缺陷**（已核实，不改）：U+FEFF 不在
  0xFF00-0xFFEF 全角区间内（65279 < 65280），故不计入分子，只进入分母——带 BOM 文件
  的报告分被压小 1 个字符的量级。`plausibility` 仅用于 `RepairResult.score` 展示，
  不参与任何修复判定门槛，故不影响正确性，保持现状避免扰动既有分档。
- **UTF-16BE 奇数字节是零填充而非静默丢弃**（已核实，非缺陷）：字节交换循环写出的
  缓冲等长，尾部落单字节位置留 `0x00`，`TextDecoder` 对不完整尾序列产出 U+FFFD，
  行为与 `utf-16le` 一致（本就在"文件本身已损坏"前提下的合理降级，且转换路径
  一律先备份 + 走确认弹窗）。
- `detectEncoding` 的 UTF-8 BOM 分支现多一次全串严格解码（O(n) 原生调用）。此前该
  分支直接返回，`convertFileToUtf8` 随后又调 `analyzeReplacementDamage` 做同样的一次
  全串解码——本属重复劳动，故新增校验的实际开销很小，换取"不再谎报"的正确性。

### Fixed (第五轮审查)
- **完整性格缺：繁體中文與日文整类无法修复**（`src/repair.ts` → `plausibility`）。
  根因：合理度的汉字命中项原先是单一口径 `isCommonHanzi`（GB2312 一级常用字位图，3755 字），
  而繁體中文與日文常用漢字大量落在该表之外——`繁體中文測試` 的**正确回转**命中率仅
  **0.500**、`日本語テスト` 仅 **0.833**，双双被 0.95 门槛拦死（对照 `中文测试文档` = 1.000
  故正常）。繁體中文與日文是 Obsidian 用户的高频场景，此前整类漏修。
  修复：`plausibility` 新增 `truth` 参数按真值编码**分档**判定（放宽范围与实证依据见下
  Changed）。新增夹具 **P15-traditional-utf8 / P16-japanese-utf8** 固化回归；
  **P03-latin1-sjis** 期望从 `no-harm`（只修好第 1 行）收严为 `repair`（两行完整还原，
  评分 52 → 79）。
- **私用区（PUA）漏网**（`hasLatinAdjacentScript` 的 `nonLatin` 清单）。F6 拉丁邻接门原用
  **枚举式黑名单**判定异文字符，只列 6 段码位区，任何不在清单里的异文都漏过。最致命的是
  U+E000–U+F8FF 私用区——Shift-JIS/Big5/EUC-KR 对「字节对结构合法、但语义未收录」的组合
  （如 SJIS 0xF6 0xDF）会解出 PUA 字符，这类字符既不在旧清单、也不在任何 plausibility
  命中段，于是 `printable`/`plaus` 恰好 0.950 压线、行级/文档级门因「无脚本命中」放行，
  正常德文 `Größe: 42, Preis: 100 €` 被写坏成 `Gr<U+E506>e: ...`，八道门**全部放行**
  （直接违反第一原则）。修复：`nonLatin` 补齐 CJK 兼容漢字 / CJK 扩展 B 及以上 / 谚文 Jamo
  / 私用区 / 西里尔 / 希腊 / 希伯来 / 阿拉伯 / 天城文等共 16 段。刻意**不**覆盖通用标点与
  符号区（U+2000–U+303F、U+20A0–U+2BFF）——它们与拉丁字母相邻是正常形态（`1945 — 1949`），
  算异文会造成误拦。
- **文档级一致性门用「真值编码名义脚本」反查，导致正确修复被整篇拒**。原文由
  `TRUTH_TO_SCRIPT[dominantTruth]` 推名义脚本，而**编码名 ≠ 产物脚本**：cp1251 名义上是
  西里尔编码，却同样能把 0x93/0x94 解成 U+201C/U+201D 智能引号（纯拉丁产物），而候选池
  顺序里 cp1251 排在 cp1252 之前，于是主导真值被记成 cp1251、名义脚本记成 cyrillic，与
  中文锚判为不兼容而整篇拒绝——尽管那条行的修复结果 `"“Hello”"` 本身完全正确。
  改为直接统计**修复后文本的真实主导脚本**，`TRUTH_TO_SCRIPT` 常量及其唯一使用点一并删除。
  修后语义：产物众数脚本与原文锚相符则放行（保住了文档语言身份），产物无脚本命中（纯拉丁）
  则放行（不存在「整篇转成另一种文字系统」的风险）；混入少量异文垃圾时判定反而更严。

### Changed (第五轮审查)
- **`plausibility` 改为按真值编码分档**（`usesWideCjk`）。这是本轮唯一放宽行为的地方，
  放宽到哪些真值有夹具实证、不能随手放宽：
  - **gbk 必须保持严格**（GB2312 一级常用字）。这是压制「任意字节被 gbk 解码出的垃圾候选」
    唯一有效的杠杆：实测 GBK 误读垃圾串的命中率——擔杮岅僥僗僩 **0%**、脏殡耦躔囗疙 **46%**、
    統杅汐汕污汛 **67%**，均低于 0.95 门槛。一旦对 gbk 放宽，垃圾候选与正确候选平手，而
    候选池里 gbk 排序在前，垃圾会抢走胜利（实测 27/27 → **23/27**：俄文被修成
    「脏殡 耦躔囗疙」、希腊字母行被修成「統杅 汐 汕 污 汛」）。
  - **big5 同样不能放宽**。Big5 一/二级字库覆盖 13706 字，对上述垃圾串命中率高达
    **72%–100%**（統杅汐汕污汛 100%），毫无判别力；且 Big5 双字节空间极稠密，俄文/希腊文
    乱码字节也总能被 big5 合法解码，放宽后夹具 P05/P06/P12 回归（27/27 → **24/27**：
    俄文被修成「婄澣 勷臝鳧貲」）。
  - **shift-jis 可以放宽**。SJIS 首字节空间窄（0x81–0x9F / 0xE0–0xFC），俄文/希腊文乱码
    字节几乎无法被合法解码为 SJIS，放宽不会让它们冒用日文身份；而日文常用漢字（語 等）
    不在 GB2312 一级表内，严格判据会把正确的日文回转压到 0.83 而拦死。
  - **utf-8 同样放宽**。utf-8 解码是确定性的，不存在「另一种 utf-8 垃圾候选」与之竞争；
    而繁體中文與日文的 UTF-8 被 Latin-1 误读正是 Obsidian 生态最常见的一类。
  谓词 `usesWideCjk(truth) ? isAnyCjkIdeograph : isCommonHanzi` **只选一次**、不放在字符
  循环里（27 条候选链 × 行数，量级极大）。省略 `truth` 时按宽档计分——该口径仅用于
  `RepairResult.score` 展示，不参与任何候选筛选。
- 清理：删除 `repair.ts` 顶部描述已不存在诊断函数的悬空注释。

### Notes (第五轮审查)
- **P02（原生繁體 Big5 文件）正确地仍然 `found=false`**：本轮放宽**不含** big5，故原生
  Big5 文件被 Latin-1 误读时依旧不修。这不是回归，而是刻意的第一原则取舍——Big5 与 GBK
  双字节空间大量重叠且**没有判别杠杆**，强行修等于赌博。原生 Big5 文件应走「转换」命令
  （编码转换的活），不是二次编码修复的活。
- 本轮以临时实验副本（`src/_repair_exp.ts` + `test/_diff.mjs`）对四种放宽组合做逐夹具
  A/B 取证：base **27/27** → 全真值放宽 **23/27** → utf8+sjis+big5 **24/27** →
  **utf8+sjis 27/27** 且 P03 由 1/2 行升至 2/2 行。结论已固化进 `usesWideCjk` 与新夹具；
  实验副本已删除，`git status` 干净。
- 本轮回归全绿：mojibake **29/29**、encoding 14 项（含第四轮新增 #14）、log 5/5、
  vip-ad **79/79**、`tsc -p tsconfig.json` 0 错误、`main.js` 构建 0 错误；并已核验新谓词
  `isAnyCjkIdeograph` / `usesWideCjk` / `hanHit` 确实出现在产物 `main.js`（2230–2251 行）。
  版本维持 **1.6.1** 未 bump。

### Changed
- `repairLine` 重构为「候选收集 → 择优」结构，门槛/门逻辑集中在收集阶段；导出
  `lineIsCoherent` 供套件判定 ambiguous 类（每行须连贯单脚本，禁第三种混合垃圾）。

## 1.6.1 (2026-09-23)

### Fixed
- **乱码修复误伤正常中文文档**（截图场景：STM32 HAL 的 README 被"修复"成韩文/日文）。
  根因：21791 条 GBK 回转表对常用汉字 100% 命中，混排行（中文 + 英文 + 制表符 +
  箭头）的汉字被 `encodeBack(gbk)` 回转成合法 EUC-KR/Shift-JIS 双字节后，逐行
  独立判定三重门槛全过 → 整篇"误修"成另一种脚本。
  修复：`src/repair.ts` 新增**文档级一致性门**（原文锚定）——统计修前原文的非
  ASCII 字符，某脚本（han/hangul/kana/hkana/cyrillic）命中率 ≥45%（`SCRIPT_RATE`）
  即认定文档"属于"该语言，主导真值（如 `euc-kr`→hangul）必须与文档主导脚本
  （如 han）相容，否则整篇 `found=false` 不改动。门拒时 `repairedLines` 归零，
  调用方 Notice 展示不撒谎。`encodeBack(cp1252)` 高位段未映射字符改按 Latin-1
  直通兜底（Windows-1252 是 Latin-1 超集，这是合法路径，避免把真乱码行整行拒掉）。
- **行级一致性门（文档级门的补强，混排文档的最后防线）**：文档级门在多 CJK
  混排文档（简中 + 繁中 + 日文 + 韩文共存）会失效——没有任何脚本达到 45% 命中率，
  日文行仍会被 `gbk → shift-jis` 修成半角假名垃圾、半角假名原文行可被修成汉字。
  现为每行独立加门：修前行有明确主导脚本时，修后必须仍是同一脚本，否则该行
  原样保留。半角假名（0xFF61-0xFF9F）从 kana 单列为 `hkana` 类，防止日文旧文件
  被整段"修复"成汉字。
- 回归：`test/encoding.test.mjs` 新增 #10b（混排正常文档不被误修成韩文/日文）、
  #10c（多 CJK 混排文档零改动）、#10d（半角假名行不被误修），编码测试 13 → 16 项，
  VIP 测试 79 项全过，tsc 通过，产物 `main.js` 已确认打入门逻辑。对抗探针 5 场景
  （真乱码仍修 / 混排零改动 / 半角假名零改动 / 中文文档夹只修真乱码行 / 截图
  场景零改动）全部符合预期——**真乱码修复能力保留，正常文本零改动**。

## 1.6.0 (2026-09-23)

### Added
- **VIP 功能门禁**（`src/vip/gate.ts`）：非 VIP 锁定 3 项增强功能
  - 「扫描并转换当前文件夹」命令：命令名加（VIP）标记；点击时**不执行功能本体**，
    提示原因后直接打开激活弹窗。命令保持注册（可发现性 + 付费披露）。
  - 界面语言后 6 种（ru / fr / de / es / pt-BR / ar）：下拉项标记（VIP）并禁用
    （操作原生 `<option>.disabled`，DropdownComponent 无 per-option API）；
    若当前语言被锁则回落 `en`，真实选择不落盘，重新激活后可原样选回。
  - 「导入时自动转换为 UTF-8」：默认关 + 非 VIP 置灰显示为关 + `handleAutoDetect`
    运行时再拦一道（防旧 data.json 残留 true 或绕过 UI 改配置生效）。
  - 清单写成**显式常量**而非 `slice(-6)`：新增语言时必须到 gate.ts 表态是否收费，
    由回归用例「VIP 语言 = LOCALES 尾部 6 项」兜底防漂移。
- i18n：10 语言新增 6 个 key（`vip.gate.suffix/lockedNotice/localeDesc/autoConvertDesc/overview/unlocked`）。
- 回归测试：`test/vip-ad.test.mjs` 新增 18 条门禁用例（42 → 60 条）。

### Changed
- **文档重组**：所有开发相关文档集中到 `开发文档目录`（`CHANGELOG.md`、`CONTRIBUTING.md` 从根目录迁入）；根目录仅保留 `README.md`（项目简介）、`USER_GUIDE.md`（用户手册，新增）与 `LICENSE`。
- **付费披露（合规必填）**：Obsidian Developer Policies 允许付费功能，但要求
  ① README 明确写出价格与受限功能；② 目录 listing 选择 "Optional payments"。
  两份 README 新增 VIP 小节、命令表标注（VIP），Disclosure 由"所有功能免费"
  改为"部分功能需要付费"；`USER_GUIDE.md` 同步设置项与命令的 VIP 标注。

## 1.5.0 (2026-09-17)

### Added
- **VIP 激活模块**（`src/vip/`，移植自 desktoppet auth/）：
  - Ed25519 离线激活码验签（`vip.ts`）：通用码（到期日）/专用码（绑定设备
    SHA-256 指纹）两种格式；包内只有公钥，私钥在作者侧 `.vip-secret`（不进
    git、不进包）。与 desktoppet 复用同一密钥对，激活码互通。
  - 完整性指纹 `seal.ts`：防篡改 data.json + 时间高水位（最多骗回 24h），
    VIP 过期后仍推进落盘，回拨系统时钟无法恢复有效期。
  - 激活弹窗 `activate-modal.ts`：激活码输入容错（大小写/连字符/空格），
    激活成功写盘并刷新设置面板。
  - 设置面板新增「VIP 支持」组：激活状态、设备 ID（专用码签发依据）。
- **支持者横幅（广告模块）**（`src/ad/ad-banner.ts`，移植自 desktoppet
  pet/AdBanner.ts）：非 VIP 每日最多展示一次、可关闭；VIP 永久隐藏。
  频控逻辑纯函数化（`shouldShowAd`/`markAdShown`），可测试。
- **签发工具**：`scripts/generate-vip-code.mjs`（+ `scripts/lib/vip-code.mjs`）。
  默认只签发不碰被跟踪文件；`--rotate-key` 显式轮换密钥并同步公钥。
- **回归测试**：`test/vip-ad.test.mjs` 42 条（webcrypto 自签密钥走完整验签、
  seal 篡改/回拨、广告频控），并入 `npm test`（`test:vip`，ESM 打包）。
- i18n：10 语言新增 26 个 key（VIP 设置/激活弹窗/横幅/设备 ID）。

### Changed
- `data.json` 新增平级字段：`deviceId` / `vip` / `seal` / `adState`（与
  settings 平级；seal 语义要求 VIP 过期后仍推进，不能嵌套）。
- 横幅样式并入 onload 注入的自包含 CSS。

## 1.4.6 (2026-09-17)

### Fixed
- **文件夹扫描范围计算错误**：无活动文件时 `getAbstractFileByPath("")` 返回 null（根路径是 `/`），"扫描整个 vault" 静默失效；活动文件在 vault 根时正则不剥文件名，扫描目标为 0。改用 `TFile.parent`（d.ts 验证过的 API）取父目录，无活动文件时回退整个 vault。
- **文件夹扫描违背安全设计**：批量转换曾传 `force=true`，低置信度文件被静默强转，与 README "低置信度只报告不静默强转" 矛盾。现传 `force=false`，低置信度文件跳过，原因输出到控制台（`skippedList`）。
- **onload 日志恢复竞态**：日志异步恢复完成前若已有新记录入列，`this.records = rs` 会把它们冲掉。改为 `rs.concat(this.records)`。
- **自动转换并发去重**：create+modify 双事件/连续修改会对同一文件并发触发转换，导致重复备份与重复写回。新增 in-flight 集合去重。

### Changed
- 移除 backup.ts 未使用的 `TFolder` 导入。

## 1.4.5 (2026-09-17)

- **补齐评分白名单（v1.4.4 的残留盲区）**：技术文档大量使用制表符画图
  （`┌ ─ ┐ │ └`，U+2500-25FF）与箭头（`→`，U+2190-21FF），这些区段不在
  "可打印"白名单内，正确的 GBK 解码被扣到 0.96-0.99，cp1252 乱码恰为
  1.0000 反超——真实事故：3 个 GBK 文件被以 `cp1252@100%`/`big5@100%`
  写成乱码（v1.4.4 已修复的 cp950 兜底 bug 的同族问题，user_SPL 文件
  差距仅 0.0051）。
- 白名单新增：U+20A0-20CF（货币）、**U+2100-27BF（字母符号/箭头/数学/
  带圈数字/罗马数字/制表符/几何图形，GBK 全覆盖的主力区）**、
  U+FE30-FE4F（CJK 竖排）；注音符号并入 0x3040-312F（Big5 常见）。
- 用 4 个真实事故备份字节回归验证：全部识别为 `gbk@100%`。
- 新增回归测试 #13（制表符/箭头密集 GBK 文档）。

## 1.4.4 (2026-09-17)

- **修复数据毁灭级编码误判**（真实事故：4 个 GBK 文件被"以 cp950 置信度 100%"
  转换成 Latin-1 风格乱码写回）。三环根因：
  1. `cp950`/`cp932`/`cp949` 不是 WHATWG TextDecoder 的合法标签（构造即抛
     RangeError），此前候选编码表混入这些 IANA 别名；
  2. `decodeWithEncoding` 对抛错**静默退化成逐字节 Latin-1 兜底**——产出的
     cp1252 风格乱码完全可打印，评分反而拿满分；
  3. 评分白名单漏掉 CJK 标点区（`。`U+3002、`「`U+300C、`—`U+2014 等），
     正确的 GBK 解码被扣分（0.998），输给兜底乱码的 1.0。
- 修复：
  1. 候选编码表只保留合法标签（cp950→big5、cp932→windows-31j、cp949→windows-949）；
  2. **删除 Latin-1 静默兜底**：不支持的编码显式抛错 → 转换失败 → 进失败日志，
     绝不产出乱码内容（新增 `isSupportedEncoding` 导出）；
  3. 评分补齐 0x2000-0x206F（常规标点）与 0x3000-0x303F（CJK 标点）区段；
  4. 候选比较加 0.5% 有效优势门槛：单字节编码（iso-8859-1 能把任意字节解成
     满分可打印 Latin）不得以微小分差反超多字节 CJK 编码。
- 新增回归测试 #11/#12：GBK 文件必须识别为 gbk@≥99% 并无损解码；非法标签必须抛错。
- 教训：**任何"静默兜底"都是数据毁灭的温床**——失败要响亮，宁可报错绝不产出错误内容。

## 1.4.3 (2026-09-17)

- **全面代码审计**（起因：用户质问"为什么老出弱智 bug"），用 tsc strict 首次全量类型检查，查出并修复 **4 个关键缺陷 + 若干健壮性问题**：
  1. **`vault.write()` 不存在**（第 4 个编造 API，正确为 `vault.modify()`）——
     1.4.1 后看似"成功"的转换实际全部在写回步骤失败（备份成功、内容没写入）；
  2. **`vault.readBinary()` 返回 `ArrayBuffer`** 而非代码假设的 Uint8Array——
     真机上 BOM 检测等字节索引全部拿到 undefined；已在边界统一 `new Uint8Array()` 包装；
  3. **点开头隐藏路径不在 vault 索引**：`getAbstractFileByPath(".code-converter-backups"/".code-converter.log")`
     永远返回 null → ensureDir 反复 createFolder 抛 "Folder already exists."（转换全失败）、
     appendToFile 每次当空文件写（4 条日志只活 1 条）。全部改用 `vault.adapter.exists/read`，
     并为日志写入加**串行队列**；
  4. **`new Notice(msg, { timeout })` 签名错误**（实际为 `duration?: number`）→ 5 处改数字；
- 其他修复：`backupFile` 改 `adapter.writeBinary`（write 只收 string，Uint8Array 属类型契约外）；
  UTF-32 文件明确拒绝转换（TextDecoder 不支持，原先会产出乱码静默写回）；
  settings.ts 不存在的 `LocaleCode` 类型修正；confirm-modal `innerHTML`→`textContent`、
  转换异常时弹窗不再卡死；死导入/死代码清理；文件夹扫描 `failed` 类型修正。
- **流程修正**：`npm run typecheck`（tsc strict）并入 `npm test`（现共 10 单测 + 4 日志冒烟 + 全量类型检查）；
  推翻"tsc 在 Windows 不可用"的旧结论（`tsc -p tsconfig.json` 正常，之前是调用方式问题）。
- 根因分析：esbuild 只转译不检查类型 → 类型/ API 错误被静默放过；测试 mock 只覆盖纯
  逻辑 → vault 调用链无真机验证。双管齐下（typecheck 入链 + adapter 层冒烟）堵漏。

## 1.4.2 (2026-09-17)

- **修复日志写不出来：日志文件路径被误当目录创建**
  - `appendToFile` / `exportLog` 对**文件路径**调了 `ensureDir`，`vault.createFolder`
    把 `.code-converter.log` 建成了空文件夹，随后写入必然失败且被 `catch(() => {})`
    静默吞掉（用户 vault 实测确认）
  - 现在只对**父目录**做 ensureDir（新增 `dirname()` 纯字符串实现）
  - 已删除用户 vault 中被误建的空文件夹
- 固化回归测试：`test/_log-smoke.mjs`（4 断言：根级/嵌套写入、不再误建目录），
  `npm test` 现在串联 `test:log`（共 14 项检查）

## 1.4.1 (2026-09-17)

- **修复关键 bug：`vault.getAbstractFile is not a function`**
  - `backup.ts` / `log.ts` 共 8 处调用了不存在的 `vault.getAbstractFile()`，
    正确 API 为 `vault.getAbstractFileByPath()`（已对照 obsidian.d.ts 核实）
  - 该 bug 导致**所有**转换在备份步骤必然失败（用户实测截图确认），且日志文件
    `.code-converter.log` 从未成功写入——两处均用同一假 API
- **失败日志落盘**（新能力）：失败不再只弹转瞬即逝的通知
  - `ConversionRecord` 扩展 `status`（ok/failed）与 `error` 字段
  - 新增 `makeFailureRecord()`；单文件转换 / 导入自动转换 / 文件夹扫描 / 乱码修复
    四条路径的失败统一进 内存 + 控制台（`[code-converter] failure:`）+ 日志文件
  - Markdown 导出表格新增"状态 / 错误"列；失败通知停留时间延长到 8 秒
- 教训沉淀：测试 mock 只覆盖了 encoding/repair 纯逻辑，未覆盖 vault 调用链——
  本次以 Proxy 万能 mock 补做运行时冒烟；再次强调所有 Obsidian API 必须对照
  obsidian.d.ts 验证（本项目第三次踩编造 API 坑）

## 1.4.0 (2026-09-17)

- 新增**乱码修复工具**（实验性）：修复"二次编码"乱码（乱码已烤进合法 UTF-8 内容）
  - 三条修复链：`latin-1 → gbk/…`（ÖÐÎÄ 型）、`cp1252 → …`、`gbk → utf-8`（涓枃 型）
  - 内置 Unicode→GBK 编码回转表（21791 条目）+ GB2312 一级常用字位图（3755 字）
  - 三重质量门槛：可打印比例 / 常用字命中率 / 单一脚本主导；平手优先 UTF-8 链
  - **逐行修复**：失败行保持原样；含 U+FFFD 的内容标记不可恢复
  - 安全阀：仅限合法 UTF-8 文件 / 确认弹窗预览 / 先备份 / 进日志 / 防回环
  - 新命令"修复当前文件中的乱码"，10 语言文案齐备
  - 测试 7 → 10 项（新增链A/链B 恢复 + 误伤防护）
  - 修复 ar.ts 历史缺 key 问题（logEmpty 等 9 键 + 俄语残留词），新增 `npm run locales` 校验
  - 详见 `REPAIR.md`

## 1.3.0 (2026-09-17)

- 新增"上游损坏检测"：识别合法 UTF-8 但内容已损坏的文件（U+FFFD 替换字符超标）
  - 新增 `analyzeReplacementDamage()`：统计合法 UTF-8 文件中 U+FFFD（�）数量与占比
  - 四个入口接入警告：导入自动检测 / 转换当前文件 / 检测报告 / 批量转换汇总
  - 设置面板新增"损坏警告阈值（%）"（默认 5%，0 = 关闭）
  - 10 国语言文案同步补齐（`notice.damagedUtf8` / `notice.folderDamaged` / `setting.damageWarn.*`）
  - 明确告知用户：此类文件原始字节已丢失，编码转换无法修复，插件不转换是正确行为
- 修复插件加载失败三连（`export default` 缺失 / es2022 语法 / 编造 API `addCss`）
- 测试 6 → 7 项（新增 U+FFFD 损坏检测用例）
- 文档新增 `TROUBLESHOOTING.md`（排查清单 + 经验教训）

## 1.2.0 (2026-09-17)

- 文档重组
  - `开发文档目录` 扩展为完整开发文档：新增 `ENCODINGS.md`（22 编码 + 评分 + 置信度）、`I18N.md`（多语言 + RTL 实现）、`LOGGING.md`（日志与导出）、`DEVELOPMENT.md`（构建/测试/版本控制）、`README.md`（索引 + 项目结构）
  - `README.md` 精简为用户向说明，开发信息全部迁到 `开发文档目录`
  - 命令面板与设置项补充"导出转换日志"条目
- 版本升级 1.1.0 → 1.2.0

## 1.1.0 (2026-09-17)

- 多编码池 + 界面 i18n（10 国语言）+ RTL 支持
  - 候选编码池从 6 种扩到 22 种，覆盖 CJK / 西里尔 / 拉丁 / 希腊 / 希伯来 / 阿拉伯
  - 评分区段扩到 10 大语种 Unicode 区（希腊、西里尔、希伯来、阿拉伯、日假名、CJK、韩文）
  - 新增 10 国语言界面：zh-CN / en / ja / ko / ru / fr / de / es / pt-BR / ar
  - 设置面板内置语言选择器，切换即时刷新文案
  - 界面文案统一走 `t(key)` + 占位符
  - RTL：`isRtl()` 方向判定（ar），settings / confirm-modal 按语言设 `dir`，CSS 翻转文字/间距/按钮行
  - 构建通过，编码核心单测 6/6 通过

## 1.0.0 (2026-09-17)

- 首个版本
  - 编码探测：BOM 识别 + 严格 UTF-8 校验 + 候选编码评分（GBK/Big5/Shift-JIS/EUC-JP/CP932/ISO-8859-1）
  - 三个命令：转换当前文件 / 扫描转换当前文件夹 / 仅检测
  - 安全阀：置信度阈值、转换前备份、事件防回环、去 BOM
  - 设置面板：自动转换开关、阈值、备份目录、去 BOM 开关
  - esbuild 打包脚本（外部化 obsidian 与 Node 内置模块）
