#!/usr/bin/env node
/**
 * 文档生成脚本：从源码自动提炼，输出 docs/ARCHITECTURE.md。
 *
 * 它扫描 src/ 下所有 .ts 文件，解析 export 的 class/function，
 * 生成一份"代码索引 + 命令清单"，让架构随代码演进自动更新。
 *
 * 用法：node scripts/gen-doc.mjs
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";

const SRC = join(process.cwd(), "src");
const OUT_DIR = join(process.cwd(), "docs");
const OUT = join(OUT_DIR, "ARCHITECTURE.md");

/** 从一段 TS 源码里挑出 export 的顶层类/函数名 */
function extractExports(code) {
	const classes = [...code.matchAll(/export\s+class\s+(\w+)/g)].map((m) => m[1]);
	const funcs = [...code.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map((m) => m[1]);
	const consts = [...code.matchAll(/export\s+const\s+(\w+)/g)].map((m) => m[1]);
	return { classes, funcs, consts };
}

/** 读取文件头注释（JSDoc 块）作为模块摘要 */
function extractHeaderDoc(code) {
	const m = code.match(/^\/\*\*([\s\S]*?)\*\//);
	if (!m) return "";
	return m[1]
		.split("\n")
		.map((l) => l.replace(/^\s*\*?\s?/, ""))
		.filter((l) => l && !l.startsWith("@"))
		.join("\n")
		.trim();
}

function main() {
	const files = readdirSync(SRC)
		.filter((f) => f.endsWith(".ts"))
		.map((f) => join(SRC, f))
		.sort();

	const sections = files.map((f) => {
		const code = readFileSync(f, "utf8");
		const name = basename(f);
		const doc = extractHeaderDoc(code);
		const exp = extractExports(code);
		const lines = [];
		lines.push(`### \`${name}\``);
		if (doc) lines.push("", doc, "");
		if (exp.classes.length) lines.push(`- 导出类：${exp.classes.join(", ")}`);
		if (exp.funcs.length) lines.push(`- 导出函数：${exp.funcs.join(", ")}`);
		if (exp.consts.length) lines.push(`- 导出常量：${exp.consts.join(", ")}`);
		return lines.join("\n");
	}).join("\n\n");

	const doc = `# 代码架构索引（自动生成）

> 本文档由 \`scripts/gen-doc.mjs\` 自动从 \`src/\` 提炼生成，请勿手改。
> 重新生成：\`node scripts/gen-doc.mjs\`

生成时间：${new Date().toISOString()}

## 模块清单

${sections}

## 数据流

\`\`\`
readBinary(原始字节)
   └─► detectEncoding
        ├─ BOM?      ─► 信任 BOM 编码
        ├─ 严格UTF-8?─► 放行（不改动）
        └─ 非UTF-8   ─► 候选编码评分 ─► 置信度
                              ├─ 高 ─► 备份 ─► 解码 ─► 去BOM ─► vault.write
                              └─ 低 ─► 弹确认框 ─► (用户强制) ─► 同上
\`\`\`
`;

	if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
	writeFileSync(OUT, doc, "utf8");
	console.log(`[gen-doc] 已生成 ${OUT}，共索引 ${files.length} 个模块。`);
}

main();
