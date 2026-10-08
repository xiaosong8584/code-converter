/**
 * VIP 激活弹窗。
 *
 * 点击设置面板的「激活 VIP」按钮打开，用户输入激活码后点「激活」。
 * 通用码有效期内任意设备可用；专用码绑定当前设备，永不过期。
 * 激活成功后回调 plugin.activateVip() 铸造完整性指纹（见 vip/seal.ts）。
 */

import { App, Modal, Notice, Setting } from "obsidian";
import type CodeConverter from "../main";
import { isEd25519Available, verifyVip } from "./vip";
import { t, isRtl } from "../i18n";

export class VipActivationModal extends Modal {
	constructor(
		app: App,
		private plugin: CodeConverter,
		/** 激活成功后的回调（SettingsTab 用来刷新自身，让 VIP 状态立刻出现） */
		private onActivated?: () => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		if (isRtl()) contentEl.setAttribute("dir", "rtl");
		else contentEl.removeAttribute("dir");

		contentEl.createEl("h3", { text: t("vip.modal.title") });
		contentEl.createEl("p", { text: t("vip.modal.intro") });

		let code = "";
		new Setting(contentEl)
			.setName(t("vip.modal.codeName"))
			.addText((txt) => {
				txt.setPlaceholder("VIPU0002-XXXXXXXX-XXXXXXXX-…").onChange((v) => {
					code = v;
				});
				// 激活码 143 字符，默认宽度会折行；加宽到能整行显示
			txt.inputEl.addClass("cc-vip-code-input");
			});

		const btnRow = contentEl.createDiv({ cls: "cc-btn-row" });
		const okBtn = btnRow.createEl("button", { text: t("vip.modal.activateBtn") });
		okBtn.className = "cc-primary";
		okBtn.onclick = async () => {
			if (!code.trim()) {
				new Notice(`[Code Converter] ${t("vip.notice.enterCode")}`);
				return;
			}
			// Ed25519 需 Chromium 113+（Obsidian ≥ 1.5.8）。老版本上激活必然失败，
			// 与其让用户拿到「激活码无效」这种无解提示，不如明确告知要升级 Obsidian。
			// 放在这里（而非 onOpen）是为了避免探测结果与点击之间产生竞态。
			if (!(await isEd25519Available())) {
				new Notice(`[Code Converter] ${t("vip.notice.unsupported")}`, 6000);
				return;
			}
			const state = await verifyVip(code, this.plugin.deviceId);
			if (!state) {
				new Notice(`[Code Converter] ${t("vip.notice.invalid")}`, 5000);
				return;
			}
			// 激活 = 铸造首份完整性指纹（plugin 内负责保留历史时间高水位）
			await this.plugin.activateVip(state, code);
			new Notice(`[Code Converter] ${t("vip.notice.success")}`, 3000);
			this.close();
			this.onActivated?.();
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
