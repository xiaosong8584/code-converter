/**
 * 乱码修复确认弹窗：展示修复链 / 质量 / 行数统计 + 修复前后预览。
 * 安全阀：修复永远不静默执行，必须经此弹窗用户确认。
 */

import { App, Modal, Setting } from "obsidian";
import type { RepairResult } from "./repair";
import type { CodeConverterSettings } from "./types";
import { t, isRtl } from "./i18n";

export class RepairConfirmModal extends Modal {
	private result: RepairResult;
	private originalText: string;
	private vaultPath: string;
	private onConfirm: (proceed: boolean) => Promise<void>;

	constructor(
		app: App,
		vaultPath: string,
		originalText: string,
		result: RepairResult,
		private settings: CodeConverterSettings,
		onConfirm: (proceed: boolean) => Promise<void>
	) {
		super(app);
		this.vaultPath = vaultPath;
		this.originalText = originalText;
		this.result = result;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		// RTL 语言（阿语）方向翻转
		if (isRtl()) contentEl.setAttribute("dir", "rtl");

		contentEl.createEl("h3", { text: t("modal.repair.title") });
		contentEl.createEl("p", {
			text: `${t("modal.file")}: ${this.vaultPath}`
		});
		contentEl.createEl("p", {
			text: t("modal.repair.chain", {
				chain: this.result.chain ?? "-",
				n: this.result.score,
				r: this.result.repairedLines,
				s: this.result.scannedLines
			})
		});
		if (this.result.fffdCount > 0) {
			contentEl.createEl("p", {
				text: t("repair.hasFFFD", { n: this.result.fffdCount })
			});
		}

		// 修复前预览
		contentEl.createEl("p", { text: t("modal.repair.before") });
		const pre = contentEl.createDiv("cc-preview");
		pre.textContent = this.truncatePreview(this.originalText);
		// 修复后预览
		contentEl.createEl("p", { text: t("modal.repair.after") });
		const post = contentEl.createDiv("cc-preview");
		post.textContent = this.truncatePreview(this.result.text);

		const btnRow = contentEl.createDiv("cc-btn-row");
		new Setting(btnRow)
			.addButton((btn) =>
				btn
					.setButtonText(t("modal.repair.confirm"))
					.setCta()
					.onClick(() => {
						this.close();
						this.onConfirm(true);
					})
			)
			.addButton((btn) =>
				btn.setButtonText(t("modal.cancel")).onClick(() => {
					this.close();
					this.onConfirm(false);
				})
			);
	}

	/** 预览截断（原文件内容仅供人眼比对，无需完整展示） */
	private truncatePreview(text: string): string {
		const MAX = 400;
		return text.length > MAX ? text.slice(0, MAX) + "…" : text;
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
