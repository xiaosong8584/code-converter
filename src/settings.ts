/**
 * 设置面板：暴露阈值、自动转换开关、备份目录、界面语言等。
 */

import {
	Notice,
	PluginSettingTab,
	Setting,
	ToggleComponent
} from "obsidian";
import type CodeConverter from "./main";
import { t, setLocale, LOCALES, LOCALE_NAMES, isRtl } from "./i18n";
import {
	DEFAULT_BACKUP_DIR,
	DEFAULT_LOG_FILE,
	DEFAULT_TEXT_EXTENSIONS,
	type UILocale as LocaleCode
} from "./types";
import { VipActivationModal } from "./vip/activate-modal";
import { isLocaleLocked, isSettingLocked } from "./vip/gate";
import { AutoConvertRiskModal } from "./risk-modal";
import { shouldWarnOnEnable } from "./risk";

/** 把当前语言方向应用到容器（RTL 语言设 dir=rtl，否则移除） */
function applyDir(containerEl: HTMLElement): void {
	const dir = isRtl() ? "rtl" : "ltr";
	if (dir === "rtl") containerEl.setAttribute("dir", "rtl");
	else containerEl.removeAttribute("dir");
}

export class CodeConverterSettingTab extends PluginSettingTab {
	plugin: CodeConverter;

	constructor(app: CodeConverter["app"], plugin: CodeConverter) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		applyDir(containerEl);
		const settings = this.plugin.settings;
		// VIP 门禁：本次启动判定后的 VIP 是否有效（决定哪些设置项/语言可用）
		const vipActive = this.plugin.isVipActive();

		// 界面语言（置顶，切换后其余文案即时刷新）
		new Setting(containerEl)
			.setName(t("setting.locale.name"))
			.setDesc(
				vipActive
					? t("setting.locale.desc")
					: `${t("setting.locale.desc")} ${t("vip.gate.localeDesc")}`
			)
			.addDropdown((dd) => {
				Object.keys(LOCALES).forEach((code) => {
					dd.addOption(code, LOCALE_NAMES[code as LocaleCode]);
				});
				// 非 VIP：后 6 种语言标记为（VIP）并禁用。
				// DropdownComponent 没有 per-option API，直接操作原生 <option>.disabled
				// （selectEl 已在 obsidian.d.ts 验证存在；用索引循环避免依赖可迭代类型）。
				if (!vipActive) {
					const opts = dd.selectEl.options;
					const suffix = t("vip.gate.suffix");
					for (let i = 0; i < opts.length; i++) {
						const opt = opts[i];
						if (!isLocaleLocked(opt.value as LocaleCode, false)) continue;
						opt.disabled = true;
						opt.textContent = `${LOCALE_NAMES[opt.value as LocaleCode]} ${suffix}`;
					}
				}
				dd.setValue(settings.locale).onChange(async (v) => {
					const code = v as LocaleCode;
					settings.locale = code;
					setLocale(code);
					await this.plugin.saveSettings();
					applyDir(this.containerEl); // 切换后即时翻转方向
					this.display(); // 刷新全部文案
				});
			});

		// 导入自动转换是插件的灵魂（防 Obsidian 保存毁坏非 UTF-8 文件）：
		// 永久免费、默认开启。开关引用留一份：弹窗里点「取消」时要把 UI 拨回关闭
		// （设置值本身没动，仍为开启状态）。
		let autoToggle: ToggleComponent | null = null;
		new Setting(containerEl)
			.setName(t("setting.autoConvert.name"))
			.setDesc(t("setting.autoConvert.desc"))
			.addToggle((cb) => {
				autoToggle = cb;
				cb
					.setValue(settings.autoConvertOnImport)
					.onChange(async (v) => {
						// 关闭：直接落盘，不打扰
						if (!v) {
							settings.autoConvertOnImport = false;
							await this.plugin.saveSettings();
							return;
						}
						// 开启前先确认风险（仅 false → true 提示一次）。
						// 关键：确认之前**不写 settings**，点取消则什么都不变。
						if (!shouldWarnOnEnable(true, settings.autoConvertOnImport)) {
							settings.autoConvertOnImport = true;
							await this.plugin.saveSettings();
							return;
						}
						new AutoConvertRiskModal(
							this.app,
							settings,
							async () => {
								settings.autoConvertOnImport = true;
								await this.plugin.saveSettings();
								const msg = settings.backupBeforeConvert
									? t("notice.autoConvertEnabled", { dir: settings.backupDir })
									: t("notice.autoConvertEnabledNoBackup");
								new Notice(`[Code Converter] ${msg}`, 6000);
							},
							() => {
								autoToggle?.setValue(false);
							}
						).open();
					});
			});

		new Setting(containerEl)
			.setName(t("setting.threshold.name"))
			.setDesc(t("setting.threshold.desc"))
			.addText((text) => {
				text.setValue(String(settings.confidenceThreshold));
				text.onChange(async (v) => {
					let n = parseInt(v, 10);
					if (isNaN(n)) n = 80;
					n = Math.max(1, Math.min(100, n));
					settings.confidenceThreshold = n;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(t("setting.backup.name"))
			.setDesc(t("setting.backup.desc"))
			.addToggle((cb) =>
				cb.setValue(settings.backupBeforeConvert).onChange(async (v) => {
					settings.backupBeforeConvert = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName(t("setting.backupDir.name"))
			.setDesc(t("setting.backupDir.desc"))
			.addText((text) => {
				text.setValue(settings.backupDir);
				text.setPlaceholder(DEFAULT_BACKUP_DIR);
				text.inputEl.addClass("cc-backup-dir");
				text.onChange(async (v) => {
					const clean = (v || DEFAULT_BACKUP_DIR).replace(/^\/+|\/+$/g, "");
					settings.backupDir = clean || DEFAULT_BACKUP_DIR;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(t("setting.stripBom.name"))
			.setDesc(t("setting.stripBom.desc"))
			.addToggle((cb) =>
				cb.setValue(settings.stripBomOnConvert).onChange(async (v) => {
					settings.stripBomOnConvert = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName(t("setting.writeBom.name"))
			.setDesc(t("setting.writeBom.desc"))
			.addToggle((cb) =>
				cb.setValue(settings.writeBomOnConvert).onChange(async (v) => {
					settings.writeBomOnConvert = v;
					await this.plugin.saveSettings();
				})
			);

		// 非 VIP 置灰：该清单只被两条 VIP 增强功能消费（导入自动转换 / 文件夹批量
		// 转换），非 VIP 改了也不会产生任何效果；留成可编辑会让人误以为已生效。
		const extLocked = isSettingLocked("textExtensions", vipActive);
		new Setting(containerEl)
			.setName(t("setting.textExtensions.name"))
			.setDesc(extLocked ? t("vip.gate.textExtensionsDesc") : t("setting.textExtensions.desc"))
			.addText((text) => {
				text.setValue(settings.textExtensions);
				text.setPlaceholder(DEFAULT_TEXT_EXTENSIONS);
				text.inputEl.addClass("cc-backup-dir");
				text.setDisabled(extLocked);
				text.onChange(async (v) => {
					// 归一化分隔符：分号 / 逗号 / 空白都收敛成分号，留空回退默认值
					const clean = (v || "")
						.replace(/[;,\s]+/g, ";")
						.replace(/^;+|;+$/g, "");
					settings.textExtensions = clean || DEFAULT_TEXT_EXTENSIONS;
					await this.plugin.saveSettings();
				});
			});

		// 日志文件（留空 = 仅内存，不写文件）
		new Setting(containerEl)
			.setName(t("setting.logFile.name"))
			.setDesc(t("setting.logFile.desc"))
			.addText((text) => {
				text.setValue(settings.logFile);
				text.setPlaceholder(DEFAULT_LOG_FILE);
				text.inputEl.addClass("cc-backup-dir");
				text.onChange(async (v) => {
					const clean = (v || "").replace(/^\/+|\/+$/g, "");
					settings.logFile = clean;
					await this.plugin.saveSettings();
				});
			});

		// 损坏警告阈值（0 = 关闭）
		new Setting(containerEl)
			.setName(t("setting.damageWarn.name"))
			.setDesc(t("setting.damageWarn.desc"))
			.addText((text) => {
				text.setValue(String(settings.damageWarnRatio));
				text.setPlaceholder("5");
				text.inputEl.addClass("cc-backup-dir");
				text.onChange(async (v) => {
					const n = Math.max(0, Math.min(100, Number(v) || 0));
					settings.damageWarnRatio = n;
					await this.plugin.saveSettings();
				});
			});

		// ---- VIP：激活状态（激活后永久隐藏广告横幅） ----
		// 收窄到局部变量，让 TS 能确认 type/expiresAt 可用
		const vipState = this.plugin.vipState?.active === true ? this.plugin.vipState : null;
		// 局部别名不能省：TS 靠它把 vipState 收窄为非空（aliased condition narrowing）
		const vipOn = vipState !== null;
		const vipDesc = vipOn
			? t("setting.vip.descActive", {
					type:
						vipState.type === "universal"
							? t("vip.type.universal")
							: t("vip.type.dedicated"),
					expiry: vipState.expiresAt ?? t("vip.neverExpires")
				})
			: t("setting.vip.descInactive");
		// 付费功能必须明确披露：VIP 说明里直接写清哪些功能是 VIP 增强功能
		const vipFullDesc = vipActive
			? `${vipDesc}\n${t("vip.gate.unlocked")}`
			: `${vipDesc}\n${t("vip.gate.overview")}`;
		new Setting(containerEl)
			.setName(t("setting.vip.name"))
			.setDesc(vipFullDesc)
			.addButton((b) =>
				b
					.setButtonText(vipActive ? t("setting.vip.reactivateBtn") : t("setting.vip.activateBtn"))
					.onClick(() => {
						new VipActivationModal(this.app, this.plugin, () => this.display()).open();
					})
			);

		// 设备 ID：签发专用激活码时由作者收集（专用码绑定设备，永不过期）
		new Setting(containerEl)
			.setName(t("setting.vip.deviceId.name"))
			.setDesc(t("setting.vip.deviceId.desc"))
			.addButton((b) =>
				b.setButtonText("\u29c9").onClick(() => {
					navigator.clipboard.writeText(this.plugin.deviceId).then(
						() => new Notice(`[Code Converter] ${t("setting.vip.deviceId.copied")}`, 2000),
						() => {}
					);
				})
			);

		new Notice(`[Code Converter] ${t("notice.settingsLoaded")}`);
	}
}
