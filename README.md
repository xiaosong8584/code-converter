# Code Converter

> Obsidian 插件：自动识别仓库中非 UTF-8 编码的文件，并在**安全保护**前提下转换为 UTF-8。

Obsidian 内部把所有笔记按 UTF-8 读取。一旦仓库里混入 GBK / Big5 / Shift-JIS / UTF-16 等旧编码文件，打开就会乱码。本插件提供**探测 → 备份 → 转换 → 去 BOM** 的完整闭环，并内置多重"安全阀"，避免误判造成不可逆损坏。

---

## 核心特性

- ✅ **严格 UTF-8 校验**：合法 UTF-8 文件（含纯 ASCII）直接放行，零风险。
- ✅ **BOM 强信号识别**：UTF-8 / UTF-16 LE / UTF-16 BE / UTF-32 的 BOM 直接信任。
- ✅ **候选编码评分探测**：对无 BOM 的非 UTF-8 文件，在 GBK / Big5 / Shift-JIS / EUC-JP / CP932 / ISO-8859-1 间做"解码质量评分"，取置信度最高者。
- ✅ **置信度保护**：低于阈值（默认 80%）的文件绝不静默强转，弹出确认框由人工决策。
- ✅ **转换前自动备份**：原文件字节存入备份目录，可随时回滚。
- ✅ **去 UTF-8 BOM**：转换后按需去掉 BOM，更干净。
- ✅ **导入自动检测**（默认关闭）：新建/导入文件时自动转，带防回环保护。
- ✅ **三个命令**：转换当前文件 / 扫描转换当前文件夹 / 仅检测（不改动）。

---

## 安装

### 方式一：本地开发安装（推荐）

1. 构建：
   ```bash
   cd CodeConverter
   npm install
   npm run build      # 生成 main.js
   ```
2. 把插件目录复制到你的 Vault：
   ```
   你的Vault/.obsidian/plugins/code-converter/
   ├── main.js
   ├── manifest.json
   └── versions.json
   ```
3. 在 Obsidian 中开启：`设置 → 第三方插件 → 开发者模式` 打开，然后启用 `Code Converter`。

### 方式二：热重载开发

```bash
npm run dev   # 以 watch 模式构建，改 src 自动重打包到 main.js
```

---

## 使用

### 命令面板

`Ctrl/Cmd + P` 打开命令面板，输入以下任一：

| 命令 | 说明 |
|------|------|
| `Code Converter: 把当前文件转换为 UTF-8` | 探测当前文件；非 UTF-8 且高置信度直接转，低置信度弹确认框 |
| `Code Converter: 扫描并转换当前文件夹` | 把当前文件所在目录下的全部 .md 非 UTF-8 文件转掉 |
| `Code Converter: 检测当前文件编码` | 只报告编码 / BOM / 置信度 / 预览，不改动文件 |

### 设置项

`设置 → Code Converter`：

- **导入时自动转换为 UTF-8**：新建/导入时静默转（默认关）。
- **置信度阈值（%）**：低于此值需人工确认，默认 80。
- **转换前自动备份**：默认开，强烈建议保持。
- **备份目录**：默认 `.code-converter-backups`。
- **转换时去除 UTF-8 BOM**：默认开。

---

## 安全机制（为什么不会毁文件）

1. **合法 UTF-8 绝不触碰**：`TextDecoder('utf-8', {fatal:true})` 通过即视为已安全。
2. **置信度门槛**：候选编码评分低于阈值 → 标记 `needsManualConfirm`，自动模式只报告不转换；手动模式弹框由你勾选"强制转换"才动手。
3. **先备份再改**：每次转换前把原始字节写进备份目录（带时间戳，不覆盖）。
4. **防事件回环**：插件自己写文件会触发 `modify`，用 `selfWritten` 时间戳标志位跳过自触发，避免死循环。
5. **短文件谨慎**：字节数过少时评分不稳，自动模式倾向只报告。

---

## 架构

```
src/
├── main.ts            插件入口：命令注册 / 设置面板 / 事件监听 / 防回环
├── settings.ts        设置面板 UI
├── confirm-modal.ts   低置信度确认弹窗（安全阀）
├── encoding.ts        编码探测核心：BOM / UTF-8 校验 / 候选评分
├── convert.ts         转换编排：探测→备份→解码→去BOM→写回
├── backup.ts          备份模块
├── types.ts           类型与默认设置
└── build/
    └── build.mjs      esbuild 打包脚本（外部化 obsidian / node 内置）
```

数据流：

```
readBinary(原始字节)
   └─► detectEncoding
        ├─ BOM?  ──► 信任
        ├─ 严格UTF-8? ──► 放行
        └─ 非UTF-8 ──► 候选编码评分 ──► 置信度
                              ├─ 高 ──► 备份 ──► 解码 ──► 去BOM ──► vault.write
                              └─ 低 ──► 弹确认框 ──► (用户强制) ──► 同上
```

---

## 回滚

转换前生成的备份位于 `备份目录/<文件名>.<时间戳>.bak`。若转换后发现内容不对，把该 `.bak` 复制回原路径即可还原。

## 限制

- 编码识别本质是概率性的：短文件（< 200 字节）或纯数字文件易误判——务必保持"转换前备份"开启。
- 浏览器 `TextDecoder` 对 `gbk` 等编码的支持取决于运行时的 Intl-ICU；Obsidian 桌面版（Electron）通常完整支持。

## License

MIT
