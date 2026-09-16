/**
 * 备份模块：转换前把原文件字节存入备份目录，出问题可回滚。
 * 使用 adapter.readBinary / writeBinary，路径基于仓库根。
 */

import { TFile, TFolder, Vault, Notice } from "obsidian";
import { ConversionRecord } from "./types";

/** 把仓库内相对路径安全化为文件名 */
function safeName(relPath: string): string {
	return relPath.replace(/[\\/]+/g, "__").replace(/^__/, "");
}

/** 备份原文件到 backupDir（同名加时间戳避免覆盖） */
export async function backupFile(
	vault: Vault,
	backupDir: string,
	relPath: string
): Promise<string> {
	const file = vault.getAbstractFile(relPath);
	if (!file) throw new Error(`file not found: ${relPath}`);

	const bytes = await vault.readBinary(file as TFile);
	const time = new Date().toISOString().replace(/[:.]/g, "-");
	const target = `${backupDir}/${safeName(relPath)}.${time}.bak`;

	// 确保备份目录存在（Obsidian 写入会自动建父目录，但保险起见）
	await ensureDir(vault, backupDir);
	await vault.adapter.write(target, new Uint8Array(bytes));
	return target;
}

/** 递归确保目录存在 */
async function ensureDir(vault: Vault, path: string): Promise<void> {
	const existing = vault.getAbstractFile(path);
	if (existing) return;
	// 逐级创建
	const parts = path.split("/").filter(Boolean);
	let cur = "";
	for (const p of parts) {
		cur = cur ? `${cur}/${p}` : p;
		if (!vault.getAbstractFile(cur)) {
			await vault.createFolder(cur);
		}
	}
}

/** 记录一次转换（追加到日志，便于审计） */
export function logConversion(record: ConversionRecord): void {
	console.log("[code-converter]", JSON.stringify(record));
}

/** 生成转换记录 */
export function makeRecord(
	relPath: string,
	from: string,
	confidence: number,
	backupPath: string
): ConversionRecord {
	return {
		file: relPath,
		fromEncoding: from,
		toEncoding: "utf-8",
		confidence,
		backupPath,
		timestamp: Date.now()
	};
}

/** 提示备份已生成 */
export function notifyBackup(backupPath: string): void {
	new Notice(`[Code Converter] 已备份原文件 → ${backupPath}`);
}

/** 转换完成后提示 */
export function notifyConverted(file: string, from: string, confidence: number): void {
	new Notice(`[Code Converter] ${file}: ${from} → UTF-8（置信度 ${confidence}%）`);
}

export { safeName };
