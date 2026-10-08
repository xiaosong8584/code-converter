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
	Command,
	FileView,
	Notice,
	Plugin,
	TAbstractFile,
	TFile
} from "obsidian";

import { CodeConverterSettingTab } from "./settings";
import { EncodingConfirmModal } from "./confirm-modal";
import { convertFileToUtf8, convertFilesToUtf8, isDamageOverThreshold } from "./convert";
import { parseExtensions, isTextExtension } from "./file-filter";
import { detectEncoding, decodeWithEncoding, analyzeReplacementDamage } from "./encoding";
import { repairMojibake } from "./repair";
import { RepairConfirmModal } from "./repair-modal";
import { backupFile, makeRecord, makeFailureRecord, logConversion } from "./backup";
import { t, setLocale } from "./i18n";
import {
	CodeConverterSettings,
	DEFAULT_SETTINGS,
	ConversionRecord
} from "./types";
import {
	loadFromFile,
	appendToFile,
	exportLog,
	defaultExportName
} from "./log";
import { AdBanner, shouldShowAd, markAdShown } from "./ad/ad-banner";
import type { AdState } from "./ad/ad-banner";
import { generateUUID, restoreVipState as restoreVipStateImpl } from "./vip/vip";
import { makeSeal } from "./vip/seal";
import { VipActivationModal } from "./vip/activate-modal";
import { isCommandLocked, isLocaleLocked, FALLBACK_LOCALE } from "./vip/gate";
import type { VipState, VipSeal } from "./vip/vip";

const PLUGIN_NAME = "Code Converter";

// CSS 已抽到仓库根的 styles.css（对应 obsidian-sample-plugin 的标准做法），
// Obsidian 加载插件时会自动 applyStylesheet 加载它——不再需要在 onload 里手动注入。

export default class CodeConverter extends Plugin {
	settings: CodeConverterSettings = { ...DEFAULT_SETTINGS };

	// 自触发保护：记录"本插件刚写过的文件 + 时间戳"，监听器据此跳过
	private selfWritten = new Map<string, number>();
	private static SELF_TTL_MS = 2000;

	// 正在自动转换中的文件：create+modify 双事件/连续修改会对同一文件并发触发
	// handleAutoDetect，导致重复备份+重复写回——用 in-flight 集合去重
	private inFlight = new Set<string>();

	// 转换日志（内存收集，用于导出；onload 时从 logFile 恢复）
	private records: ConversionRecord[] = [];

	// ---------- VIP / 广告（与 settings 平级存放在 data.json，见 loadSettings） ----------
	/** 设备 ID：首次运行生成并立即落盘，避免重装后变化导致专用激活码失效 */
	deviceId: string = "";
	/** VIP 激活状态（null = 未激活/已失效）。手改 data.json 会被 seal 指纹拦截 */
	vipState: VipState | null = null;
	/** VIP 完整性指纹：VIP 过期后仍需继续推进落盘（时间高水位单调上升的关键） */
	private vipSeal: VipSeal | null = null;
	/** 广告横幅展示状态（lastShownAt），与 vip 平级，VIP 失效不重置 */
	private adState: AdState | null = null;
	private adBanner: AdBanner | null = null;
	/** 受 VIP 门禁约束的命令（激活成功后要把命令名上的（VIP）标记去掉） */
	private vipGatedCommands: { cmd: Command; baseName: string }[] = [];

	async onload(): Promise<void> {
		await this.loadSettings();

		this.addSettingTab(new CodeConverterSettingTab(this.app, this));

		// 恢复历史转换日志（若配置了 logFile）。
		// 用 concat 而非整体赋值：恢复是异步的，若恢复完成前已有新记录入列，
		// 直接 this.records = rs 会把它们冲掉。
		if (this.settings.logFile) {
			loadFromFile(this.app.vault, this.settings.logFile)
				.then((rs) => (this.records = rs.concat(this.records)))
				.catch(() => {});
		}

		// ---------- 命令：转换当前文件 ----------
		this.addCommand({
			id: "cc-convert-current",
			name: t("cmd.convertCurrent"),
			callback: () => {
				this.convertCurrentFile().catch((e) =>
					new Notice(`${PLUGIN_NAME}: ${(e as Error).message}`)
				);
			}
		});

		// ---------- 命令：扫描并转换当前文件夹（VIP 增强功能）----------
		this.addVipCommand({
			id: "cc-convert-folder",
			baseName: t("cmd.convertFolder"),
			run: () => {
				this.convertCurrentFolder().catch((e) =>
					new Notice(`${PLUGIN_NAME}: ${(e as Error).message}`)
				);
			}
		});

		// ---------- 命令：检测（仅报告，不转换）----------
		this.addCommand({
			id: "cc-detect-current",
			name: t("cmd.detectCurrent"),
			callback: () => {
				this.detectCurrentFile().catch((e) =>
					new Notice(`${PLUGIN_NAME}: ${(e as Error).message}`)
				);
			}
		});

		// ---------- 命令：导出转换日志（JSON / Markdown）----------
		this.addCommand({
			id: "cc-export-log-json",
			name: t("cmd.exportLog"),
			callback: () => {
				this.exportLog("json").catch((e) =>
					new Notice(`${PLUGIN_NAME}: ${(e as Error).message}`)
				);
			}
		});
		this.addCommand({
			id: "cc-export-log-md",
			name: t("cmd.exportLogMd"),
			callback: () => {
				this.exportLog("markdown").catch((e) =>
					new Notice(`${PLUGIN_NAME}: ${(e as Error).message}`)
				);
			}
		});

		// ---------- 命令：修复当前文件中的乱码（二次编码修复，实验性）----------
		this.addCommand({
			id: "cc-repair-current",
			name: t("cmd.repairCurrent"),
			callback: () => {
				this.repairCurrentFile().catch((e) =>
					new Notice(`${PLUGIN_NAME}: ${(e as Error).message}`)
				);
			}
		});

		// ---------- 监听：导入自动检测（默认关闭） ----------
		// 闸门走扩展名白名单（默认 md，可在设置里扩展）。手动「转换当前文件」
		// 不经过这里——用户已经明确指定了目标文件，拦它没有意义。
		this.registerEvent(
			this.app.vault.on("create", (f: TAbstractFile) => {
				if (f instanceof TFile && this.isConvertibleFile(f)) {
					void this.handleAutoDetect(f);
				}
			})
		);
		this.registerEvent(
			this.app.vault.on("modify", (f: TAbstractFile) => {
				if (f instanceof TFile && this.isConvertibleFile(f)) {
					void this.handleAutoDetect(f);
				}
			})
		);

		// ---------- 监听：文件被打开时立刻检测并转换（灵魂功能）----------
		// 时序：Obsidian 用 UTF-8 解码 GBK 文件后把乱码缓存到 view，用户按
		// Ctrl+S 或 autosave 就把这个乱码按 UTF-8 写回磁盘，信息永久丢失。
		// file-open 是插件能提前介入的唯一窗口——触发时磁盘上还是原字节，
		// 我们立刻转成 UTF-8 写回；Obsidian 检测到外部修改 + view 干净会
		// 自动重新加载，用户看到的是正确的中文而非乱码。
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (file instanceof TFile && this.isConvertibleFile(file)) {
					void this.handleAutoDetect(file);
				}
			})
		);

		// 启动时扫描已经打开的 markdown 文件：Obsidian 恢复 workspace 时不会为
		// 已有 tab 触发 file-open（它们是上次启动就打开的），那些 tab 里的
		// 非 UTF-8 文件如果不在启动时处理，用户按 Ctrl+S 就会把 Obsidian 缓存
		// 的乱码写回磁盘。layoutReady 之后再扫，避免 workspace 未就绪时 view 为 null。
		this.app.workspace.onLayoutReady(() => {
			const seen = new Set<string>();
			for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
				if (!(leaf.view instanceof FileView)) continue;
				const f = leaf.view.file;
				if (!(f instanceof TFile)) continue;
				if (!this.isConvertibleFile(f) || seen.has(f.path)) continue;
				seen.add(f.path);
				void this.handleAutoDetect(f);
			}
		});

		// ---------- 广告横幅（支持作者条，VIP 永久隐藏） ----------
		this.adBanner = new AdBanner(
			(url) => window.open(url),
			(key) => t(key),
			() => {
				// 用户手动关闭也记一次「已展示」，避免同一天反复弹
				this.adState = markAdShown(this.adState);
				this.saveSettings().catch(() => {});
			}
		);
		this.adBanner.setState(this.adState);
		this.adBanner.mount();
		const adTimer = window.setTimeout(() => {
			this.showAdIfNeeded().catch(() => {});
		}, 3000);
		this.register(() => window.clearTimeout(adTimer));
	}

	async onunload(): Promise<void> {
		this.adBanner?.dispose();
		this.adBanner = null;
	}

	// ---------- 设置持久化 ----------
	private async loadSettings(): Promise<void> {
		const loaded = (await this.loadData()) as Record<string, unknown> | null;
		const data = loaded ?? {};

		// deviceId / vip / seal / adState 与 settings 平级存放在 data.json，
		// 不属于 CodeConverterSettings：先取走再合并，避免混进 settings 对象。
		if (typeof data.deviceId === "string" && data.deviceId) {
			this.deviceId = data.deviceId;
		} else {
			// 首次运行生成 deviceId 并立即落盘，避免重装后变化导致专用激活码失效
			this.deviceId = generateUUID();
			await this.saveData({ ...data, deviceId: this.deviceId });
		}

		// 平级字段不进 settings 对象（剥离后合并，避免脏键）
		const { deviceId: _d, vip: _v, seal: _s, adState: _a, ...settingsOnly } = data;
		Object.assign(this.settings, DEFAULT_SETTINGS, settingsOnly);
		// 初始化界面语言（restoreVipState 可能立刻弹 Notice，必须先切好语言）
		setLocale(this.settings.locale);
		// 恢复 VIP 状态：不信任 data.json，需过完整性指纹 + 按时间高水位判到期
		await this.restoreVipState(
			data.vip as VipState | undefined,
			data.seal as VipSeal | undefined
		);
		// 界面语言门禁：VIP 失效后若仍停留在 VIP 语言，回落到免费语言（en）
		this.applyLocaleGate();

		// 恢复广告状态：与 vip 平级，VIP 失效不重置 lastShownAt
		this.adState = (data.adState as AdState | null) ?? null;
	}

	async saveSettings(): Promise<void> {
		await this.saveData({
			...this.settings,
			deviceId: this.deviceId,
			vip: this.vipState,
			// 指纹单独落盘：VIP 过期后它仍需继续推进，见 restoreVipState
			seal: this.vipSeal,
			// 广告状态平级落盘：VIP 失效时 adState 保留（lastShownAt 不重置）
			adState: this.adState
		});
	}

	// ---------- VIP ----------
	/**
	 * 启动时恢复 VIP 状态（不信任 data.json，见 src/vip/seal.ts 文件头的威胁模型）。
	 *
	 * 判定顺序按成本从低到高：无记录 → 缺 seal（不可信，要求重新激活）→
	 * seal 校验失败 → 通过后按时间高水位判到期。
	 * 第 4 步是唯一写操作：maxSeen 每次启动抬高一次，正是回拨时钟失效的原因。
	 * 写盘失败只降级为 console.warn，下次启动会重跑同一套判定。
	 */
	private async restoreVipState(storedVip: VipState | undefined, storedSeal: VipSeal | undefined): Promise<void> {
		const r = await restoreVipStateImpl(storedVip, storedSeal, this.deviceId);

		if (r.clockRolledBack) {
			// 仅记录不提示：到期判定已按高水位计算，用户无感
			console.warn(
				`[code-converter] system clock below high-water mark (opens=${r.seal?.opens ?? "-"}), judged by high-water mark`
			);
		}

		switch (r.status) {
			case "inactive":
				this.vipState = null;
				break;
			case "invalidated":
				// no-seal / wrong-device / tampered / malformed 都走这里
				this.vipState = null;
				console.warn(`[code-converter] VIP state untrusted (${r.reason}), re-activation required`);
				new Notice(`[Code Converter] ${t("vip.notice.invalidated")}`, 6000);
				break;
			case "expired":
				this.vipState = null;
				console.warn(`[code-converter] VIP expired (expiresAt=${r.expiresAt ?? "-"})`);
				new Notice(
					`[Code Converter] ${t("vip.notice.expired", { expiry: r.expiresAt ?? "-" })}`,
					5000
				);
				break;
			case "active":
				this.vipState = r.vip;
				break;
		}

		// 指纹必须落盘 —— 无论 VIP 是 active 还是 expired。
		// maxSeen 只在指纹校验通过后推进；若 VIP 过期就不落盘，高水位会停在
		// 「最后一次成功加载」，回拨系统时钟即可重新买到有效期。
		// 先写状态再落盘，避免这次 saveSettings 把 vip 写成 null。
		if (r.seal) {
			this.vipSeal = r.seal;
			this.saveSettings().catch((e) =>
				console.warn("[code-converter] failed to persist VIP seal:", e)
			);
		}
	}

	// ---------- VIP 功能门禁 ----------
	/**
	 * 本次启动判定后的 VIP 是否有效。
	 * vipState 已经过 seal 完整性校验与到期判定，为 null 时一律按非 VIP 处理。
	 */
	isVipActive(): boolean {
		return this.vipState?.active === true;
	}

	/**
	 * 界面语言门禁：非 VIP 却停留在 VIP 语言 → 回落到 FALLBACK_LOCALE。
	 *
	 * 触发场景：VIP 到期 / data.json 被判不可信 / 手改过 data.json。
	 * 只改内存里的 settings.locale、不落盘：用户重新激活 VIP 后可以直接在
	 * 下拉里选回原语言，不会被这次回落洗掉。
	 */
	private applyLocaleGate(): void {
		if (!isLocaleLocked(this.settings.locale, this.isVipActive())) return;
		this.settings.locale = FALLBACK_LOCALE;
		setLocale(FALLBACK_LOCALE);
	}

	/**
	 * VIP 激活成功后刷新全部门禁：把命令名上的（VIP）标记去掉。
	 *
	 * `Command.name` 是普通可写属性（obsidian.d.ts:1710），命令面板每次打开
	 * 时重新读取，所以直接赋值即可生效，无需重新注册命令。
	 */
	private refreshVipGates(): void {
		for (const g of this.vipGatedCommands) g.cmd.name = g.baseName;
	}

	/**
	 * 注册一个「VIP 增强功能」命令。
	 *
	 * - 非 VIP：命令名追加（VIP）标记；点击时**不执行功能本体**，先提示原因再
	 *   直接打开激活弹窗（给一条最短的解锁路径）。
	 * - VIP：命令名即原名，正常执行。
	 *
	 * 命令保持注册（而非按需 addCommand）是为了可发现性：用户能在命令面板看到
	 * 有这个功能、以及它是付费的，符合 Obsidian 付费功能必须明确披露的要求。
	 */
	private addVipCommand(def: { id: string; baseName: string; run: () => void }): void {
		const active = this.isVipActive();
		const cmd = this.addCommand({
			id: def.id,
			name: active ? def.baseName : `${def.baseName} ${t("vip.gate.suffix")}`,
			callback: () => {
				if (this.isVipActive()) {
					def.run();
					return;
				}
				// isCommandLocked 是判定真源（避免这里的判断与 gate 清单走偏）
				if (!isCommandLocked(def.id, false)) {
					def.run();
					return;
				}
				new Notice(`${PLUGIN_NAME}: ${t("vip.gate.lockedNotice")}`, 6000);
				new VipActivationModal(this.app, this, () => this.refreshVipGates()).open();
			}
		});
		this.vipGatedCommands.push({ cmd, baseName: def.baseName });
	}

	/**
	 * 激活成功后铸造并持久化首份完整性指纹（由 VipActivationModal 调用）。
	 *
	 * maxSeen 取「当前时间」与「历史高水位」的较大者：重新激活不重置时间天花板，
	 * 否则「回拨时钟 → 用新码激活」可以把上限压回早期时间。
	 */
	async activateVip(state: VipState, rawCode: string): Promise<void> {
		const baseMaxSeen = Math.max(Date.now(), this.vipSeal?.maxSeen ?? 0);
		this.vipSeal = await makeSeal(this.deviceId, rawCode, baseMaxSeen);
		this.vipState = state;
		// 解锁全部 VIP 增强功能（命令名去掉（VIP）标记）
		this.refreshVipGates();
		// 激活 VIP 后立即隐藏横幅并把广告状态置为「已展示」
		this.adBanner?.hide();
		if (!this.adState) {
			// 从未展示过，现在记录一次（下次不再弹）
			this.adState = markAdShown(this.adState);
		}
		await this.saveSettings();
	}

	// ---------- 广告横幅 ----------
	/** 按需展示广告横幅：VIP → 不弹；非 VIP 且 24h 内已展示 → 不弹 */
	private async showAdIfNeeded(): Promise<void> {
		const active = this.vipState?.active === true;
		if (!shouldShowAd(active, this.adState)) return;
		const newState = this.adBanner?.show(t("ad.message"));
		if (newState) {
			this.adState = newState;
			await this.saveSettings();
		}
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
		if (this.inFlight.has(file.path)) return; // 已在转换中，去重
		this.inFlight.add(file.path);
		try {
			await this.doAutoDetect(file);
		} finally {
			this.inFlight.delete(file.path);
		}
	}

	private async doAutoDetect(file: TFile): Promise<void> {

		const bytes: Uint8Array = new Uint8Array(await this.app.vault.readBinary(file));
		const det = detectEncoding(bytes, this.settings.confidenceThreshold);

		if (det.isUtf8) {
			// 本来就是 UTF-8，无事可做；但若 U+FFFD 超标，提示"上游已损坏"
			this.warnIfDamagedUtf8(file, bytes);
			return;
		}

		// 非 UTF-8：高置信度才静默转，低置信度只报告
		if (det.needsManualConfirm) {
			new Notice(
				`${PLUGIN_NAME}: ${file.path} ${t("notice.lowConfidence", {
					enc: det.encoding,
					n: det.confidence
				})}`
			);
			return;
		}

		// 高置信度 → 自动转换（仍带备份）
		try {
			const r = await convertFileToUtf8(this.app.vault, file, this.settings, true);
			this.track(r.record);
			if (r.converted) this.markSelfWritten(file.path);
		} catch (e) {
			this.trackFailure(file.path, e);
			new Notice(`${PLUGIN_NAME} ${t("notice.conversionFailed")} ${file.path}: ${(e as Error).message}`, 8000);
		}
	}

	// ---------- 手动命令 ----------
	private getActiveFile(): TFile | null {
		// Obsidian 标准 API：直接取活动文件
		return this.app.workspace.getActiveFile() ?? null;
	}

	/** 记录一条转换到内存（供导出） */
	private track(record: ConversionRecord | undefined): void {
		if (record) this.records.push(record);
	}

	/**
	 * 记录一次失败：内存 + 控制台 + 日志文件（JSONL）。
	 * 失败通知转瞬即逝，落盘后可用"导出转换日志"事后排查。
	 */
	private trackFailure(path: string, e: unknown): void {
		const rec = makeFailureRecord(
			path,
			(e instanceof Error ? e.message : String(e)) || "unknown error"
		);
		this.records.push(rec);
		console.warn("[code-converter] failure:", JSON.stringify(rec));
		if (this.settings.logFile) {
			appendToFile(this.app.vault, this.settings.logFile, rec).catch(() => {});
		}
	}

	/**
	 * 上游损坏警告：文件是合法 UTF-8，但 U+FFFD 替换字符占比达到阈值。
	 * 这种文件编码转换无法修复（原始字节已丢失），须明确告知用户原因。
	 * @returns true = 已弹出损坏警告
	 */
	private warnIfDamagedUtf8(file: TFile, bytes: Uint8Array): boolean {
		const damage = analyzeReplacementDamage(bytes);
		if (!isDamageOverThreshold(this.settings, damage.ratio)) return false;
		new Notice(
			`${PLUGIN_NAME}: ${file.path} ${t("notice.damagedUtf8", {
				n: damage.count,
				p: Math.round(damage.ratio * 100)
			})}`,
			10000
		);
		return true;
	}

	/** 导出转换日志（JSON / Markdown） */
	private async exportLog(format: "json" | "markdown"): Promise<void> {
		if (!this.records.length) {
			new Notice(`${PLUGIN_NAME}: ${t("notice.logEmpty")}`);
			return;
		}
		const target = defaultExportName(format);
		await exportLog(this.app.vault, this.records, format, target);
	}

	private async convertCurrentFile(): Promise<void> {
		const file = this.getActiveFile();
		if (!file) {
			new Notice(`${PLUGIN_NAME}: ${t("notice.noFile")}`);
			return;
		}
		const bytes: Uint8Array = new Uint8Array(await this.app.vault.readBinary(file));
		const det = detectEncoding(bytes, this.settings.confidenceThreshold);

		if (det.isUtf8) {
			// U+FFFD 超标 → 明确告知"为什么不能转"；否则常规提示
			if (!this.warnIfDamagedUtf8(file, bytes)) {
				new Notice(`${PLUGIN_NAME}: ${file.path} ${t("notice.alreadyUtf8")}`);
			}
			return;
		}

		// 低置信度 → 弹确认框；高置信度 → 直接转
		if (det.needsManualConfirm) {
			new EncodingConfirmModal(this.app, file, this.app.vault, this.settings, async (force) => {
				try {
					const r = await convertFileToUtf8(this.app.vault, file, this.settings, force);
					this.track(r.record);
					if (r.converted) this.markSelfWritten(file.path);
				} catch (e) {
					this.trackFailure(file.path, e);
					throw e;
				}
			}).open();
		} else {
			try {
				const r = await convertFileToUtf8(this.app.vault, file, this.settings, true);
				this.track(r.record);
				if (r.converted) this.markSelfWritten(file.path);
				else if (r.message) new Notice(r.message);
			} catch (e) {
				this.trackFailure(file.path, e);
				throw e;
			}
		}
	}

	/**
	 * 自动转换与「转换当前文件夹」共用的闸门：扩展名是否在白名单里。
	 * 手动「转换当前文件」故意不经过它——用户已经明确指定了目标文件。
	 */
	private isConvertibleFile(f: TFile): boolean {
		return isTextExtension(f.extension, parseExtensions(this.settings.textExtensions));
	}

	private async convertCurrentFolder(): Promise<void> {
		const file = this.getActiveFile();
		// 目标目录 = 活动文件所在目录；无活动文件 = 整个 vault。
		// ?? 不能用 getAbstractFileByPath("")——根路径是 "/"，传 "" 永远返回 null，
		// 旧写法导致"无活动文件时扫描整个 vault"静默失效；
		// 活动文件在 vault 根时 path.replace(/\/[^/]+$/,"") 也不剥文件名，root 会变成 TFile。
		// 正确做法：TFile.parent（TFolder，d.ts:6957）取父目录路径。
		const parentPath = file?.parent?.path ?? "";
		const rootPath = !parentPath || parentPath === "/" ? "" : parentPath;

		// 白名单：getMarkdownFiles() 会把范围焊死在 md 上，换 getFiles() 才受设置控制。
		// 二进制黑名单在 convertFileToUtf8 里兜底，这里不重复判。
		const extensions = parseExtensions(this.settings.textExtensions);
		const allFiles = this.app.vault.getFiles();
		const targets = allFiles.filter(
			(f) =>
				isTextExtension(f.extension, extensions) &&
				(!rootPath || f.path.startsWith(rootPath + "/"))
		);

		// force=false：低置信度文件跳过而非强转——与 README 安全设计一致
		// （"低置信度只报告不静默强转"）；跳过原因进控制台供排查。
		const r = await convertFilesToUtf8(this.app.vault, targets, this.settings, false);
		// 批量转换记录也进内存（供导出）
		for (const rec of r.records) this.records.push(rec);
		if (r.skippedList.length) {
			console.warn("[code-converter] skipped (low confidence etc.):", r.skippedList);
		}
		if (r.failed.length) {
			// 失败项逐条落盘（内存 + 控制台 + 日志文件），通知消失后仍可导出排查
			for (const fail of r.failed) {
				this.trackFailure(fail.path, new Error(fail.error));
			}
			new Notice(
				`${PLUGIN_NAME}: ${t("notice.folderDoneFail", {
					c: r.converted, s: r.skipped, f: r.failed.length
				})}`
			);
			// 控制台列出失败项
			console.warn("[code-converter] failures:", r.failed);
		} else {
			new Notice(
				`${PLUGIN_NAME}: ${t("notice.folderDone", {
					total: r.total, c: r.converted, s: r.skipped
				})}`
			);
		}
		// 疑似上游损坏（合法 UTF-8 但 U+FFFD 超标）的文件单独提示
		if (r.damaged.length) {
			new Notice(
				`${PLUGIN_NAME}: ${t("notice.folderDamaged", { n: r.damaged.length })}`,
				10000
			);
			console.warn("[code-converter] damaged files (U+FFFD excess):", r.damaged);
		}
	}

	/**
	 * 乱码修复：检测并修复"二次编码"乱码（合法 UTF-8 但内容历史上被错误解码回存）。
	 * 安全阀：必须合法 UTF-8 才进入；修复永远经确认弹窗；写回前备份；进日志。
	 */
	private async repairCurrentFile(): Promise<void> {
		const file = this.getActiveFile();
		if (!file) {
			new Notice(`${PLUGIN_NAME}: ${t("notice.noFile")}`);
			return;
		}
		const bytes: Uint8Array = new Uint8Array(await this.app.vault.readBinary(file));
		const det = detectEncoding(bytes, this.settings.confidenceThreshold);
		if (!det.isUtf8) {
			new Notice(`${PLUGIN_NAME}: ${file.path} ${t("repair.notUtf8")}`);
			return;
		}
		const text = new TextDecoder("utf-8").decode(bytes);
		const result = repairMojibake(text);
		if (!result.found) {
			let msg = `${PLUGIN_NAME}: ${file.path} ${t("repair.noIssue")}`;
			if (result.fffdCount > 0) {
				msg += ` ${t("repair.hasFFFD", { n: result.fffdCount })}`;
			}
			new Notice(msg);
			return;
		}
		new RepairConfirmModal(
			this.app,
			file.path,
			text,
			result,
			this.settings,
			async (proceed) => {
				if (!proceed) return;
				try {
					let backupPath = "";
					if (this.settings.backupBeforeConvert) {
						backupPath = await backupFile(
							this.app.vault,
							this.settings.backupDir,
							file.path
						);
					}
					await this.app.vault.modify(file, result.text);
					const record = makeRecord(
						file.path,
						`utf-8 mojibake(${result.chain})`,
						result.score,
						backupPath
					);
					logConversion(record, this.app.vault, this.settings);
					this.track(record);
					this.markSelfWritten(file.path);
					new Notice(
						`${PLUGIN_NAME}: ${t("notice.repairDone", {
							chain: result.chain ?? "-",
							r: result.repairedLines,
							s: result.scannedLines,
							n: result.score
						})}`
					);
				} catch (e) {
					this.trackFailure(file.path, e);
					new Notice(
						`${PLUGIN_NAME} ${t("notice.conversionFailed")} ${file.path}: ${(e as Error).message}`,
						8000
					);
				}
			}
		).open();
	}

	private async detectCurrentFile(): Promise<void> {
		const file = this.getActiveFile();
		if (!file) {
			new Notice(`${PLUGIN_NAME}: ${t("notice.noFile")}`);
			return;
		}
		const bytes: Uint8Array = new Uint8Array(await this.app.vault.readBinary(file));
		const det = detectEncoding(bytes, this.settings.confidenceThreshold);
		const preview = det.isUtf8
			? ""
			: decodeWithEncoding(bytes, det.encoding).slice(0, 120).replace(/\n/g, " ? ");

		// 损坏分析：合法 UTF-8 但 U+FFFD 超标 → 在报告中附加说明
		let damageInfo = "";
		if (det.isUtf8) {
			const damage = analyzeReplacementDamage(bytes);
			if (isDamageOverThreshold(this.settings, damage.ratio)) {
				damageInfo =
					"\n" +
					t("notice.damagedUtf8", {
						n: damage.count,
						p: Math.round(damage.ratio * 100)
					});
			}
		}

		new Notice(
			`${PLUGIN_NAME}: ${file.path}\n` +
				t("notice.detectOnly", {
					enc: det.isUtf8 ? "UTF-8" : det.encoding,
					bom: det.bom,
					n: det.confidence,
					preview: preview ? `\n${t("modal.preview")}: ${preview}` : ""
				}) + damageInfo,
			8000
		);
	}
}
