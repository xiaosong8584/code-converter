/**
 * 确认弹窗：当探测到非 UTF-8 编码但置信度不足时，弹出来让用户决策。
 * 这是"安全阀"的关键一环——绝不静默强转。
 */

import { App, Modal, Notice, Setting, ToggleComponent } from "obsidian";
import { TFile, Vault } from "obsidian";
import { detectEncoding, decodeWithEncoding } from "./encoding";
import { CodeConverterSettings } from "./types";
import { t, isRtl } from "./i18n";

/** 在弹窗内构造的轻量文件引用（避免和 Vault TFile 混淆） */
export class EncodingConfirmModal extends Modal {
	private file: TFile;
	private vault: Vault;
	private settings: CodeConverterSettings;
	private onConfirm: (force: boolean) => Promise<void>;

	// 弹窗状态
	private force: boolean;

	constructor(
		app: App,
		file: TFile,
		vault: Vault,
		settings: CodeConverterSettings,
		onConfirm: (force: boolean) => Promise<void>
	) {
		super(app);
		this.file = file;
		this.vault = vault;
		this.settings = settings;
		this.onConfirm = onConfirm;
		this.force = false;
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		// RTL 语言翻转内容方向
		if (isRtl()) contentEl.setAttribute("dir", "rtl");
		else contentEl.removeAttribute("dir");

		const bytes: Uint8Array = new Uint8Array(await this.vault.readBinary(this.file));
		const det = detectEncoding(bytes, this.settings.confidenceThreshold);

		const h = contentEl.createEl("h2", { text: t("modal.title") });
		h.classList.add("cc-title");

		// 文件信息
		const fileRow = contentEl.createEl("div", { cls: "cc-file-row" });
		fileRow.setText(this.file.path);

		// 探测编码（textContent 而非 innerHTML，杜绝插值内容被当 HTML 解析）
		const encRow = contentEl.createEl("div", { cls: "cc-detected" });
		encRow.textContent = t("modal.detected", {
			enc: det.encoding,
			n: det.confidence
		});

		// 预览解码后的前 400 字符（帮助用户判断编码是否正确）
		const preview = decodeWithEncoding(bytes, det.encoding).slice(0, 400);
		const preEl = contentEl.createEl("pre", { cls: "cc-preview" });
		preEl.setText(preview || t("notice.emptyFile"));

		// 强制转换开关
		new Setting(contentEl)
			.setName(t("modal.force.name"))
			.setDesc(t("modal.force.desc"))
			.addToggle((tg: ToggleComponent) =>
				tg.setValue(this.force).onChange((v) => {
					this.force = v;
				})
			);

		// 按钮行
		const btnRow = contentEl.createDiv({ cls: "cc-btn-row" });
		const okBtn = btnRow.createEl("button", { text: t("modal.confirm") });
		okBtn.className = "cc-primary";
		okBtn.onclick = async () => {
			try {
				await this.onConfirm(this.force);
			} catch (e) {
				// 转换失败也要关闭弹窗并提示，避免弹窗卡死
				new Notice(`[Code Converter] ${(e as Error).message}`, 8000);
			} finally {
				this.close();
			}
		};
		const cancelBtn = btnRow.createEl("button", { text: t("modal.cancel") });
		cancelBtn.onclick = () => {
			this.close();
		};
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
