/**
 * 广告横幅（轻量支持作者条，移植自 desktoppet pet/AdBanner.ts）。
 *
 * 设计约束：
 * - 默认隐藏，仅由 main.ts 在启动后按频控策略驱动显隐（非 VIP 每日最多一次）；
 * - VIP 用户**永久不显示**（已付费，不用看广告）；
 * - 非 VIP 用户**每次启动最多展示一次**（防刷屏，也减少反感）；
 * - 文案来自 i18n key，URL 由作者硬编码配置；
 * - 纯客户端：广告配置不联网拉取，随插件发版。
 * - 支持多赞助渠道并列（中国大陆用户优先国内平台）。
 *
 * 实现：一个挂在 `document.body` 底部的固定条，初始 `display:none`，
 * 通过 CSS opacity + visibility 过渡显隐。
 */

/** 单个赞助渠道 */
export interface SponsorChannel {
	/** i18n key，指向渠道名 */
	nameKey: string;
	/** 跳转目标 URL */
	url: string;
}

/** 广告配置（作者侧控制，用户不可编辑） */
export interface AdConfig {
	/** i18n key，指向文案 */
	messageKey: string;
	/** 默认跳转 URL（点击横幅主体按钮时打开） */
	targetUrl: string;
	/** 多赞助渠道（中国大陆支持国内平台） */
	channels?: SponsorChannel[];
}

/** 每次启动最多展示一次的节流窗口（ms）—— 同一天内第二次启动不再弹 */
const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface AdState {
	config: AdConfig;
	/** 最近一次展示时间（ms）；未展示过 = 0 */
	lastShownAt: number;
}

const DEFAULT_CONFIG: AdConfig = {
	messageKey: "ad.message",
	targetUrl: "https://github.com/sponsors/xiaosong8584",
	channels: [
		{ nameKey: "ad.channel.afdian", url: "https://afdian.com/a/xiaosong8584" },
		{ nameKey: "ad.channel.bilibili", url: "https://space.bilibili.com/505631203" },
		{ nameKey: "ad.channel.github", url: "https://github.com/sponsors/xiaosong8584" }
	]
};

export function defaultAdConfig(): AdConfig {
	return { ...DEFAULT_CONFIG };
}

/**
 * 判断是否需要展示：VIP 时强制不展示；非 VIP 时按每日频次限制。
 * 纯逻辑函数（不碰 DOM），便于单元测试。
 */
export function shouldShowAd(vipActive: boolean, state: AdState | null): boolean {
	if (vipActive) return false;
	if (!state) return true; // 首次启动，无记录
	const elapsed = Date.now() - state.lastShownAt;
	return elapsed >= DAILY_INTERVAL_MS;
}

/** 标记本次启动已展示（落盘用的就是返回的新 state） */
export function markAdShown(state: AdState | null): AdState {
	return {
		config: state?.config ?? defaultAdConfig(),
		lastShownAt: Date.now()
	};
}

/**
 * 轻量广告横幅 DOM 工厂。
 *
 * 挂载到 document.body，定位底部居中，透明过渡。
 * VIP 激活 / onunload 时由外部调 `dispose()` 移除 DOM。
 */
export class AdBanner {
	private el: HTMLElement | null = null;
	private msgEl: HTMLElement | null = null;
	private channelsEl: HTMLElement | null = null;
	private state: AdState | null = null;

	constructor(
		private readonly onOpenUrl: (url: string) => void,
		/** 文案翻译函数（注入式，便于测试；生产传 i18n 的 t） */
		private readonly translate: (key: string) => string,
		/** 关闭回调（可选）：外部可据此把「今日已展示」落盘 */
		private readonly onClose?: () => void
	) {}

	/** 挂载到 body，初始隐藏 */
	mount(): void {
		if (this.el) return;
		const el = document.createElement("div");
		el.className = "cc-ad-banner";
		el.setAttribute("role", "complementary");
		el.setAttribute("aria-label", "Support the author");
		el.style.display = "none";

		// 文案
		const msgEl = document.createElement("span");
		msgEl.className = "cc-ad-banner__text";
		el.appendChild(msgEl);
		this.msgEl = msgEl;

		// 主跳转按钮
		const openBtn = document.createElement("button");
		openBtn.className = "cc-ad-banner__open";
		openBtn.textContent = this.translate("ad.openBtn");
		openBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.onOpenUrl(this.state?.config?.targetUrl ?? DEFAULT_CONFIG.targetUrl);
		});
		el.appendChild(openBtn);

		// 赞助渠道按钮行
		const channelsEl = document.createElement("div");
		channelsEl.className = "cc-ad-banner__channels";
		el.appendChild(channelsEl);
		this.channelsEl = channelsEl;

		// 关闭按钮
		const closeBtn = document.createElement("button");
		closeBtn.className = "cc-ad-banner__close";
		closeBtn.setAttribute("aria-label", "Close");
		closeBtn.textContent = "\u00d7";
		closeBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.hide();
			this.onClose?.();
		});
		el.appendChild(closeBtn);

		document.body.appendChild(el);
		this.el = el;
		this.setState(this.state);
	}

	setState(state: AdState | null): void {
		this.state = state;
		if (!this.el) return;
		const key = state?.config?.messageKey ?? DEFAULT_CONFIG.messageKey;
		if (this.msgEl) this.msgEl.textContent = this.translate(key);
		this.renderChannels(state?.config?.channels ?? DEFAULT_CONFIG.channels);
	}

	/** 渲染赞助渠道按钮行 */
	private renderChannels(channels: SponsorChannel[] | undefined): void {
		if (!this.channelsEl) return;
		this.channelsEl.textContent = "";
		if (!channels || channels.length === 0) return;
		for (const ch of channels) {
			const btn = document.createElement("button");
			btn.className = "cc-ad-banner__channel";
			btn.textContent = this.translate(ch.nameKey);
			btn.addEventListener("click", (e) => {
				e.stopPropagation();
				this.onOpenUrl(ch.url);
			});
			this.channelsEl.appendChild(btn);
		}
	}

	/**
	 * 显示横幅（同时把「已展示」标记回写 caller）。
	 *
	 * @param onMessage 覆盖文案的字符串（为 null 时读 state.config.messageKey + translate）
	 * @returns 更新后的 state（含 lastShownAt），调用方须落盘
	 */
	show(onMessage?: string | null): AdState | null {
		if (!this.el) return this.state;
		if (onMessage != null && this.msgEl) {
			this.msgEl.textContent = onMessage;
		}
		this.el.style.display = "";
		this.el.classList.remove("cc-ad-banner--hidden");
		return markAdShown(this.state);
	}

	hide(): void {
		if (!this.el) return;
		this.el.classList.add("cc-ad-banner--hidden");
		// 等 CSS transition 结束再 display:none，避免闪烁
		const el = this.el;
		setTimeout(() => {
			if (el.classList.contains("cc-ad-banner--hidden")) el.style.display = "none";
		}, 320);
	}

	/** 完整释放（onunload 时调用） */
	dispose(): void {
		this.state = null;
		this.msgEl = null;
		this.channelsEl = null;
		if (this.el) {
			this.el.remove();
			this.el = null;
		}
	}
}
