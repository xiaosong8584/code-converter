/**
 * 风险确认弹窗：开启「导入时自动转换为 UTF-8」前必经的一步。
 *
 * 这个开关是插件里唯一会**自动改写用户文件**的设置，一旦开启就不再需要
 * 用户逐次触发，所以开启前把风险讲清楚，比事后补救便宜得多。
 * 用户在弹窗里取消 → 开关拨回关闭、设置不落盘。
 */

import { App, Modal } from "obsidian";
import { t, isRtl } from "./i18n";
import { AUTO_CONVERT_RISK_KEYS, shouldWarnAboutBackup } from "./risk";
import type { CodeConverterSettings } from "./types";

export class AutoConvertRiskModal extends Modal {
	private settings: CodeConverterSettings;
	private onAccept: () => void;
	private onReject: () => void;

	constructor(
		app: App,
		settings: CodeConverterSettings,
		onAccept: () => void,
		onReject: () => void
	) {
		super(app);
		this.settings = settings;
		this.onAccept = onAccept;
		this.onReject = onReject;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		// RTL 语言（阿语）整体翻转
		if (isRtl()) contentEl.setAttribute("dir", "rtl");
		else contentEl.removeAttribute("dir");

		contentEl.createEl("h2", { text: t("modal.risk.title") });

		// 风险正文（逐条，textContent 写入，不解析 HTML）
		for (const key of AUTO_CONVERT_RISK_KEYS) {
			const p = contentEl.createEl("p", { cls: "cc-risk-line" });
			p.textContent = t(key);
		}

		// 备份未开启 → 单独强调（这是唯一一条会造成不可逆后果的）
		if (shouldWarnAboutBackup(this.settings.backupBeforeConvert)) {
			const warn = contentEl.createEl("p", { cls: "cc-risk-warn" });
			warn.textContent = t("modal.risk.noBackup");
		}

		const btnRow = contentEl.createDiv({ cls: "cc-btn-row" });
		const okBtn = btnRow.createEl("button", { text: t("modal.risk.confirm") });
		okBtn.className = "cc-primary";
		okBtn.onclick = () => {
			this.close();
			this.onAccept();
		};
		const cancelBtn = btnRow.createEl("button", { text: t("modal.cancel") });
		cancelBtn.onclick = () => {
			this.close();
			this.onReject();
		};
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
