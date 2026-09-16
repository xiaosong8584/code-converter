/**
 * 设置面板：暴露阈值、自动转换开关、备份目录等。
 */

import {
	Notice,
	PluginSettingTab,
	Setting,
	TextInputComponent
} from "obsidian";
import { CodeConverter } from "./main";
import { CodeConverterSettings } from "./types";

export class CodeConverterSettingTab extends PluginSettingTab {
	plugin: CodeConverter;

	constructor(app: CodeConverter["app"], plugin: CodeConverter) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const settings = this.plugin.settings;

		new Setting(containerEl)
			.setName("导入时自动转换为 UTF-8")
			.setDesc("新建或导入文件时，若检测到非 UTF-8 编码则静默转换为 UTF-8（仍受置信度阈值保护）。")
			.addToggle((cb) =>
				cb.setValue(settings.autoConvertOnImport).onChange(async (v) => {
					settings.autoConvertOnImport = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("置信度阈值（%）")
			.setDesc("低于此值的非 UTF-8 文件需人工确认，避免误判损坏文件。推荐 80。")
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
			.setName("转换前自动备份")
			.setDesc("把原文件字节备份到备份目录，可回滚。强烈建议开启。")
			.addToggle((cb) =>
				cb.setValue(settings.backupBeforeConvert).onChange(async (v) => {
					settings.backupBeforeConvert = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("备份目录")
			.setDesc("仓库内的相对目录，默认 .code-converter-backups")
			.addText((text) => {
				text.setValue(settings.backupDir);
				text.setPlaceholder(".code-converter-backups");
				text.inputEl.addClass("cc-backup-dir");
				text.onChange(async (v) => {
					const clean = (v || ".code-converter-backups").replace(/^\/+|\/+$/g, "");
					settings.backupDir = clean || ".code-converter-backups";
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("转换时去除 UTF-8 BOM")
			.setDesc("Obsidian 对 BOM 不敏感，去除后更干净。")
			.addToggle((cb) =>
				cb.setValue(settings.stripBomOnConvert).onChange(async (v) => {
					settings.stripBomOnConvert = v;
					await this.plugin.saveSettings();
				})
			);

		new Notice("[Code Converter] 设置已加载");
	}
}
