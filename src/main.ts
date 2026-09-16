/**
 * Code Converter — 主插件入口
 *
 * 职责：
 * 1. 注册命令：手动转换当前文件、扫描并转换指定文件夹
 * 2. 注册设置面板
 * 3. 监听文件 create/modify，对非 UTF-8 文件做受保护转换（可关）
 * 4. 自触发事件防回环（避免插件写文件又触发自己）
 */

import {
	Notice,
	Plugin,
	TAbstractFile,
	TFile
} from "obsidian";

import { CodeConverterSettingTab } from "./settings";
import { EncodingConfirmModal } from "./confirm-modal";
import { convertFileToUtf8, convertFilesToUtf8 } from "./convert";
import { detectEncoding, decodeWithEncoding } from "./encoding";
import {
	CodeConverterSettings,
	DEFAULT_SETTINGS
} from "./types";

const PLUGIN_NAME = "Code Converter";

export class CodeConverter extends Plugin {
	settings: CodeConverterSettings = { ...DEFAULT_SETTINGS };

	// 自触发保护：记录"本插件刚写过的文件 + 时间戳"，监听器据此跳过
	private selfWritten = new Map<string, number>();
	private static SELF_TTL_MS = 2000;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.addSettingTab(new CodeConverterSettingTab(this.app, this));

		// ---------- 命令：转换当前文件 ----------
		this.addCommand({
			id: "cc-convert-current",
			name: "把当前文件转换为 UTF-8",
			callback: () => {
				this.convertCurrentFile().catch((e) =>
					new Notice(`${PLUGIN_NAME}: ${(e as Error).message}`)
				);
			}
		});

		// ---------- 命令：扫描并转换当前文件夹 ----------
		this.addCommand({
			id: "cc-convert-folder",
			name: "扫描并转换当前文件夹（非 UTF-8 → UTF-8）",
			callback: () => {
				this.convertCurrentFolder().catch((e) =>
					new Notice(`${PLUGIN_NAME}: ${(e as Error).message}`)
				);
			}
		});

		// ---------- 命令：检测（仅报告，不转换）----------
		this.addCommand({
			id: "cc-detect-current",
			name: "检测当前文件编码（只报告）",
			callback: () => {
				this.detectCurrentFile().catch((e) =>
					new Notice(`${PLUGIN_NAME}: ${(e as Error).message}`)
				);
			}
		});

		// ---------- 监听：导入自动检测（默认关闭） ----------
		this.registerEvent(
			this.app.vault.on("create", (f: TAbstractFile) => {
				if (f instanceof TFile && f.extension === "md") {
					this.handleAutoDetect(f);
				}
			})
		);
		this.registerEvent(
			this.app.vault.on("modify", (f: TAbstractFile) => {
				if (f instanceof TFile && f.extension === "md") {
					this.handleAutoDetect(f);
				}
			})
		);

		// 注册清理：记录转换日志到内部集合（可后续扩展为导出）
		this.addSettingSection();
	}

	async onunload(): Promise<void> {
		// 无需额外清理
	}

	private addSettingSection(): void {
		// 占位：预留设置扩展位
	}

	// ---------- 设置持久化 ----------
	private async loadSettings(): Promise<void> {
		const loaded = await this.loadData();
		if (loaded) {
			Object.assign(this.settings, DEFAULT_SETTINGS, loaded);
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	// ---------- 自触发保护 ----------
	private markSelfWritten(path: string): void {
		this.selfWritten.set(path, Date.now());
	}

	private isSelfWritten(path: string): boolean {
		const ts = this.selfWritten.get(path);
		if (!ts) return false;
		if (Date.now() - ts > CodeConverter.SELF_TTL_MS) {
			this.selfWritten.delete(path);
			return false;
		}
		return true;
	}

	// ---------- 自动检测（受设置与防回环双重保护） ----------
	private async handleAutoDetect(file: TFile): Promise<void> {
		if (!this.settings.autoConvertOnImport) return;
		if (this.isSelfWritten(file.path)) return; // 插件自己写的，跳过

		const bytes: Uint8Array = await this.app.vault.readBinary(file);
		const det = detectEncoding(bytes, this.settings.confidenceThreshold);

		if (det.isUtf8) return; // 本来就是 UTF-8，无事可做

		// 非 UTF-8：高置信度才静默转，低置信度只报告
		if (det.needsManualConfirm) {
			new Notice(
				`${PLUGIN_NAME}: ${file.path} 疑似 ${det.encoding}（${det.confidence}%），请手动执行转换命令确认。`
			);
			return;
		}

		// 高置信度 → 自动转换（仍带备份）
		try {
			const r = await convertFileToUtf8(this.app.vault, file, this.settings, true);
			if (r.converted) this.markSelfWritten(file.path);
		} catch (e) {
			new Notice(`${PLUGIN_NAME} 自动转换失败 ${file.path}: ${(e as Error).message}`);
		}
	}

	// ---------- 手动命令 ----------
	private getActiveFile(): TFile | null {
		// Obsidian 标准 API：直接取活动文件
		return this.app.workspace.getActiveFile() ?? null;
	}

	private async convertCurrentFile(): Promise<void> {
		const file = this.getActiveFile();
		if (!file) {
			new Notice(`${PLUGIN_NAME}: 请先把光标放到一个 .md 文件上`);
			return;
		}
		const bytes: Uint8Array = await this.app.vault.readBinary(file);
		const det = detectEncoding(bytes, this.settings.confidenceThreshold);

		if (det.isUtf8) {
			new Notice(`${PLUGIN_NAME}: ${file.path} 已是 UTF-8，无需转换。`);
			return;
		}

		// 低置信度 → 弹确认框；高置信度 → 直接转
		if (det.needsManualConfirm) {
			new EncodingConfirmModal(this.app, file, this.app.vault, this.settings, async (force) => {
				const r = await convertFileToUtf8(this.app.vault, file, this.settings, force);
				if (r.converted) this.markSelfWritten(file.path);
			}).open();
		} else {
			const r = await convertFileToUtf8(this.app.vault, file, this.settings, true);
			if (r.converted) this.markSelfWritten(file.path);
			else if (r.message) new Notice(r.message);
		}
	}

	private async convertCurrentFolder(): Promise<void> {
		const file = this.getActiveFile();
		let root: TAbstractFile;
		if (file) {
			// 当前文件所在目录
			root = this.app.vault.getAbstractFileByPath(
				file.path.replace(/\/[^/]+$/, "")
			);
		} else {
			root = this.app.vault.getAbstractFileByPath("");
		}
		if (!root) {
			new Notice(`${PLUGIN_NAME}: 找不到目标文件夹`);
			return;
		}

		const allFiles = this.app.vault.getMarkdownFiles();
		const prefix = (root as { path: string }).path;
		const targets = prefix
			? allFiles.filter((f) => f.path.startsWith(prefix + "/"))
			: allFiles;

		const r = await convertFilesToUtf8(this.app.vault, targets, this.settings, true);
		if (r.failed.length) {
			new Notice(
				`${PLUGIN_NAME}: 完成 ${r.converted} 转换 / ${r.skipped} 跳过 / ${r.failed.length} 失败`
			);
			// 控制台列出失败项
			console.warn("[code-converter] failures:", r.failed);
		} else {
			new Notice(
				`${PLUGIN_NAME}: 已处理 ${r.total} 个文件（转换 ${r.converted}，跳过 ${r.skipped}）`
			);
		}
	}

	private async detectCurrentFile(): Promise<void> {
		const file = this.getActiveFile();
		if (!file) {
			new Notice(`${PLUGIN_NAME}: 请先把光标放到一个文件上`);
			return;
		}
		const bytes: Uint8Array = await this.app.vault.readBinary(file);
		const det = detectEncoding(bytes, this.settings.confidenceThreshold);
		const preview = det.isUtf8
			? ""
			: decodeWithEncoding(bytes, det.encoding).slice(0, 120).replace(/\n/g, " ⏎ ");

		new Notice(
			`${PLUGIN_NAME}: ${file.path}\n` +
				`编码: ${det.isUtf8 ? "UTF-8（无需处理）" : det.encoding}\n` +
				`BOM: ${det.bom}\n` +
				`置信度: ${det.confidence}%` +
				(preview ? `\n预览: ${preview}` : ""),
			{ timeout: 8000 }
		);
	}
}
