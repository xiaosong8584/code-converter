/**
 * 日志模块：收集转换记录（内存 + 可选追加到仓库日志文件），并提供导出。
 *
 * - appendRecord：把一条记录加入内存队列；若 logFile 非空则追加到该文件。
 * - 重启恢复：onload 时把日志文件读回内存，保证"导出"能拿到历史。
 * - 导出：JSON（机器可读）/ Markdown 表格（Obsidian 内可读）两种格式。
 *
 * ⚠️ 关键实现约束（踩坑记录）：
 * 1. 日志/备份均为点开头路径（.code-converter/ 下）——**vault 索引跳过隐藏路径**，
 *    getAbstractFileByPath 对它们永远返回 null。存在性判断必须用 vault.adapter.exists，
 *    读内容必须用 vault.adapter.read（改回 TFile/vault.read 会静默丢失已有内容）。
 * 2. adapter.write 覆盖整个文件，Vault 没有 append API——追加 = 读旧 + 写新，
 *    并发调用会互相覆盖（4 条只活 1 条的教训），因此用写队列串行化。
 */

import { Notice, Vault } from "obsidian";
import { ConversionRecord } from "./types";
import { t } from "./i18n";

const PLUGIN_NAME = "Code Converter";

/** 把时间戳格式化为人类可读（本地时区） */
function fmtTime(ts: number): string {
	return new Date(ts).toLocaleString();
}

/** 渲染成 Markdown 表格 */
export function toMarkdown(records: ConversionRecord[]): string {
	if (!records.length) return "# Code Converter 日志\n\n（空）\n";
	const lines: string[] = [];
	lines.push("# Code Converter 日志");
	lines.push("");
	lines.push(`> 共 ${records.length} 条记录（按时间倒序）`);
	lines.push("");
	lines.push("| 时间 | 状态 | 文件 | 原编码 | 置信度 | 备份 | 错误 |");
	lines.push("|------|------|------|--------|--------|------|------|");
	[...records].reverse().forEach((r) => {
		const status = r.status === "failed" ? "❌ 失败" : "✅ 成功";
		lines.push(
			`| ${fmtTime(r.timestamp)} | ${status} | ${r.file} | ${r.fromEncoding} | ${r.confidence}% | ${r.backupPath || "-"} | ${r.error || "-"} |`
		);
	});
	return lines.join("\n");
}

/** 渲染成 JSON */
export function toJson(records: ConversionRecord[]): string {
	return JSON.stringify(
		[...records].reverse().map((r) => ({
			...r,
			time: new Date(r.timestamp).toISOString()
		})),
		null,
		2
	);
}

/** 取路径的父目录（纯字符串处理；根级文件返回空串） */
function dirname(p: string): string {
	const idx = p.lastIndexOf("/");
	return idx > 0 ? p.slice(0, idx) : "";
}

/**
 * 确保目录存在。
 * 点开头目录（如 .code-converter/backups）不在 vault 索引里，getAbstractFileByPath
 * 永远返回 null → 不能用它判断；必须用 adapter.exists（磁盘层，目录也返回 true）。
 * createFolder 的 "Folder already exists." 异常（索引/缓存滞后时发生）静默忽略。
 */
async function ensureDir(vault: Vault, path: string): Promise<void> {
	if (!path) return;
	const parts = path.split("/").filter(Boolean);
	let cur = "";
	for (const p of parts) {
		cur = cur ? `${cur}/${p}` : p;
		if (!(await vault.adapter.exists(cur))) {
			try {
				await vault.createFolder(cur);
			} catch {
				/* 目录已存在（索引滞后）→ 继续用 */
			}
		}
	}
}

/** 把记录追加到日志文件（JSON Lines 格式，便于增量与解析）——实际执行体 */
async function doAppendToFile(
	vault: Vault,
	logPath: string,
	record: ConversionRecord
): Promise<void> {
	if (!logPath) return;
	const line = JSON.stringify(record) + "\n";
	// logPath 是"文件"，ensureDir 必须作用于其父目录（v1.4.1 踩坑：对文件路径建目录）
	await ensureDir(vault, dirname(logPath));
	// 追加：读旧 + 写新（Vault 没有 append API）
	// 隐藏路径不在 vault 索引里，必须走 adapter 层读写（getAbstractFileByPath 永远 null）
	let existing = "";
	if (await vault.adapter.exists(logPath)) {
		existing = await vault.adapter.read(logPath);
	}
	await vault.adapter.write(logPath, existing + line);
}

/** 写队列：串行化所有追加，避免并发"读旧-写新"互相覆盖 */
let writeQueue: Promise<unknown> = Promise.resolve();

/** 把记录追加到日志文件（排队执行，返回本条写完的 Promise） */
export function appendToFile(
	vault: Vault,
	logPath: string,
	record: ConversionRecord
): Promise<void> {
	const task = writeQueue.then(() => doAppendToFile(vault, logPath, record));
	writeQueue = task.catch(() => {}); // 队列不因单条失败而卡死
	return task;
}

/** 从日志文件恢复记录到内存（同样必须走 adapter 层） */
export async function loadFromFile(
	vault: Vault,
	logPath: string
): Promise<ConversionRecord[]> {
	if (!logPath) return [];
	if (!(await vault.adapter.exists(logPath))) return [];
	const text = await vault.adapter.read(logPath);
	const out: ConversionRecord[] = [];
	for (const raw of text.split("\n")) {
		if (!raw.trim()) continue;
		try {
			const r = JSON.parse(raw) as ConversionRecord;
			if (r && typeof r.file === "string") out.push(r);
		} catch {
			/* 跳过坏行 */
		}
	}
	return out;
}

/** 导出日志为 vault 内文件，返回路径 */
export async function exportLog(
	vault: Vault,
	records: ConversionRecord[],
	format: "json" | "markdown",
	exportPath: string
): Promise<string> {
	const body = format === "json" ? toJson(records) : toMarkdown(records);
	// exportPath 是"文件"，ensureDir 作用于父目录（同 appendToFile，勿对文件路径建目录）
	await ensureDir(vault, dirname(exportPath));
	await vault.adapter.write(exportPath, body);
	new Notice(`[${PLUGIN_NAME}] ${t("notice.logExported", { p: exportPath })}`);
	return exportPath;
}

/** 默认导出文件名（带时间戳，放仓库根） */
export function defaultExportName(format: "json" | "markdown"): string {
	const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
	return format === "json"
		? `code-converter-log-${ts}.json`
		: `code-converter-log-${ts}.md`;
}
