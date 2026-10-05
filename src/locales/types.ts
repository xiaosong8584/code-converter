/**
 * i18n 词典类型：所有语言共用同一组 key。
 * 新增界面文案时，务必在这里加 key，并在每种语言里补对应翻译。
 */

export interface LocaleDict {
	// 设置面板标题
	"settings.title": string;
	// 设置项
	"setting.autoConvert.name": string;
	"setting.autoConvert.desc": string;
	"setting.textExtensions.name": string;
	"setting.textExtensions.desc": string;
	"setting.threshold.name": string;
	"setting.threshold.desc": string;
	"setting.backup.name": string;
	"setting.backup.desc": string;
	"setting.backupDir.name": string;
	"setting.backupDir.desc": string;
	"setting.stripBom.name": string;
	"setting.stripBom.desc": string;
	"setting.writeBom.name": string;
	"setting.writeBom.desc": string;
	"setting.locale.name": string;
	"setting.locale.desc": string;
	"setting.logFile.name": string;
	"setting.logFile.desc": string;
	"setting.damageWarn.name": string;
	"setting.damageWarn.desc": string;
	// 命令名
	"cmd.convertCurrent": string;
	"cmd.convertFolder": string;
	"cmd.detectCurrent": string;
	"cmd.exportLog": string;
	"cmd.exportLogMd": string;
	"cmd.repairCurrent": string;
	// 通知
	"notice.noFile": string;
	"notice.alreadyUtf8": string;
	"notice.converted": string;
	"notice.conversionFailed": string;
	"notice.binarySkipped": string;
	"notice.backupCreated": string;
	"notice.detectOnly": string;
	"notice.lowConfidence": string;
	"notice.folderDone": string;
	"notice.folderDoneFail": string;
	"notice.settingsLoaded": string;
	"notice.emptyFile": string;
	"notice.logExported": string;
	"notice.logEmpty": string;
	"notice.damagedUtf8": string;
	"notice.folderDamaged": string;
	"notice.repairDone": string;
	// 乱码修复
	"repair.notUtf8": string;
	"repair.noIssue": string;
	"repair.hasFFFD": string;
	"modal.repair.title": string;
	"modal.repair.chain": string;
	"modal.repair.before": string;
	"modal.repair.after": string;
	"modal.repair.confirm": string;
	// 确认弹窗
	"modal.title": string;
	"modal.file": string;
	"modal.detected": string;
	"modal.preview": string;
	"modal.force.name": string;
	"modal.force.desc": string;
	"modal.confirm": string;
	"modal.cancel": string;
	// VIP 激活
	"setting.vip.name": string;
	"setting.vip.descActive": string;
	"setting.vip.descInactive": string;
	"setting.vip.activateBtn": string;
	"setting.vip.reactivateBtn": string;
	"setting.vip.deviceId.name": string;
	"setting.vip.deviceId.desc": string;
	"setting.vip.deviceId.copied": string;
	"vip.modal.title": string;
	"vip.modal.intro": string;
	"vip.modal.codeName": string;
	"vip.modal.activateBtn": string;
	"vip.notice.enterCode": string;
	"vip.notice.invalid": string;
	"vip.notice.unsupported": string;
	"vip.notice.success": string;
	"vip.notice.invalidated": string;
	"vip.notice.expired": string;
	"vip.type.universal": string;
	"vip.type.dedicated": string;
	"vip.neverExpires": string;
	// 广告横幅（支持作者条）
	"ad.message": string;
	"ad.openBtn": string;
	"ad.channel.afdian": string;
	"ad.channel.bilibili": string;
	"ad.channel.github": string;
	// VIP 功能门禁（v1.6.0：非 VIP 的增强功能限制，见 src/vip/gate.ts）
	"vip.gate.suffix": string;
	"vip.gate.lockedNotice": string;
	"vip.gate.localeDesc": string;
	"vip.gate.textExtensionsDesc": string;
	"vip.gate.overview": string;
	"vip.gate.unlocked": string;
	// 自动转换风险确认（v1.6.0：开启该开关前弹窗告知风险，见 src/risk.ts）
	"modal.risk.title": string;
	"modal.risk.intro": string;
	"modal.risk.body1": string;
	"modal.risk.body2": string;
	"modal.risk.body3": string;
	"modal.risk.body4": string;
	"modal.risk.noBackup": string;
	"modal.risk.confirm": string;
	"notice.autoConvertEnabled": string;
	"notice.autoConvertEnabledNoBackup": string;
}

export type LocaleCode =
	| "zh-CN" | "en" | "ja" | "ko" | "ru"
	| "fr" | "de" | "es" | "pt-BR" | "ar";
