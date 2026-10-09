/*
 * @description DeepSeek Harness 会话修改审查插件客户端 UI：会话「审查」标签页、
 *             轮次内变更卡片、输入框上方实时变更面板（LivePanel）、颜色自定义、编辑器选择器、上下文菜单。
 * @author chenzhenyao / cirelir
 * @date 2026-08-21
 */
window.__ModuleLoader__.load({
	id: "dsh-change-review-live",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		let ReactDOM = null;
		try { ReactDOM = require("react-dom"); } catch (e) { ReactDOM = null; }

		// ── color configuration (persisted to localStorage) ────────────────
		const LS_KEY = "dsh.diff-review.colors";
		// 长行折行开关（纯客户端显示偏好，跨会话记住）：只认 "0" 为关闭，其余一律折行
		const WRAP_LS_KEY = "dsh.diff-review.wrap";
// 上下文展开：**按处**分阶段放大 0 → 20 → 50 → 100 → 全部（CTX_ALL）——点「省略 N 行」
// 只放出**被点的那一处**省略行（贴改动那一端由近及远，夹在两个改动之间时两侧各一半），
// 同段其它省略块与其它段一行不动。档位**只存组件内、不落盘**：关闭重开、组件重挂载、
// 点「刷新」都回到最初状态；作用域 =「文件 + 对比模式」，换文件 / 换对比模式即作废。
const CTX_ALL = -1;                        // 哨兵：这一处不折叠、剩余全放（Host 见负值放完这一处）
const CTX_LEVELS = [0, 20, 50, 100, CTX_ALL];
// 某一段的档位 → 下一档（到顶后停在 CTX_ALL）
function nextCtxLevel(level) {
	const at = CTX_LEVELS.indexOf(Number(level) || 0);
	return CTX_LEVELS[Math.min((at < 0 ? 0 : at) + 1, CTX_LEVELS.length - 1)];
}
		function loadWrap() {
			try { return localStorage.getItem(WRAP_LS_KEY) !== "0"; } catch (e) { return true; }
		}
		// 面板拖拽/自适应高度的持久化键：刷新或重启后恢复上次生效的面板高度
		const PANEL_H_LS_KEY = "dsh.diff-review.panelHeight";
		// 面板展开/折叠状态（按会话记忆）：**只由用户点击写入**。放在组件外是因为
		// 面板会在新轮次/会话重建时被 React 重新挂载，组件内 state 会被重置回默认值
		// 而表现为「自动折叠」——已经打开的面板必须保持打开。Host 端另有一份持久化
		// （见 LivePanel 的 setCollapsed），两者一起保证跨重挂载、跨刷新都不折叠。
		const livePanelCollapsed = {};
		// 各「会话|轮次」最近一次取到的文件列表（模块级，跨重挂载存活）：面板被重新挂载或
		// 同轮次内因新改动重取时先拿它渲染，不再闪一下「加载当前轮次…」；只有真正换了
		// 轮次/会话且没有缓存时才显示加载提示。上限 LIVE_TURN_CACHE_MAX 项，防止长会话里无限堆积。
		const liveTurnCache = {};
		const LIVE_TURN_CACHE_MAX = 8;
		function rememberTurnFiles(key, files) {
			liveTurnCache[key] = files;
			const keys = Object.keys(liveTurnCache);
			// Object.keys 对字符串键保持插入顺序：超限就丢最早插入的那些
			for (let i = 0; i < keys.length - LIVE_TURN_CACHE_MAX; i++) {
				delete liveTurnCache[keys[i]];
			}
		}
		// 默认色板：One Dark Pro 色系（2026-09-18 定稿）
		// · 行文字恢复彩色：增行绿字、删行红字——增删不再只靠底色区分
		// · 行底色用同色系低饱和淡底，配合 CSS 的「色弱强化」拉开明度差
		//   （左侧 3px 色条 + 增行提亮 / 删行压暗 + 符号列加粗，见 .drv-add / .drv-del）
	// · ctxBg 极淡底色（2026-09-20 第十三轮回头改）：用户要求「整张卡片都是连续色块」，
	//   上下文行不再全透明；原先「深色下不要一坨 #161b22」的诉求由「极淡」而不是「透明」满足
		const LIGHT = { addBg: "rgba(80, 161, 79, 0.24)", addFg: "#1a7f37", delBg: "rgba(228, 86, 73, 0.2)", delFg: "#cf222e", ctxBg: "rgba(0, 0, 0, 0.03)", gutter: "#8a8b91", badgeBg: "#4078f2", badgeFg: "#ffffff", turnAdd: "#50a14f", turnDel: "#e45649", turnBg: "rgba(193, 132, 1, 0.1)", turnBorder: "#c18401", latestName: "#4078f2", qText: "#a626a4" };
		const DARK = { addBg: "rgba(152, 195, 121, 0.26)", addFg: "#7ee787", delBg: "rgba(224, 108, 117, 0.24)", delFg: "#ffa198", ctxBg: "rgba(255, 255, 255, 0.04)", gutter: "#6f7783", badgeBg: "#61afef", badgeFg: "#1b1f26", turnAdd: "#98c379", turnDel: "#e06c75", turnBg: "rgba(229, 192, 123, 0.12)", turnBorder: "#e5c07b", latestName: "#61afef", qText: "#c678dd" };
		// 上一版默认（2026-09-18 上午的 GitHub 风：行文字用中性前景色）——仅用于
		// 识别「从没改过颜色」的存档并迁移到新默认，别删：删了老存档会被当成自定义
		const PREV_LIGHT = { addBg: "#e6ffec", addFg: "#1f2328", delBg: "#ffebe9", delFg: "#1f2328", ctxBg: "#f6f8fa", gutter: "#57606a", badgeBg: "#0969da", badgeFg: "#ffffff", turnAdd: "#1a7f37", turnDel: "#cf222e", turnBg: "rgba(255, 183, 77, 0.1)", turnBorder: "#ffb74d", latestName: "#0969da", qText: "#8250df" };
		const PREV_DARK = { addBg: "rgba(46, 160, 67, 0.15)", addFg: "#e6edf3", delBg: "rgba(248, 81, 73, 0.15)", delFg: "#e6edf3", ctxBg: "#161b22", gutter: "#8b949e", badgeBg: "#4493f8", badgeFg: "#0d1117", turnAdd: "#7ee787", turnDel: "#ffa198", turnBg: "rgba(255, 183, 77, 0.1)", turnBorder: "#ffb74d", latestName: "#4493f8", qText: "#d2a8ff" };
		// 更早一版的旧默认色板：同样只用于识别「从没改过颜色」的存档
		const OLD_LIGHT = { addBg: "#e6ffec", addFg: "#1a7f37", delBg: "#ffebe9", delFg: "#cf222e", ctxBg: "#f6f8fa", gutter: "#57606a", badgeBg: "#0969da", badgeFg: "#ffffff", turnAdd: "#1a7f37", turnDel: "#cf222e", turnBg: "rgba(255, 183, 77, 0.1)", turnBorder: "#ffb74d", latestName: "#0969da", qText: "#8250df" };
		const OLD_DARK = { addBg: "#10251c", addFg: "#7ee787", delBg: "#2d1415", delFg: "#ffa198", ctxBg: "#161b22", gutter: "#8b949e", badgeBg: "#4493f8", badgeFg: "#0d1117", turnAdd: "#7ee787", turnDel: "#ffa198", turnBg: "rgba(255, 183, 77, 0.1)", turnBorder: "#ffb74d", latestName: "#4493f8", qText: "#d2a8ff" };
		const DEFAULTS = Object.assign({}, LIGHT);
		const COLOR_KEYS = Object.keys(DEFAULTS);

		function loadSavedColors() {
			try {
				const raw = localStorage.getItem(LS_KEY);
				if (!raw) return null;
				const obj = JSON.parse(raw);
				if (!obj || typeof obj !== "object") return null;
				const out = Object.assign({}, DEFAULTS);
				let ok = false;
				for (const k of COLOR_KEYS) {
					const parsed = parseColor(obj[k]);
					if (parsed) {
						out[k] = formatRgba(parsed);
						ok = true;
					}
				}
				return ok ? out : null;
			} catch (e) {
				return null;
			}
		}
		function saveColors(colors) {
			try {
				localStorage.setItem(LS_KEY, JSON.stringify(colors));
			} catch (e) {}
		}
		// 色板归一化为存档格式（parseColor→formatRgba），用于与存档逐键比较
		function normalizeColors(p) {
			const out = {};
			for (const k of COLOR_KEYS) {
				const c = parseColor(p[k]);
				out[k] = c ? formatRgba(c) : p[k];
			}
			return out;
		}

		// ── color value helpers (hex #rrggbb and rgba(r,g,b,a) both supported) ──
		function parseColor(v) {
			if (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v)) {
				return { r: parseInt(v.slice(1, 3), 16), g: parseInt(v.slice(3, 5), 16), b: parseInt(v.slice(5, 7), 16), a: 1 };
			}
			if (typeof v === "string") {
				const m = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+)\s*)?\)$/);
				if (m) {
					const a = m[4] === undefined ? 1 : Number(m[4]);
					return {
						r: Math.min(255, Math.max(0, parseInt(m[1], 10))),
						g: Math.min(255, Math.max(0, parseInt(m[2], 10))),
						b: Math.min(255, Math.max(0, parseInt(m[3], 10))),
						a: Math.min(1, Math.max(0, a))
					};
				}
			}
			return null;
		}
		function formatRgba(c) {
			return "rgba(" + c.r + ", " + c.g + ", " + c.b + ", " + (Math.round(c.a * 100) / 100) + ")";
		}
		function hexOf(c) {
			const pad = (n) => n.toString(16).padStart(2, "0");
			return "#" + pad(c.r) + pad(c.g) + pad(c.b);
		}

		// ── shared store ───────────────────────────────────────────────────
		const EDITOR_LS_KEY = "dsh.diff-review.editor";
		const store = {
			files: null, loadingFiles: false,
			selected: null, detail: null, loadingDetail: false, error: null,
			colors: Object.assign({}, DEFAULTS), currentSession: null,
			mode: "session", latestTurn: 0, currentTurn: 0, turnData: null,
			editors: [], editorLoading: false, selectedEditor: null,
			// 当前 DSH 外观（light/dark），用于让颜色随主题切换
			scheme: "light",
			// 每次 SSE 数据刷新 +1：驱动轮次卡片等组件在对话过程中实时重拉数据
			reviewTick: 0,
			// 自定义确认弹窗的待办项：{ message, resolve }，见 askConfirm/ConfirmPrompt
			pendingConfirm: null
		};
		// 是否持久化过用户自定义颜色（存在旧存档时视为已自定义）
		let hasSavedColors = false;
		{
			const savedColors = loadSavedColors();
			if (savedColors) {
				// 存档与任何一版历史默认完全一致 = 用户从未自定义过颜色：
				// 丢弃存档，让后续初始化改用新默认色板（真自定义过的存档不动）
				const s = JSON.stringify(savedColors);
				const KNOWN_DEFAULTS = [PREV_LIGHT, PREV_DARK, OLD_LIGHT, OLD_DARK];
				if (KNOWN_DEFAULTS.some((p) => JSON.stringify(normalizeColors(p)) === s)) {
					try { localStorage.removeItem(LS_KEY); } catch (e) {}
				} else {
					store.colors = savedColors;
					hasSavedColors = true;
				}
			}
			try {
				const ed = localStorage.getItem(EDITOR_LS_KEY);
				if (ed) store.selectedEditor = JSON.parse(ed);
			} catch (e) {}
		}
		const listeners = new Set();
		function notify() { listeners.forEach((fn) => fn()); }
		// ── theme-driven palette：颜色随宿主外观（浅色/深色）走 ──────────────
		function paletteFor(scheme) { return scheme === "dark" ? DARK : LIGHT; }

		// ── 文件状态徽章（新增 / 修改 / 删除）──────────────────────────────
		// 状态由宿主判定：added = 会话内新建（首个 op 的 before 为 null）；
		// deleted = 当前磁盘上已不存在（含新建后又被删掉、改过又被删掉）；
		// 其余为 modified。颜色复用现有色板，不新增可配置色：新增用 turnAdd
		// （绿）、删除用 turnDel（红）、修改用 latestName（蓝）。
		const STATUS_LABEL = { added: "新增", modified: "修改", deleted: "删除" };
		const STATUS_TITLE = {
			added: "本次会话新增的文件",
			modified: "本次会话修改的文件",
			deleted: "文件已从磁盘删除（仍可查看 / 撤回会话内的修改）"
		};
		function statusColorOf(colors, status) {
			if (status === "added") { return colors.turnAdd; }
			if (status === "deleted") { return colors.turnDel; }
			return colors.latestName;
		}
		function StatusChip({ status, colors }) {
			const label = STATUS_LABEL[status];
			if (!label) { return null; }
			return React.createElement("span", {
				className: "dsdrv-status dsdrv-status-" + status,
				title: STATUS_TITLE[status] || label,
				style: { color: statusColorOf(colors, status) }
			}, label);
		}
		// 仅更新颜色并通知视图，不写入 localStorage：
		// 外观驱动的默认色不应被持久化，否则下次以其它外观启动时会读到与当前外观不符的旧色。
		function setColorsQuiet(colors) { store.colors = colors; notify(); }
		function setState(patch) {
			Object.assign(store, patch);
			if (patch.colors) saveColors(patch.colors);
			notify();
		}
		function useStore(selector) {
			const [v, setV] = React.useState(() => selector(store));
			React.useEffect(() => {
				const fn = () => setV(selector(store));
				listeners.add(fn);
				return () => listeners.delete(fn);
			}, []);
			return v;
		}

		// ── 自定义确认弹窗：不用原生 window.confirm ────────────────────────
		// DSH 的 WebView 里原生 confirm 是同步浏览器模态，关闭后容易把富文本
		// 输入框的 focus/IME 状态弄坏（表现为撤回后输入框一直无法输入，刷新才
		// 恢复）。这里改用页面内的非阻塞确认，避免触发浏览器原生模态。
		function askConfirm(message) {
			return new Promise((resolve) => {
				store.pendingConfirm = { message, resolve };
				notify();
			});
		}
		function ConfirmPrompt() {
			const pending = useStore((s) => s.pendingConfirm);
			if (!pending) return null;
			const dismiss = (okValue) => {
				const p = store.pendingConfirm;
				if (!p) return;
				store.pendingConfirm = null;
				notify();
				if (typeof p.resolve === "function") p.resolve(okValue);
			};
			return React.createElement("div", {
				className: "dsdrv-modal-mask",
				onMouseDown: (e) => { e.stopPropagation(); }
			},
				React.createElement("div", { className: "dsdrv-modal", role: "dialog", "aria-modal": true },
					React.createElement("div", { className: "dsdrv-modal-text" }, pending.message),
					React.createElement("div", { className: "dsdrv-modal-btns" },
						React.createElement("button", { type: "button", className: "drv-btn", onClick: () => dismiss(false) }, "取消"),
						React.createElement("button", { type: "button", className: "drv-btn drv-btn-danger", onClick: () => dismiss(true) }, "确定"))));
		}

		// ── fetch sequencing: every async load stamps a token; a stale response
		// (previous session / superseded file) is dropped instead of clobbering the UI
		let reqSeq = 0

		// ── host file-open helper (chat's openFile equivalent, built from ctx).
		// If the user picked an editor in the header chooser, open through the
		// Host's /diff-review/open-with-editor route; otherwise OS default.
		let ctxRef = null
		let rtApi = null
		try { rtApi = require("@deepseek-ai/dsh-client-runtime/client"); } catch (e) { rtApi = null; }
		function resolveAbsPath(sessionId, path, cwd) {
			try {
				if (!ctxRef) return path
				// Use the provided cwd (from file data) first, then fall back to session's current cwd
				if (!cwd && ctxRef.sessions && ctxRef.sessions.list) {
					const byId = ctxRef.sessions.list.getSnapshot().byId
					cwd = byId && byId[sessionId] && byId[sessionId].cwd
				}
				if (rtApi && rtApi.resolveWorkspacePath) return rtApi.resolveWorkspacePath(cwd, path)
				if (cwd && typeof path === "string" && !path.startsWith("/") && !/^[a-zA-Z]:[\/]/.test(path)) {
					return cwd.replace(/[\/]+$/, "") + "/" + path.replace(/^[\/]+/, "")
				}
				return path
			} catch (e) { return path }
		}
		function openFileFor(sessionId, path, cwd) {
			try {
				const abs = resolveAbsPath(sessionId, path, cwd)
				const ed = store.selectedEditor
				if (ed && ed.id) {
					apiOpenWithEditor(ed.id, abs).then((v) => {
						if (!(v && v.ok) && !openInSidebar(sessionId, path, cwd)) openWithDefaultApp(abs)
					}).catch(() => { if (!openInSidebar(sessionId, path, cwd)) openWithDefaultApp(abs) })
					return
				}
				if (openInSidebar(sessionId, path, cwd)) return
				openWithDefaultApp(abs)
			} catch (e) {}
		}
		// ── dsh-resource 文件地址 ──────────────────────────────────────────
		// 内联自 @deepseek-ai/dsh-util-workspace-path 的 file-address.ts /
		// fileAddressFor：该包没有 client 入口，浏览器 bundle 无法 require，
		// 官方 ui-chat 也是内联这份实现。文档预览 tab 注册的 pattern 是
		// dsh-resource://file/**，且只认 session 作用域（absolute 作用域读不了），
		// 因此地址固定是 session/<sessionId>/<path>。
		const FILE_ADDRESS_PREFIX = "dsh-resource://file/";
		// 段编码：保留盘符的冒号（C: 不能编码成 C%3A）
		function encodeAddrSegment(segment) { return encodeURIComponent(segment).replace(/%3A/gi, ":"); }
		function encodeAddrPath(path) { return path.split("/").map(encodeAddrSegment).join("/"); }
		function sessionFileAddress(sessionId, path) {
			const normalized = String(path).replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
			return FILE_ADDRESS_PREFIX + "session/" + encodeAddrSegment(sessionId) + "/" + encodeAddrPath(normalized);
		}
		// 绝对路径判定：POSIX 前缀 /、Windows 盘符或 UNC
		function isAbsoluteWorkspacePath(value) {
			return value.startsWith("/") || /^[A-Za-z]:[/\\]/.test(value) || value.indexOf("\\\\") === 0;
		}
		// 会话工作区内的绝对路径转相对（宿主按会话工作区解析相对路径），
		// 工作区外的绝对路径原样保留（宿主允许读工作区外的文件）
		function fileAddressFor(sessionId, cwd, path) {
			const normalized = String(path).replace(/\\/g, "/");
			if (!isAbsoluteWorkspacePath(normalized)) return sessionFileAddress(sessionId, normalized);
			const root = (cwd === undefined || cwd === null) ? "" : String(cwd).replace(/\\/g, "/").replace(/\/+$/, "");
			if (root !== "" && normalized === root) return sessionFileAddress(sessionId, "");
			if (root !== "" && normalized.indexOf(root + "/") === 0) return sessionFileAddress(sessionId, normalized.slice(root.length + 1));
			return sessionFileAddress(sessionId, normalized);
		}

		// 取官方右侧栏导航控制器 ctx.sidebarRight：未声明在 inject 里，属性直读
		// 受 inject 约束会 throw，故先 ctx.get 再兜底属性直读（第三方
		// dsh-better-sidebar 同样用 ctx.get）。拿不到返回 null。
		function sidebarRightService() {
			let svc = null;
			try {
				if (ctxRef && typeof ctxRef.get === "function") { svc = ctxRef.get("sidebarRight"); }
			} catch (e) { svc = null; }
			if (!svc && ctxRef) {
				try { svc = ctxRef.sidebarRight; } catch (e) { svc = null; }
			}
			return (svc && typeof svc.openResource === "function") ? svc : null;
		}

		// ── 本插件自己的「审查 diff」资源地址 ────────────────────────────────
		// dsh-resource://diff-review/session/<sessionId>/<整段编码的原始路径>。
		// 路径整体作为**一段**编码（反斜杠 → %5C、盘符冒号保留），这样能逐字
		// 还原工具入参里的原始路径——宿主的 files.get(path) 是精确匹配，路径
		// 必须一模一样。资源地址即 tab 的去重键（同地址重复打开只聚焦）。
		const DIFF_ADDRESS_PREFIX = "dsh-resource://diff-review/";
		const DIFF_TAB_ID = "dsh-change-review-live:diff-review";
		const DIFF_TAB_KIND = "diff-review";
		function diffAddressFor(sessionId, path) {
			return DIFF_ADDRESS_PREFIX + "session/" + encodeAddrSegment(sessionId) + "/" +
				encodeURIComponent(String(path)).replace(/%3A/gi, ":");
		}
		function diffTargetOfAddress(address) {
			try {
				if (typeof address !== "string" || address.indexOf(DIFF_ADDRESS_PREFIX) !== 0) return null;
				const rest = address.slice(DIFF_ADDRESS_PREFIX.length);
				if (rest.indexOf("session/") !== 0) return null;
				const tail = rest.slice("session/".length);
				const cut = tail.indexOf("/");
				if (cut <= 0) return null;
				const sessionId = decodeURIComponent(tail.slice(0, cut));
				const path = decodeURIComponent(tail.slice(cut + 1));
				if (!sessionId || !path) return null;
				return { sessionId: sessionId, path: path };
			} catch (e) { return null; }
		}
		// chip 文字：与同名文件 tab 区分（文件名 tab 显示 basename）
		function diffTabTitle(address) {
			const target = diffTargetOfAddress(address);
			const base = target ? (String(target.path).split(/[\/\\]/).pop() || target.path) : "diff";
			return base + " (diff)";
		}
		// 侧栏 diff tab 的 chip 内容：宿主 tab 定义只有 title 文本、没有图标字段，
		// 而 sidebar.right.pane.tab.title 席位就是 chip 本身的内容，图标在这里补。
		// 标题文字仍从 contentId 现算（与 tabs.register 的 title 同源），chip 不会
		// 与宿主打开时捕获的旧标题脱节。
		const DIFF_TAB_ICON_SIZE = 14;
		function DiffTabTitle(props) {
			// 图标配色取插件色板（随明暗外观与设置里的自定义颜色走）
			const colors = useStore((s) => s.colors);
			// useTabInfo 是席位框架注入的 hook：与 DiffPane 同款写法，无条件调用；
			// 老宿主没有这个 prop 时退化为纯文字标题。
			const info = (typeof props.useTabInfo === "function") ? props.useTabInfo() : null;
			const tab = info && info.tab;
			const address = (tab && tab.contentId) || "";
			const label = address ? diffTabTitle(address) : ((tab && tab.title) || "diff");
			// 语义色兜底：store 尚未初始化时用浅色主题的红/绿
			const delColor = (colors && colors.turnDel) || "#cf222e";
			const addColor = (colors && colors.turnAdd) || "#1a7f37";
			return React.createElement("span", { className: "dsdrv-tabtitle" },
				React.createElement("span", { className: "dsdrv-tabicon", "aria-hidden": "true" },
					// 左右两块面板 = 改动前/后两份内容，左减号、右加号 = diff；
					// 配色用语义色：左（改动前）turnDel 红、右（改动后）turnAdd 绿
					React.createElement("svg", { width: DIFF_TAB_ICON_SIZE, height: DIFF_TAB_ICON_SIZE, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" },
						React.createElement("g", { stroke: delColor },
							React.createElement("rect", { x: 3, y: 4, width: 7.5, height: 16, rx: 1.5 }),
							React.createElement("path", { d: "M5 12h3.5" })),
						React.createElement("g", { stroke: addColor },
							React.createElement("rect", { x: 13.5, y: 4, width: 7.5, height: 16, rx: 1.5 }),
							React.createElement("path", { d: "M15.5 12h4" }),
							React.createElement("path", { d: "M17.5 10v4" })))),
				React.createElement("span", { className: "dsdrv-tablabel" }, label));
		}

		// 在侧栏打开该文件的 diff tab（我们自注册的类型）；服务缺失或地址无人
		// 认领（类型未注册）时返回 false，由调用方降级。
		function openSidebarDiff(sessionId, path) {
			if (!sessionId || !path) return false;
			try {
				const svc = sidebarRightService();
				if (!svc) return false;
				svc.openResource(diffAddressFor(sessionId, path));
				return true;
			} catch (e) {
				console.warn("[diff-review] 侧栏 diff tab 打开失败，降级为在侧栏打开文件", e);
				return false;
			}
		}

		// 在 DSH 右侧 Sidebar 打开文件（官方 sidebarRight.openResource）
		function openInSidebar(sessionId, path, cwd) {
			try {
				if (!sessionId || !path) return false;
				const svc = sidebarRightService();
				if (!svc) return false;
				svc.openResource(fileAddressFor(sessionId, cwd, path));
				return true;
			} catch (e) {
				console.warn("[diff-review] 右侧 Sidebar 打开失败，降级为系统默认打开", e);
				return false;
			}
		}

		// 用系统默认程序打开：交给宿主 /diff-review/open（Host 端 spawn 系统
		// 打开器）。此前调用的 ctx.workspaces.openPath 在桌面端并不存在，
		// 整个函数静默 no-op，点击文件名没有任何反应。
		function openWithDefaultApp(abs) {
			if (!abs) return;
			fetch("/diff-review/open", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ path: abs })
			}).catch(() => {});
		}
		// 打开文件：优先在 DSH 右侧 Sidebar 内预览（官方 ctx.sidebarRight），
		// 服务不可用/地址被拒时降级为系统默认程序打开。
		function openFileDefault(f, sessionId) {
			const path = (f && f.path) || "";
			const cwd = (f && f.cwd) || "";
			if (openInSidebar(sessionId, path, cwd)) return;
			openWithDefaultApp((f && f.absPath) || resolveAbsPath(sessionId, path, cwd));
		}

		// ── host data via HTTP routes ──────────────────────────────────────
		function apiSummary(session) { return fetch("/diff-review/summary?session=" + encodeURIComponent(session)).then((r) => r.json()); }
		// ctx：每个变更块保留的上下文行数；sctx：**按段**展开档位（"段序号:行数,..."，
		// 负值＝该段全部展开）——只影响列出的那几段，其余段走服务端默认折叠
		function apiFile(session, path, ctx, sctx) { const c = Number(ctx); const q = (Number.isFinite(c) ? "&ctx=" + c : "") + (sctx ? "&sctx=" + encodeURIComponent(sctx) : ""); return fetch("/diff-review/file?session=" + encodeURIComponent(session) + "&path=" + encodeURIComponent(path) + q).then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }); }
		function apiAgainst(session, path, mode, ctx, sctx) { const c = Number(ctx); const q = (Number.isFinite(c) ? "&ctx=" + c : "") + (sctx ? "&sctx=" + encodeURIComponent(sctx) : ""); return fetch("/diff-review/against?session=" + encodeURIComponent(session) + "&path=" + encodeURIComponent(path) + "&mode=" + encodeURIComponent(mode) + q).then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }); }
		function apiClear(session) { return fetch("/diff-review/clear?session=" + encodeURIComponent(session), { method: "POST" }).then((r) => r.json()); }
		function apiRevert(session, path, op) {
			return fetch("/diff-review/revert?session=" + encodeURIComponent(session), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ path: path, op: op === undefined ? null : op })
			}).then((r) => r.json());
		}
		function apiTurn(session, turn) {
			return fetch("/diff-review/turn?session=" + encodeURIComponent(session) + "&turn=" + encodeURIComponent(String(turn))).then((r) => r.json());
		}
		function apiEditors() { return fetch("/diff-review/editors").then((r) => r.json()); }
		function apiOpenWithEditor(editor, path, line, col) {
			return fetch("/diff-review/open-with-editor", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ editor, path, line: line || null, col: col || null })
			}).then((r) => r.json());
		}
		function apiReveal(path) {
			return fetch("/diff-review/reveal", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ path })
			}).then((r) => r.json());
		}
		function revealInFinderFor(sessionId, path, cwd) {
			const abs = resolveAbsPath(sessionId, path, cwd);
			apiReveal(abs).catch(() => {});
		}
		function loadEditors() {
			setState({ editorLoading: true });
			apiEditors().then((v) => {
				const editors = (v && v.editors) || [];
				// Never overwrite selectedEditor — it's persisted from localStorage
				// and only changed by the user's explicit selection via selectEditor().
				setState({ editors, editorLoading: false });
			}).catch(() => {
				setState({ editorLoading: false });
			});
		}
		function selectEditor(ed) {
			setState({ selectedEditor: ed });
			try {
				if (ed && ed.id) localStorage.setItem(EDITOR_LS_KEY, JSON.stringify({ id: ed.id, name: ed.name }));
				else localStorage.removeItem(EDITOR_LS_KEY);
			} catch (e) {}
		}

		function loadSummary() {
			const session = store.currentSession;
			if (!session) return;
			const seq = ++reqSeq;
			setState({ loadingFiles: true, error: null });
			apiSummary(session).then((v) => {
				if (seq !== reqSeq || store.currentSession !== session) return;
				setState({ files: (v && v.files) || [], latestTurn: (v && typeof v.latestTurn === "number") ? v.latestTurn : 0, currentTurn: (v && typeof v.currentTurn === "number") ? v.currentTurn : 0, loadingFiles: false, reviewTick: store.reviewTick + 1 });
				if (store.mode === "latest") loadLatest();
			}).catch((e) => {
				if (seq !== reqSeq || store.currentSession !== session) return;
				setState({ error: String((e && e.message) || e), loadingFiles: false });
			});
		}
		// Latest-turn view: files + sections for the most recent recorded turn.
		function loadLatest() {
			const session = store.currentSession;
			// 轮次取「当前轮次」（宿主在每轮开始即给出），旧记录没有轮次信息时退回最近有记录的轮次
			const turn = store.currentTurn > 0 ? store.currentTurn : store.latestTurn;
			if (!session || !turn) { setState({ turnData: null }); return; }
			const seq = ++reqSeq;
			apiTurn(session, turn).then((v) => {
				if (seq !== reqSeq || store.currentSession !== session) return;
				setState({ turnData: (v && v.files) ? v : null });
			}).catch(() => {
				if (seq !== reqSeq || store.currentSession !== session) return;
				setState({ turnData: null });
			});
		}
		function setMode(mode) {
			setState({ mode: mode, selected: null, detail: null });
			if (mode === "latest") loadLatest();
		}
		// Select a file: latest mode shows the turn payload's inline sections.
		function selectFile(f) {
			if (store.mode === "latest") {
				setState({
					selected: f.path,
					detail: { path: f.path, sections: (f && f.sections) || [], revertible: !!(f && f.revertible) },
					loadingDetail: false,
					error: null
				});
			} else {
				loadDetail(f.path);
			}
		}
		function loadDetail(path) {
			const session = store.currentSession;
			if (!session) return;
			const seq = ++reqSeq;
			setState({ selected: path, detail: null, loadingDetail: true, error: null });
			apiFile(session, path).then((v) => {
				if (seq !== reqSeq || store.currentSession !== session || store.selected !== path) return;
				setState({ detail: v, loadingDetail: false });
			}).catch((e) => {
				if (seq !== reqSeq || store.currentSession !== session) return;
				setState({ error: String((e && e.message) || e), loadingDetail: false });
			});
		}
		function refresh() {
			loadSummary();
			if (store.mode === "latest") { loadLatest(); return; }
			if (store.selected) loadDetail(store.selected);
		}
		// 列表项「展示字段」签名：只比 path/lastTime/ops 会漏掉纯状态变化——文件被删
		// （或从删除态恢复）时这三个字段都不变，旧实现判定「无变化」后既不拉详情也不
		// 刷新列表，表现为「删除后列表不刷新」。
		function summarySigOf(f) {
			// question 是 2026-09-21 新增的展示字段（「全部轮次」下摘要与行内提问取它）：新增
			// 展示字段必须同步进签名，否则只有提问变化时会被判成「没变化」而不刷新列表
			return [f.path, f.status, f.lastTime, f.ops, f.added, f.removed, (f.turns || []).join(","), f.repoPath, f.question || ""].join("|");
		}
		function refreshFromServer() {
			const session = store.currentSession;
			if (!session) return;
			const seq = ++reqSeq;
			apiSummary(session).then((v) => {
				if (seq !== reqSeq || store.currentSession !== session) return;
				const next = (v && v.files) || [];
				const latestTurn = (v && typeof v.latestTurn === "number") ? v.latestTurn : 0;
				// 当前轮次：宿主在每轮**开始**时就会给出（本轮可能还没有任何变更）。它变了
				// 就必须让 reviewTick 前进一次 → 审查列表切到新一轮重新拉取，而不是继续显示
				// 上一轮的旧列表（旧实现只看 latestTurn=最近有记录的轮次，新一轮没改动时不动）
				const currentTurn = (v && typeof v.currentTurn === "number") ? v.currentTurn : 0;
				const cur = store.files;
				const hadFiles = cur !== null;
				const curList = cur || [];
				let changed = !hadFiles || next.length !== curList.length;
				if (!changed && hadFiles) {
					for (let i = 0; i < next.length; i++) {
						const a = next[i];
						const b = curList[i];
						if (!b || summarySigOf(a) !== summarySigOf(b)) { changed = true; break; }
					}
				}
				if (changed || latestTurn !== store.latestTurn || currentTurn !== store.currentTurn) {
					setState({ files: next, latestTurn: latestTurn, currentTurn: currentTurn, loadingFiles: false, reviewTick: store.reviewTick + 1 });
					if (store.mode === "latest") loadLatest();
				} else if (!hadFiles) {
					setState({ files: [], currentTurn: currentTurn, loadingFiles: false });
				}
			}).catch(() => {});
		}

		function connectEvents() {
			const es = new EventSource("/diff-review/events");
			es.onopen = () => {
				// 重连后重新同步，避免重连期间丢失的变更造成角标/列表不一致
				if (store.currentSession) refreshFromServer();
			};
			es.onmessage = (e) => {
				let matches = true;
				try {
					const d = JSON.parse(e.data);
					if (d && d.session) matches = d.session === store.currentSession;
				} catch (err) {}
				if (matches) refreshFromServer();
			};
			es.onerror = () => {
				// EventSource 会自动重连，onopen 时会重新同步
			};
			return () => es.close();
		}

		function fmtTime(t) {
			if (!t) return "";
			const d = new Date(t);
			const p = (x) => String(x).padStart(2, "0");
			return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
		}

		// ── 剪贴板与 diff 行右键菜单：复制「文件地址#行号 / #起-止」────────
		function copyText(t) {
			if (navigator.clipboard && navigator.clipboard.writeText) {
				navigator.clipboard.writeText(t).catch(() => fallbackCopy(t));
			} else fallbackCopy(t);
		}
		function fallbackCopy(t) {
			try {
				const ta = document.createElement("textarea");
				ta.value = t;
				ta.style.position = "fixed"; ta.style.opacity = "0";
				document.body.appendChild(ta); ta.select();
				document.execCommand("copy");
				document.body.removeChild(ta);
			} catch (e) {}
		}
		// 右键行号取值：删除行用旧行号，新增/上下文行用新行号
		function lineNumOf(h) { return h.type === "del" ? h.a : h.b; }
		// 从选中的文本节点向上找所在 diff 行元素
		function lineElOf(node) {
			let el = node && node.nodeType === 3 ? node.parentElement : node;
			while (el && el.nodeType === 1) {
				if (el.classList && el.classList.contains("drv-line")) return el;
				el = el.parentElement;
			}
			return null;
		}
		function openLineMenu(e, filePath, h, setMenu, repoPath) {
			e.preventDefault(); e.stopPropagation();
			const cur = lineNumOf(h);
			// 复制地址用仓库相对路径（repoPath），缺失时回退传入的 filePath
			const display = repoPath || filePath;
			const items = [];
			// 有选中文本时，取选中起止所在 diff 行的行号范围
			const sel = window.getSelection();
			let sNo = null, eNo = null;
			if (sel && !sel.isCollapsed) {
				const sEl = lineElOf(sel.anchorNode), eEl = lineElOf(sel.focusNode);
				const sv = sEl && sEl.getAttribute("data-fn-line");
				const ev = eEl && eEl.getAttribute("data-fn-line");
				if (sv != null && ev != null) { sNo = Math.min(+sv, +ev); eNo = Math.max(+sv, +ev); }
			}
			if (sNo != null && eNo != null && eNo > sNo) {
				items.push({ label: "复制文件地址#行号范围", run: () => copyText(display + "#" + sNo + "-" + eNo) });
				items.push({ label: "复制文件地址#行号（所在行）", run: () => copyText(display + "#" + cur) });
			} else {
				items.push({ label: "复制文件地址#行号", run: () => copyText(display + "#" + cur) });
			}
			setMenu({ x: e.clientX, y: e.clientY, items: items });
		}


		// 段内一次渲染的行数上限：Host 现在不再截断（万行级差异会原样返回），但一次往 DOM 里
		// 挂上万行会卡住面板——超过就先渲染前 N 行，尾部由用户点「显示剩余 N 行」再挂。
		const SECTION_PREVIEW_ROWS = 1500;
		// ── 内联图标：自绘 16×16 线条风格（stroke 跟随 currentColor）─────────────
		// 侧栏太窄，工具按钮与对比模式一律图标化 + hover 出文字；图标不依赖字体或
		// 图标包，随明暗外观与自定义色板自动适配。每个图标是 [标签, 属性] 列表。
		const ICON_SHAPES = {
			copy: [["rect", { x: 5.9, y: 5.9, width: 7.4, height: 7.4, rx: 1.5 }], ["path", { d: "M10.1 5.9V4.1A1.6 1.6 0 0 0 8.5 2.5H4.1A1.6 1.6 0 0 0 2.5 4.1v4.4a1.6 1.6 0 0 0 1.6 1.6h1.8" }]],
			open: [["path", { d: "M9.2 2.5H4.1A1.6 1.6 0 0 0 2.5 4.1v7.8a1.6 1.6 0 0 0 1.6 1.6h7.8a1.6 1.6 0 0 0 1.6-1.6V6.8" }], ["path", { d: "M9.6 2.5h3.9v3.9" }], ["path", { d: "M13.5 2.5 8.2 7.8" }]],
			refresh: [["path", { d: "M13.5 8a5.5 5.5 0 1 1-1.75-4" }], ["path", { d: "M13.5 2.6v3.5h-3.5" }]],
			wrap: [["path", { d: "M2.6 3.6h10.8" }], ["path", { d: "M2.6 7.4h6.3a2.5 2.5 0 0 1 0 5H7" }], ["path", { d: "M9.2 10 7 12.4l2.2 2.4" }]],
			nowrap: [["path", { d: "M2.6 4.2h10.8" }], ["path", { d: "M2.6 8h10.8" }], ["path", { d: "M2.6 11.8h10.8" }]],
			undoAll: [["path", { d: "M2.6 3.2v9.6" }], ["path", { d: "M13.4 3.4 8.6 8l4.8 4.6" }], ["path", { d: "M9.2 3.4 4.4 8l4.8 4.6" }]],
			undo: [["path", { d: "M2.8 8.4h7.2a3.1 3.1 0 0 1 0 6.2H6.6" }], ["path", { d: "M5.6 5.6 2.8 8.4l2.8 2.8" }]],
	// 折叠/展开指示：向右的 chevron，展开时由 CSS 旋转 90°（比 ▸/▾ 字符干净）
	chevron: [["path", { d: "M6.2 3.6 10.8 8l-4.6 4.4" }]],
			session: [["circle", { cx: 8, cy: 8, r: 5.4 }], ["path", { d: "M8 4.7V8l2.4 1.4" }]],
			initial: [["path", { d: "M4.2 13.9V2.4" }], ["path", { d: "M4.2 3.2h7.3l-1.4 2.6 1.4 2.6H4.2" }]],
			git: [["circle", { cx: 4.9, cy: 12.3, r: 1.7 }], ["circle", { cx: 4.9, cy: 3.7, r: 1.7 }], ["circle", { cx: 11.3, cy: 6.6, r: 1.7 }], ["path", { d: "M4.9 5.4v5.2" }], ["path", { d: "M11.3 8.3c0 2.3-2.5 2.5-4.3 3.3" }]]
		};
		// 图标组件：size 默认 14px；名称不认识时返回 null（不抛错）
		function Icon({ name, size }) {
			const shapes = ICON_SHAPES[name];
			if (!shapes) { return null; }
			const s = size || 14;
			return React.createElement("svg", {
				viewBox: "0 0 16 16", width: s, height: s, fill: "none",
				stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round",
				strokeLinejoin: "round", "aria-hidden": "true", focusable: "false"
			}, shapes.map(([tag, attrs], i) => React.createElement(tag, Object.assign({ key: i }, attrs))));
		}
		// 段头里的短时间：把 fmtTime 的结果裁到 HH:MM（格式变了也不会出错）
		function shortTime(at) {
			const s = String(fmtTime(at) || "");
			return s.length > 5 ? s.slice(0, 5) : s;
		}

		// ── 语法高亮（零依赖 tokenizer）──────────────────────────────────────
		// 目标（2026-09-20 用户要求）：代码**默认就按语言着色**（基础配色，任何行都有），
		// 增/删只在语法高亮之上**叠加背景色**标识；不做行内 token 配对高亮。
		// 取舍：插件零依赖、单文件 bundle，不引 shiki/prism/highlight.js（宿主也没有可复用的
		// 高亮实现——dsh-client-ui-sidebar-documentpreview 里那 6.7MB 是 pdf.js）。
		// 做法：按行扫描 + 跨行状态（块注释 / 多行串 / 围栏代码块），只给「有颜色」的片段包
		// span，其余保持裸文本 —— 单段最多渲染 1500 行，控制 DOM 规模。
		// 已知不覆盖：正则字面量按运算符处理；模板串里的插值不再二次着色（够「基础配色」用）。
		const HL_TICK = String.fromCharCode(96); // 反引号（模板串定界符）：源码里不写字面量，免转义
		const HL_FENCE = HL_TICK + HL_TICK + HL_TICK; // Markdown 围栏代码块
		function hlSet(s) {
			const m = Object.create(null);
			const arr = String(s).split(" ");
			for (let i = 0; i < arr.length; i++) {
				if (arr[i]) { m[arr[i]] = 1; }
			}
			return m;
		}
		const HL_CONST = hlSet("true false null undefined NaN Infinity self None True False nil");
		const HL_KW_COMMON = "if else for while do switch case default break continue return new delete typeof instanceof in of class extends super this import export from as async await try catch finally throw yield function var let const void static get set";
		const HL_KW_JS = hlSet(HL_KW_COMMON + " interface type enum namespace declare abstract implements public private protected readonly satisfies keyof infer is");
		const HL_KW_PY = hlSet("and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case self");
		const HL_KW_SH = hlSet("if then else elif fi for in do done case esac function return local export readonly declare unset shift set source alias while until break continue echo");
		const HL_KW_CLIKE = hlSet(HL_KW_COMMON + " struct typedef union enum sizeof goto public private protected internal virtual override abstract namespace using template typename constexpr nullptr auto final sealed implements package func impl fn mut pub trait mod match let");
		const HL_KW_SQL = hlSet("select from where insert into update delete join left right inner outer group by order having limit offset values set create table drop alter index primary key foreign references distinct count sum avg min max union all");
		const HL_KW_CSS = hlSet("important media supports keyframes import charset font-face from to and not only");
		// 语言配置：line = 行注释；opens = [[开, 闭, 类别]]（块注释 / 多行串 / 模板串）；quotes = 单行字符串定界符
		const HL_CFG_JS = { line: "//", opens: [["/*", "*/", "com"], [HL_TICK, HL_TICK, "str"]], quotes: "\"\"", kw: HL_KW_JS };
		const HL_CFG_JSON = { line: "//", opens: [["/*", "*/", "com"]], quotes: "\"\"", kw: hlSet("") };
		const HL_CFG_PY = { line: "#", opens: [["\"\"\"", "\"\"\"", "str"], ["'''", "'''", "str"]], quotes: "\"\"", kw: HL_KW_PY };
		const HL_CFG_SH = { line: "#", opens: [], quotes: "\"\"", kw: HL_KW_SH };
		const HL_CFG_YAML = { line: "#", opens: [], quotes: "\"\"", kw: hlSet("true false null yes no on off") };
		const HL_CFG_INI = { line: "#", opens: [], quotes: "\"\"", kw: hlSet("true false yes no") };
		const HL_CFG_CSS = { line: null, opens: [["/*", "*/", "com"]], quotes: "\"\"", kw: HL_KW_CSS };
		const HL_CFG_SQL = { line: "--", opens: [["/*", "*/", "com"]], quotes: "'", kw: HL_KW_SQL };
		const HL_CFG_CLIKE = { line: "//", opens: [["/*", "*/", "com"]], quotes: "\"\"", kw: HL_KW_CLIKE };
		const HL_LANG_CFG = { js: HL_CFG_JS, json: HL_CFG_JSON, py: HL_CFG_PY, sh: HL_CFG_SH, yaml: HL_CFG_YAML, toml: HL_CFG_YAML, ini: HL_CFG_INI, css: HL_CFG_CSS, sql: HL_CFG_SQL, clike: HL_CFG_CLIKE };
		// 语法配色：**内联**用一份（CSS 里也有一套，但内联不依赖外观 class / 样式注入，
		// 避免出现「文字全是灰白、没有语法色」这种要么全有要么全无的故障）
		const HL_HSL = {
			dark: { base: "#abb2bf", kw: "#c678dd", str: "#98c379", num: "#d19a66", com: "#7f848e", fn: "#61afef", typ: "#e5c07b", op: "#56b6c2", tag: "#e06c75", attr: "#d19a66" },
			light: { base: "#383a42", kw: "#a626a4", str: "#50a14f", num: "#986801", com: "#a0a1a7", fn: "#4078f2", typ: "#c18401", op: "#0184bc", tag: "#e45649", attr: "#986801" }
		};
		// 扩展名 → 语言（认不出就 plain：不高亮，也不误上色）
		const HL_EXT = { js: "js", mjs: "js", cjs: "js", jsx: "js", ts: "js", tsx: "js", mts: "js", cts: "js", json: "json", jsonc: "json", json5: "json", py: "py", pyw: "py", rb: "py", lua: "py", pl: "py", sh: "sh", bash: "sh", zsh: "sh", ps1: "sh", yml: "yaml", yaml: "yaml", toml: "toml", ini: "ini", conf: "ini", env: "ini", properties: "ini", css: "css", scss: "css", less: "css", sql: "sql", go: "clike", rs: "clike", java: "clike", kt: "clike", swift: "clike", c: "clike", h: "clike", cpp: "clike", cc: "clike", hpp: "clike", cs: "clike", php: "clike", gradle: "clike", groovy: "clike", html: "markup", htm: "markup", xml: "markup", svg: "markup", vue: "markup", svelte: "markup", md: "md", markdown: "md" };
		function langOf(path) {
			const s = String(path || "");
			const i = s.lastIndexOf(".");
			if (i < 0 || i === s.length - 1) { return "plain"; }
			return HL_EXT[s.slice(i + 1).toLowerCase()] || "plain";
		}
		// 是否标识符字符（字符比较比正则快，也避免转义困扰）
		function hlWordChar(c) {
			return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_" || c === "$";
		}
		function hlOpChar(c) {
			return "+-*/%=<>!&|^~?:".indexOf(c) >= 0;
		}
		// 扫描一行代码：返回 { spans: [[start, end, 类别]], ml }；ml 为跨行未闭合的块（下一行继续）
		function hlScanCode(text, cfg, ml) {
			const spans = [];
			const n = text.length;
			let i = 0;
			if (ml) {
				const idx = ml.close ? text.indexOf(ml.close, 0) : -1;
				if (idx < 0) {
					if (n > 0) { spans.push([0, n, ml.cls]); }
					return { spans: spans, ml: ml };
				}
				spans.push([0, idx + ml.close.length, ml.cls]);
				i = idx + ml.close.length;
				ml = null;
			}
			while (i < n) {
				const ch = text.charAt(i);
				if (ch === " " || ch === "\t") { i++; continue; }
				if (cfg.line && text.startsWith(cfg.line, i)) { spans.push([i, n, "com"]); break; }
				let open = null;
				if (cfg.opens && cfg.opens.length) {
					for (let k = 0; k < cfg.opens.length; k++) {
						if (cfg.opens[k][0] && text.startsWith(cfg.opens[k][0], i)) { open = cfg.opens[k]; break; }
					}
				}
				if (open) {
					const idx = text.indexOf(open[1], i + open[0].length);
					if (idx < 0) {
						spans.push([i, n, open[2]]);
						return { spans: spans, ml: { close: open[1], cls: open[2] } };
					}
					spans.push([i, idx + open[1].length, open[2]]);
					i = idx + open[1].length;
					continue;
				}
				if (cfg.quotes && cfg.quotes.indexOf(ch) >= 0) {
					let j = i + 1;
					let closed = false;
					while (j < n) {
						const c2 = text.charAt(j);
						if (c2 === "\\") { j += 2; continue; }
						if (c2 === ch) { j++; closed = true; break; }
						j++;
					}
					if (!closed) { j = n; }
					spans.push([i, j, "str"]);
					i = j;
					continue;
				}
				if (ch >= "0" && ch <= "9" && !hlWordChar(text.charAt(i - 1))) {
					let j = i + 1;
					while (j < n) {
						const c2 = text.charAt(j);
						if ((c2 >= "0" && c2 <= "9") || c2 === "." || c2 === "_" || c2 === "x" || c2 === "X" || (c2 >= "a" && c2 <= "f") || (c2 >= "A" && c2 <= "F")) { j++; } else { break; }
					}
					spans.push([i, j, "num"]);
					i = j;
					continue;
				}
				if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch === "$" || ch === "@") {
					let j = i + 1;
					while (j < n && hlWordChar(text.charAt(j))) { j++; }
					const word = text.slice(i, j);
					let k = j;
					while (k < n && text.charAt(k) === " ") { k++; }
					let cls = "";
					if (word.charAt(0) === "@" || (cfg.kw && cfg.kw[word])) { cls = "kw"; }
					else if (HL_CONST[word]) { cls = "num"; }
					else if (text.charAt(k) === "(") { cls = "fn"; }
					else if (word.charCodeAt(0) >= 65 && word.charCodeAt(0) <= 90) { cls = "typ"; }
					if (cls) { spans.push([i, j, cls]); }
					i = j;
					continue;
				}
				if (hlOpChar(ch)) {
					let j = i + 1;
					while (j < n && hlOpChar(text.charAt(j))) { j++; }
					spans.push([i, j, "op"]);
					i = j;
					continue;
				}
				i++;
			}
			return { spans: spans, ml: null };
		}
		// 扫描一行 HTML/XML：注释、标签名、属性名、属性值
		function hlScanMarkup(text, ml) {
			const spans = [];
			const n = text.length;
			let i = 0;
			// 迭代守卫：下面两个循环任何一处「索引不推进」都会退化成死循环 + 内存爆炸，
			// 浏览器表现是整页卡死（而不是报错）。上限远高于正常 token 数，只有 bug 才会触顶。
			let steps = 0;
			const maxSteps = n * 4 + 32;
			if (ml) {
				const idx = text.indexOf("-->", 0);
				if (idx < 0) {
					if (n > 0) { spans.push([0, n, "com"]); }
					return { spans: spans, ml: ml };
				}
				spans.push([0, idx + 3, "com"]);
				i = idx + 3;
				ml = null;
			}
			while (i < n) {
				if (++steps > maxSteps) { break; }
				const lt = text.indexOf("<", i);
				if (lt < 0) { break; }
				if (text.startsWith("<!--", lt)) {
					const idx = text.indexOf("-->", lt + 4);
					if (idx < 0) {
						spans.push([lt, n, "com"]);
						return { spans: spans, ml: { close: "-->", cls: "com" } };
					}
					spans.push([lt, idx + 3, "com"]);
					i = idx + 3;
					continue;
				}
				const gt = text.indexOf(">", lt);
				const end = gt < 0 ? n : gt + 1;
				let p = lt + 1;
				if (text.charAt(p) === "/") { p++; }
				let q = p;
				while (q < end && (hlWordChar(text.charAt(q)) || text.charAt(q) === ":" || text.charAt(q) === "-")) { q++; }
				if (q > p) { spans.push([p, q, "tag"]); }
				while (q < end - 1) {
					if (++steps > maxSteps) { break; }
					const c = text.charAt(q);
					if (c === " " || c === "\t") { q++; continue; }
					if (c === "\"" || c === "'") {
						const close = text.indexOf(c, q + 1);
						const e2 = (close < 0 || close > end) ? end - 1 : close + 1;
						spans.push([q, e2, "str"]);
						q = e2;
						continue;
					}
					if (hlWordChar(c) || c === "@" || c === ":" || c === "-") {
						// r 必须从 q+1 起步：进入本分支的字符集合比内层推进条件更宽（@ 不在其中），
						// 旧写法遇到 @ 时一个字符都不吃 → q 原地不动 + 无限 push 空 span，
						// 一个 @click 就能把整个面板卡死（实测 8 秒打爆 4GB 堆）。
						let r = q + 1;
						while (r < end - 1 && (hlWordChar(text.charAt(r)) || text.charAt(r) === "-" || text.charAt(r) === ":" || text.charAt(r) === "." || text.charAt(r) === "@")) { r++; }
						spans.push([q, r, "attr"]);
						q = r;
						continue;
					}
					q++;
				}
				i = end;
			}
			return { spans: spans, ml: ml };
		}
		// 扫描一行 Markdown：围栏代码块、标题、行内代码、加粗、链接
		function hlScanMarkdown(text, ml) {
			const spans = [];
			const n = text.length;
			if (ml) {
				const idx = text.indexOf(ml.close, 0);
				if (idx < 0) {
					if (n > 0) { spans.push([0, n, "str"]); }
					return { spans: spans, ml: ml };
				}
				spans.push([0, idx + ml.close.length, "str"]);
				return { spans: spans, ml: null };
			}
			if (text.startsWith(HL_FENCE)) {
				spans.push([0, Math.min(3, n), "com"]);
				return { spans: spans, ml: { close: HL_FENCE, cls: "str" } };
			}
			let h = 0;
			while (h < n && text.charAt(h) === "#") { h++; }
			if (h > 0 && (h === n || text.charAt(h) === " ")) {
				spans.push([0, n, "kw"]);
				return { spans: spans, ml: null };
			}
			if (text.startsWith(">")) { spans.push([0, 1, "op"]); }
			let i = 0;
			while (i < n) {
				const t1 = text.indexOf(HL_TICK, i);
				const t2 = text.indexOf("**", i);
				const t3 = text.indexOf("](", i);
				const cand = [];
				if (t1 >= 0) { cand.push(t1); }
				if (t2 >= 0) { cand.push(t2); }
				if (t3 >= 0) { cand.push(t3); }
				if (!cand.length) { break; }
				let at = cand[0];
				for (let k = 1; k < cand.length; k++) { if (cand[k] < at) { at = cand[k]; } }
				if (at === t1) {
					const close = text.indexOf(HL_TICK, at + 1);
					const e2 = close < 0 ? n : close + 1;
					spans.push([at, e2, "str"]);
					i = e2;
					continue;
				}
				if (at === t2) {
					const close = text.indexOf("**", at + 2);
					const e2 = close < 0 ? n : close + 2;
					spans.push([at, e2, "typ"]);
					i = e2;
					continue;
				}
				const close = text.indexOf(")", at + 2);
				const e2 = close < 0 ? n : close + 1;
				spans.push([at, e2, "fn"]);
				i = e2;
			}
			return { spans: spans, ml: null };
		}
		// 按行序 tokenize 一组 hunk 行：返回与 hunks 等长的 token 数组
		//（skip 行 = null，并重置跨行状态；没有语言信息时不 tokenize）
		function hlTokenizeLines(hunks, lang) {
			const out = new Array(hunks.length);
			if (!lang || lang === "plain") { return out; }
			let ml = null;
			for (let i = 0; i < hunks.length; i++) {
				const h = hunks[i];
				if (!h || h.type === "skip" || !h.text) { out[i] = null; ml = null; continue; }
				let res = null;
				if (lang === "md") { res = hlScanMarkdown(h.text, ml); }
				else if (lang === "markup") { res = hlScanMarkup(h.text, ml); }
				else if (HL_LANG_CFG[lang]) { res = hlScanCode(h.text, HL_LANG_CFG[lang], ml); }
				if (!res) { out[i] = null; continue; }
				ml = res.ml || null;
				out[i] = res.spans && res.spans.length ? res.spans : null;
			}
			return out;
		}

		// ── diff line rendering ────────────────────────────────────────────
		function Line({ h, tok, onCtx, onExpandSkip }) {
			const colors = useStore((s) => s.colors);
			// 语法配色按当前外观取（内联着色，见 HL_HSL 注释）
			const scheme = useStore((s) => s.scheme);
			const pal = HL_HSL[scheme === "light" ? "light" : "dark"];
			// 折叠省略行：全文件 diff 中被压缩的无变化上下文段；点击只放**这一处**
			// （按档位 20 → 50 → 100 → 全部 逐级放大），别处不动
			if (h.type === "skip") {
				return React.createElement("div", { className: "drv-line drv-skip", "data-skip-ci": h.ci == null ? undefined : String(h.ci), title: "点击展开这一处上下文：第一次 20 行、第二次 50 行、第三次 100 行、第四次全部", onClick: onExpandSkip ? (e) => onExpandSkip(h.ci, e) : undefined },
					React.createElement("span", { className: "drv-text" }, "⋯ 省略 " + h.count + " 行"));
			}
			let bg;
			let cls;
			if (h.type === "add") { bg = colors.addBg; cls = "drv-add"; }
			else if (h.type === "del") { bg = colors.delBg; cls = "drv-del"; }
			// 上下文行不再各自铺底色：整块底色由滚动容器统一下发（DiffPane 的 .dsdrv-pane-body），
			// 否则卡片之间、滚动条旁边的间隙没有底色，一滚动就看出「背景和之前不一样」
			else { bg = undefined; cls = "drv-ctx-line"; }
			// 文字颜色交给**语法高亮**（按语言着色，未修改的行也有配色）；
			// 增/删只靠背景色 + 左侧色条 + ± 号标识。标记基色服务色弱强化的 ± 与色条。
			const markColor = h.type === "add" ? colors.turnAdd : h.type === "del" ? colors.turnDel : undefined;
			// token 切片：只给有颜色的片段包 span，空隙保持裸文本（tok 由上层按行序算好）
			let textChildren = h.text;
			if (tok && tok.length) {
				textChildren = [];
				let pos = 0;
				for (let t = 0; t < tok.length; t++) {
					const sp = tok[t];
					if (sp[0] > pos) { textChildren.push(h.text.slice(pos, sp[0])); }
					textChildren.push(React.createElement("span", { key: t, className: "drv-tok drv-tok-" + sp[2], style: { color: pal[sp[2]] || undefined } }, h.text.slice(sp[0], sp[1])));
					pos = sp[1];
				}
				if (pos < h.text.length) { textChildren.push(h.text.slice(pos)); }
			}
			return React.createElement("div", { className: "drv-line " + cls, style: { background: bg, "--drv-mark-c": markColor }, "data-fn-line": lineNumOf(h) == null ? "" : String(lineNumOf(h)), "data-change": (h.type === "add" || h.type === "del") ? "1" : undefined, onContextMenu: onCtx ? (e) => onCtx(e, h) : undefined },
				React.createElement("span", { className: "drv-gutter", style: { color: colors.gutter } }, h.a != null ? String(h.a) : ""),
				React.createElement("span", { className: "drv-gutter", style: { color: colors.gutter } }, h.b != null ? String(h.b) : ""),
				React.createElement("span", { className: "drv-gutter drv-gutter-sign", style: { color: h.type === "add" ? colors.addFg : h.type === "del" ? colors.delFg : colors.gutter, fontWeight: markColor ? 700 : undefined } }, h.type === "add" ? "+" : h.type === "del" ? "−" : " "),
				React.createElement("span", { className: "drv-text", style: { color: pal.base } }, textChildren));
		}

		// 段落 diff 行渲染：一行一个 Line；tokLines 是上层按行序 tokenize 好的切片数组
		//（skip 行只挂「展开这段上下文」的回调，并重置跨行高亮状态）
		function renderHunkLines(section, onLineCtx, onExpandSkip, tokLines) {
			return (section.hunks || []).map((h, i) => React.createElement(Line, {
				key: h.type === "skip" ? "s" + i : i,
				h,
				tok: tokLines ? tokLines[i] : null,
				onCtx: h.type === "skip" ? null : (onLineCtx ? (e) => onLineCtx(e, h) : null),
				onExpandSkip
			}));
		}

		function Section({ section, onRevert, busy, onLineCtx, collapsed, onToggle, onExpandSkip, marked, lang, opKey }) {
			const kindLabel = section.kind === "edit" ? "编辑" : "写入";
			// 超大段的渐进渲染：showAllRows 只在本组件内（切段/重挂载后回到「先渲染前面部分」），
			// 数据本身是完整的，这里纯粹是 DOM 规模控制
			const [showAllRows, setShowAllRows] = React.useState(false);
			const totalRows = (section.hunks || []).length;
			const previewRows = (!showAllRows && totalRows > SECTION_PREVIEW_ROWS) ? SECTION_PREVIEW_ROWS : totalRows;
			// 语法高亮切片：只在数据 / 渲染行数 / 语言变化时重算（1500 行量级，避免每次渲染重跑）
			const tokLines = React.useMemo(() => {
				const rows = previewRows < totalRows ? (section.hunks || []).slice(0, previewRows) : (section.hunks || []);
				return hlTokenizeLines(rows, lang);
			}, [section, previewRows, lang]);
			const cls = section.kind === "edit" ? "drv-badge-edit" : "drv-badge-new";
			return React.createElement("div", { className: "drv-section" + (marked ? " drv-sec-last" : "") + (collapsed ? " drv-sec-closed" : ""), "data-op": opKey == null ? undefined : String(opKey) },
				// 吸顶哨兵：1px 高 + 负 margin 抵消，滚出正文区顶部时用它给卡片打 .drv-sec-stuck
				// （吸顶才去圆角；未吸顶保留大圆角）
				React.createElement("div", { className: "drv-sec-sentinel", "aria-hidden": "true" }),
				// 段头整行可点折叠/展开（多轮信息收纳）；撤回按钮单独拦住不触发折叠
				React.createElement("div", {
					className: "drv-section-head",
					onClick: onToggle || undefined,
					title: collapsed ? "展开这一轮的改动" : "折叠这一轮的改动"
				},
					React.createElement("span", { className: "drv-sec-chevron" + (collapsed ? "" : " drv-sec-chevron-open") },
						React.createElement(Icon, { name: "chevron", size: 12 })),
					React.createElement("span", { className: "drv-badge " + cls }, kindLabel),
					// 次级灰字元信息：轮次与时间合成「第2轮 · 18:48」，缺轮次时只留时间
					section.turn > 0 || section.at ? React.createElement("span", { className: "drv-section-turn" },
						(section.turn > 0 ? "第" + section.turn + "轮" : "") +
						(section.turn > 0 && section.at ? " · " : "") +
						(section.at ? shortTime(section.at) : "")) : null,
					section.question ? React.createElement("span", { className: "drv-section-question", title: section.question }, section.question) : null,
					section.truncated ? React.createElement("span", { className: "drv-section-time", title: "该段内容超过上限（每侧最多 2 万行），只展示了前面部分" }, "已截断") : null,
					React.createElement("span", { className: "drv-header-spacer" }),
					section.canUndo ? React.createElement("button", {
						className: "drv-btn drv-btn-revert drv-btn-danger drv-iconbtn",
						title: "撤回这一轮的改动：文件恢复到该项修改之前的内容，其后无冲突的修改保留",
						disabled: busy,
						onClick: (e) => { e.stopPropagation(); if (onRevert) { onRevert(section.opIndex); } }
					}, React.createElement(Icon, { name: "undo" })) : null),
				// 折叠时不渲染正文（省 DOM；重挂载后由 DiffPane 的折叠状态恢复）
				!collapsed ? React.createElement("div", { className: "drv-section-body" },
					// 行外面包一层容器：不折行时让它撑到「最宽的那一行」，于是每一行（含文本很短的
					// 改动行）都同宽——否则横向滚到右边时，短行的改动底色只铺到可见宽度、右侧空白
					React.createElement("div", { className: "drv-rows" },
						// 只渲染前 previewRows 行（不够就整体渲染）；tokLines 与这里真正渲染的行**同序同长**
						// （预览态两边都按 previewRows 切），第 4 个参数漏传就会退化成「全是灰白、没有语法色」
						renderHunkLines(previewRows < totalRows
							? Object.assign({}, section, { hunks: section.hunks.slice(0, previewRows) })
							: section, onLineCtx, onExpandSkip, tokLines)),
					// 段内一行都没有（该轮确实没有编辑）：给一句说明，别留一张空卡片
					totalRows === 0 ? React.createElement("div", { className: "drv-sec-nodiff" }, "（这一轮没有编辑）") : null,
					previewRows < totalRows ? React.createElement("button", {
						className: "drv-btn drv-more-btn",
						title: "该段行数很多：先渲染前 " + previewRows + " 行，点击展开剩余行",
						onClick: (e) => { e.stopPropagation(); setShowAllRows(true); }
					}, "显示剩余 " + (totalRows - previewRows) + " 行") : null) : null);
		}

		const COLOR_ROWS = [
			["addBg", "新增行背景"], ["addFg", "新增行标记色"],
			["delBg", "删除行背景"], ["delFg", "删除行标记色"],
			["ctxBg", "上下文背景"], ["gutter", "行号 / 标记"],
			["badgeBg", "角标背景"], ["badgeFg", "角标文字"],
			["turnAdd", "新增行数（对话底部）"], ["turnDel", "删除行数（对话底部）"],
			["turnBg", "背景色（对话底部）"], ["turnBorder", "边框色（对话底部）"]
		];

		function ColorRows() {
			const colors = useStore((s) => s.colors);
			return COLOR_ROWS.map((row) => {
				const key = row[0];
				const parsed = parseColor(colors[key]) || { r: 128, g: 128, b: 128, a: 1 };
				return React.createElement("label", { key: key, className: "drv-color-row" },
					React.createElement("span", null, row[1]),
					React.createElement("div", { className: "drv-color-controls" },
						React.createElement("input", {
							type: "color",
							value: hexOf(parsed),
							onChange: (e) => setState({ colors: Object.assign({}, store.colors, { [key]: formatRgba(Object.assign({}, parsed, parseColor(e.target.value))) }) })
						}),
						React.createElement("input", {
							type: "range",
							min: 0,
							max: 100,
							value: Math.round(parsed.a * 100),
							title: "透明度",
							onChange: (e) => setState({ colors: Object.assign({}, store.colors, { [key]: formatRgba(Object.assign({}, parsed, { a: Number(e.target.value) / 100 })) }) })
						}),
						React.createElement("span", { className: "drv-color-alpha" }, Math.round(parsed.a * 100) + "%"))
				);
			});
		}

		function PresetButtons() {
			return React.createElement("div", { className: "drv-presets" },
				React.createElement("button", { onClick: () => setState({ colors: Object.assign({}, LIGHT) }) }, "浅色预设"),
				React.createElement("button", { onClick: () => setState({ colors: Object.assign({}, DARK) }) }, "深色预设"),
				React.createElement("button", { onClick: () => setState({ colors: Object.assign({}, paletteFor(store.scheme)) }) }, "恢复默认（随外观）"));
		}

		function Detail({ onRevert, onRevertAll, busy }) {
			const selected = useStore((s) => s.selected);
			const detail = useStore((s) => s.detail);
			const loading = useStore((s) => s.loadingDetail);
			const error = useStore((s) => s.error);
			const [menu, setMenu] = React.useState(null);
			if (loading) return React.createElement("div", { className: "drv-empty" }, "加载中…");
			if (error) return React.createElement("div", { className: "drv-empty" }, "出错：" + error);
			if (!selected) return React.createElement("div", { className: "drv-empty" }, "在左侧选择文件查看修改对比");
			if (!detail || !detail.sections || detail.sections.length === 0) return React.createElement("div", { className: "drv-empty" }, "该文件没有可展示的修改");
			return React.createElement("div", null,
				React.createElement("div", { className: "drv-detail-toolbar" },
					React.createElement("span", { className: "drv-detail-path", title: detail.path }, detail.path),
					React.createElement("span", { className: "drv-header-spacer" }),
					React.createElement("button", {
						className: "drv-btn drv-btn-revert drv-btn-danger",
						title: "撤回该文件的全部修改：恢复到本次会话首次修改之前的内容（会话中新建的文件将被删除）",
						disabled: busy || detail.revertible !== true,
						onClick: onRevertAll
					}, "撤回全部修改")),
				detail.sections.map((sec, i) => React.createElement(Section, { key: i, section: sec, lang: langOf(detail.path), onRevert: onRevert, busy: busy, onLineCtx: (e, h) => openLineMenu(e, detail.path, h, setMenu) })),
				React.createElement(CtxMenu, { menu, onClose: () => setMenu(null) }));
		}

		// ── directory tree grouping for the review-pane file list ──────────────────
		// ── context menu (right-click on file rows) ──────────────────────────────
		function CtxMenu({ menu, onClose }) {
			const rootRef = React.useRef(null);
			React.useEffect(() => {
				if (!menu) return;
				const close = () => onClose();
				// 捕获阶段监听任意“按下”：点击菜单外部即关闭，避免菜单残留成一个
				// position:fixed + z-index 20000 的悬浮色块盖住其它 UI（点击菜单内部则不关）
				const onPointer = (e) => {
					const t = e.target;
					if (rootRef.current && t && rootRef.current.contains(t)) return;
					onClose();
				};
				const handleKey = (e) => { if (e.key === "Escape") onClose(); };
				window.addEventListener("pointerdown", onPointer, true);
				window.addEventListener("blur", close);
				window.addEventListener("scroll", close, true);
				window.addEventListener("keydown", handleKey);
				return () => {
					window.removeEventListener("pointerdown", onPointer, true);
					window.removeEventListener("blur", close);
					window.removeEventListener("scroll", close, true);
					window.removeEventListener("keydown", handleKey);
				};
			}, [!!menu, onClose]);
			if (!menu) return null;
			const items = menu.items || [];
			if (items.length === 0) return null;
			return React.createElement("div", {
				ref: rootRef,
				className: "dsdrv-ctx",
				style: { left: Math.min(menu.x, window.innerWidth - 150), top: Math.min(menu.y, window.innerHeight - 80) },
				onClick: (e) => e.stopPropagation()
			}, items.map((it, i) =>
				React.createElement("button", { key: i, className: "dsdrv-ctx-item", onClick: () => { it.run(); onClose(); } }, it.label)));
		}

		function FileList({ openFile }) {
			const mode = useStore((s) => s.mode);
			const files = useStore((s) => s.files);
			const turnData = useStore((s) => s.turnData);
			const selected = useStore((s) => s.selected);
			const loading = useStore((s) => s.loadingFiles);
			const colors = useStore((s) => s.colors);
			const list = mode === "latest" ? (turnData && turnData.files) || [] : (files || []);
			const [menu, setMenu] = React.useState(null);
			if (loading) return React.createElement("div", { className: "drv-empty" }, "加载中…");
			if (!list || list.length === 0) {
				return React.createElement("div", { className: "drv-empty" },
					mode === "latest"
						? "最新一轮没有可展示的修改（该轮无写入/编辑，或记录没有轮次标记）"
						: "暂无修改记录（进程内通过写入/编辑工具产生的文件修改会出现在这里）");
			}
			const fileRow = (f) => {
				const cls = "drv-file" + (f.path === selected ? " drv-selected" : "");
				return React.createElement("button", {
					key: f.path || f.name, className: cls,
					onClick: () => selectFile(f),
					onContextMenu: (e) => {
						e.preventDefault(); e.stopPropagation();
						setMenu({ x: e.clientX, y: e.clientY, items: [
							{ label: "打开文件", run: () => { if (openFile) openFile(f.path, f.cwd); } },
							{ label: "在 Finder 中展示", run: () => { const sid = store.currentSession; if (sid) revealInFinderFor(sid, f.path, f.cwd); } }
						]});
					}
				},
					React.createElement(StatusChip, { status: f.status, colors: colors }),
					React.createElement("span", { className: "drv-file-name" }, f.name),
					React.createElement("span", { className: "drv-file-meta" },
						(f.writes > 0 ? "写入×" + f.writes + " " : "") + (f.edits > 0 ? "编辑×" + f.edits : ""),
						"  ~+" + f.added + " ~−" + f.removed));
			};
			return React.createElement("div", null,
				list.map(fileRow),
				React.createElement(CtxMenu, { menu, onClose: () => setMenu(null) }));
		}

		function SessionProbe(props) {
			React.useEffect(() => {
				if (props.sessionId && store.currentSession !== props.sessionId) {
					reqSeq++; // 丢弃上一个会话仍在途的请求
					setState({ currentSession: props.sessionId, files: null, selected: null, detail: null, mode: "session", turnData: null, latestTurn: 0, currentTurn: 0, error: null, loadingFiles: true });
					refreshFromServer();
				}
			}, [props.sessionId]);
			return null;
		}

		// ── 侧栏「审查 diff」tab：原先的「最大化查看」全屏窗口与列表行内展开
		// diff 都改由右侧栏承载（tab 类型与正文注册见 apply()）。正文通过框架
		// 注入的 useTabInfo() 读 tab.contentId（= 我们自己
		// dsh-resource://diff-review/... 的地址），解析出会话与文件原始路径，再
		// 拉现有 /diff-review/file | /against 路由；随 SSE（reviewTick）自动刷新，
		// 撤回后重取。三段对比模式（会话记录 / 初始版本 / Git 版本）、逐项撤回、
		// 撤回全部、右键复制「地址#行号」都在这里。
		// 三个对比模式：图标 + hover 说明（侧栏窄，文字不再占位）
		const DIFF_VIEWS = [
			["ops", "会话", "session", "本会话内累计的修改"],
			["initial", "首次", "initial", "与该文件在本会话首次修改前对比"],
			["git", "Git", "git", "与该文件的 Git HEAD 版本对比"]
		];
		// 脚本类工具：改动由「命令前后快照做差」发现，与内置 write/edit 区分显示
		const SHELL_TOOL_LABELS = ["pwsh", "bash", "run_code"];
		function DiffPane(props) {
			const colors = useStore((s) => s.colors);
			// 当前明暗：色弱强化的明度叠加层分浅/深两套（见 CSS 的 .dsdrv-scheme-*）
			const scheme = useStore((s) => s.scheme);
			const tick = useStore((s) => s.reviewTick);
			// 框架按席位声明 inject.hooks.tabInfo 注入 tabInfo 钩子（props.useTabInfo）
			const info = (typeof props.useTabInfo === "function") ? props.useTabInfo() : null;
			const tab = info && info.tab;
			const target = diffTargetOfAddress(tab && tab.contentId);
			const session = target ? target.sessionId : "";
			const rawPath = target ? target.path : "";
			const [view, setView] = React.useState("ops");
			// 长行折行开关（默认折行）：切换后写入 localStorage，跨会话记住
			const [wrap, setWrap] = React.useState(loadWrap);
			const [data, setData] = React.useState(null);
			const [busy, setBusy] = React.useState(false);
			// 手动「刷新」时的忙碌标记（自动刷新不显示，避免每 15s 闪一下）
			const [refreshing, setRefreshing] = React.useState(false);
			const [menu, setMenu] = React.useState(null);
			// 段落折叠状态：键 = opIndex（记录是追加式数组，刷新后键仍稳定），
			// 放在 DiffPane 级——SSE/轮询重取数据后折叠状态不丢
			const [collapsedMap, setCollapsedMap] = React.useState({});
			// 「最近查看的那一条」：只保留最后点开/折叠过的那一段（纯组件态——刷新、切文件、
			// 切对比模式都重置，不写 localStorage）
			const [lastViewed, setLastViewed] = React.useState(null);
			// 上下文展开档位（**按处**）：键 = "opIndex:省略块序号"，只有同一作用域
			// （文件 + 对比模式）才认，换文件 / 换对比模式自动作废——点一处只放那一处。
			// 纯组件态、不落盘：关闭重开 / 组件重挂载天然回到最初状态，点「刷新」也会丢掉。
			const ctxScope = String(session || "") + "|" + String(rawPath || "") + "|" + view;
			const [ctxState, setCtxState] = React.useState(null);
			const ctxBy = ctxState && ctxState.scope === ctxScope ? ctxState.map : null;
			// 发给服务端的紧凑参数（"段:块:行数,..."）；空串＝全部按服务端默认折叠
			const ctxSig = ctxBy ? Object.keys(ctxBy).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((k) => k + ":" + ctxBy[k]).join(",") : "";
			const paneRef = React.useRef(null);
			// 展开时记下「被点那一行」的屏幕位置，数据回来后就地锚住（新放出的行因此进入视野）
			const pendingAnchorRef = React.useRef(null);
			// 改动间跳转：块数由渲染结果统计，位置用 ref 记（避免跳转自身触发重渲）
			const [jumpCount, setJumpCount] = React.useState(0);
			const [jumpPos, setJumpPos] = React.useState(0);
			const jumpIdxRef = React.useRef(-1);
			// 拉取当前对比模式的数据（会话修改记录 / 会话最初版本 / Git HEAD 版本）；
			// showBusy=true 只在用户点「刷新」时传，用于按钮文案反馈
			// sigOverride：手动「刷新」时传空串——那一次直接按「全部折叠」取数，
			// 不必先发一次带旧档位的过渡请求
			const load = React.useCallback((showBusy, sigOverride) => {
				if (!session || !rawPath) return;
				if (showBusy) { setRefreshing(true); }
				const sig = sigOverride === undefined ? ctxSig : sigOverride;
				const p = view === "ops"
					? apiFile(session, rawPath, undefined, sig || undefined)
					: apiAgainst(session, rawPath, view, undefined, sig || undefined);
				p.then((v) => setData(v))
					.catch((e) => setData({ error: "加载失败：" + String((e && e.message) || e) }))
					.then(() => { if (showBusy) { setRefreshing(false); } });
			}, [session, rawPath, view, ctxSig]);
			// 取数身份键：只有换文件 / 换对比模式才清空旧内容；展开档位变化时保留当前内容
			// 直到新数据到达（否则每点一次省略行都要闪一下白）
			const dataKey = String(session || "") + "|" + String(rawPath || "") + "|" + view;
			const lastDataKeyRef = React.useRef(dataKey);
			React.useEffect(() => {
				if (lastDataKeyRef.current !== dataKey) { lastDataKeyRef.current = dataKey; setData(null); }
				load();
			}, [load, dataKey]);
			// 手动「刷新」＝回到最初状态：丢掉按处展开的档位（不落盘），按空档位直接取数
			const refreshPane = () => {
				pendingAnchorRef.current = null;
				setCtxState(null);
				load(true, "");
			};
			// 换文件 / 换对比模式后清掉「最近查看」标记（新数据的段落已不是同一批）
			React.useEffect(() => { setLastViewed(null); }, [view, session, rawPath]);
			// 放出一处上下文后，把「被点的那一行」锚回原来的屏幕位置：新放出的行于是进入
			// 视野，而不是把当前阅读位置整体顶走。那一处已全放完（省略行消失）时退而锚住
			// 该段的第一行改动，避免视口乱跳。
			React.useEffect(() => {
				const a = pendingAnchorRef.current;
				if (!a || !data) { return; }
				pendingAnchorRef.current = null;
				const root = paneRef.current;
				const body = root && root.querySelector ? root.querySelector(".dsdrv-pane-body") : null;
				if (!body) { return; }
				requestAnimationFrame(() => {
					const sec = body.querySelector('.drv-section[data-op="' + a.opKey + '"]');
					let el = sec ? sec.querySelector('[data-skip-ci="' + a.ci + '"]') : null;
					if (!el && sec) { el = sec.querySelector('[data-change="1"]'); }
					if (el) { body.scrollTop += (el.getBoundingClientRect().top - body.getBoundingClientRect().top) - a.offset; }
				});
			}, [data]);
			// 收起侧栏/切到后台 tab 时组件仍在树上（只是 tab.visible=false），
			// 所以轮询与 SSE 刷新都以 visible 为闸门，避免后台空转
			const visible = !!(tab && tab.visible);
			// 会话记录视图跟随新改动（SSE 每次推送都会 bump reviewTick）自动刷新；
			// 另加 15s 兜底轮询，避免长时间不推送时内容陈旧
			React.useEffect(() => {
				if (view !== "ops" || !visible) return undefined;
				const timer = setInterval(() => load(false), 15000);
				return () => clearInterval(timer);
			}, [view, visible, load]);
			React.useEffect(() => {
				if (visible && view === "ops" && tick > 0) load();
			}, [visible, tick, view, load]);
			// 改动块计数：连续的 add/del 行归为「一处」，供跳转导航显示 n/m
			React.useEffect(() => {
				const rootEl = paneRef.current;
				if (!rootEl) { setJumpCount(0); return; }
				const rows = Array.from(rootEl.querySelectorAll(".drv-line[data-change='1']"));
				let count = 0;
				let prev = null;
				for (const el of rows) {
					if (!prev || prev.nextElementSibling !== el) count++;
					prev = el;
				}
				setJumpCount(count);
				jumpIdxRef.current = -1;
				setJumpPos(0);
				// 折叠切换会增删可见行，也要重算块数
			}, [data, collapsedMap]);
			// 段头吸顶探测：哨兵滚出正文滚动区顶部 = 该段头已经吸住。纯 CSS 判断不了 sticky
			// 的吸住状态，所以用 IntersectionObserver；再用 boundingClientRect 与 rootBounds
			// 比较，区分「已滚到视口上方（真吸住）」和「还在下方没进视野（不该算吸顶）」。
			// 只切 class、不 setState，避免滚动时触发重渲染。
			React.useEffect(() => {
				const rootEl = paneRef.current;
				if (!rootEl || typeof IntersectionObserver === "undefined") { return undefined; }
				const bodyEl = rootEl.querySelector(".dsdrv-pane-body");
				if (!bodyEl) { return undefined; }
				const io = new IntersectionObserver((entries) => {
					for (const en of entries) {
						const card = en.target.parentElement;
						if (!card) { continue; }
						const rb = en.rootBounds;
						const stuck = !en.isIntersecting && !!rb && en.boundingClientRect.top <= rb.top + 0.5;
						card.classList.toggle("drv-sec-stuck", stuck);
					}
				}, { root: bodyEl, threshold: 0 });
				Array.from(rootEl.querySelectorAll(".drv-sec-sentinel")).forEach((el) => io.observe(el));
				return () => io.disconnect();
			}, [data, collapsedMap]);
			// 跳转到上一处/下一处改动块：滚动居中并闪烁一次
			const jumpTo = (delta) => {
				const rootEl = paneRef.current;
				if (!rootEl) return;
				const rows = Array.from(rootEl.querySelectorAll(".drv-line[data-change='1']"));
				const blocks = [];
				for (const el of rows) {
					const last = blocks[blocks.length - 1];
					if (last && last[last.length - 1].nextElementSibling === el) { last.push(el); }
					else { blocks.push([el]); }
				}
				if (!blocks.length) return;
				jumpIdxRef.current = ((jumpIdxRef.current + delta) % blocks.length + blocks.length) % blocks.length;
				const target = blocks[jumpIdxRef.current][0];
				target.scrollIntoView({ block: "center", behavior: "smooth" });
				target.classList.remove("drv-flash");
				// 强制 reflow 让闪烁动画能重新触发
				void target.offsetWidth;
				target.classList.add("drv-flash");
				setJumpPos(jumpIdxRef.current + 1);
			};
			// 折叠键：opIndex 稳定唯一（记录追加式），缺失时退回时间戳
			const sectionKeyOf = (sec) => String(sec && sec.opIndex != null ? sec.opIndex : (sec ? sec.at : ""));
			// 段落当前生效的折叠态：用户点过以 collapsedMap 为准，没点过则「首段展开、其余折叠」。
			// 必须与传给 Section 的 collapsed 共用这一份计算——旧实现直接对 m[key] 取反，
			// 而默认折叠的段落根本不在 map 里（undefined → !undefined === true），于是
			// 第一次点击反而把「折叠」写了进去，要点第二次才真正展开。
			// 「最新轮次」默认**整轮**展开：同一轮里可能改了好几处（多个 op），只展开最上面那一段
			// 会让同轮其余改动仍然折叠着。取 payload 里最大的 turn（旧记录 turn 缺失时为 0，
			// 退回旧行为「只展开第一段」）。
			const latestTurnOf = (secs) => {
				let t = 0;
				for (const s of secs || []) {
					const v = Number(s && s.turn) || 0;
					if (v > t) { t = v; }
				}
				return t;
			};
			const latestTurn = latestTurnOf(data && data.sections);
			const isCollapsed = (sec, i) => {
				const key = sectionKeyOf(sec);
				if (collapsedMap[key] != null) { return !!collapsedMap[key]; }
				if (latestTurn > 0) { return (Number(sec && sec.turn) || 0) !== latestTurn; }
				return i > 0;
			};
			// 折行开关：只改本地的显示偏好，写盘失败也不影响本次切换
			const toggleWrap = () => {
				setWrap((cur) => {
					const next = !cur;
					try { localStorage.setItem(WRAP_LS_KEY, next ? "1" : "0"); } catch (e) { /* 隐私模式等写不进，忽略 */ }
					return next;
				});
			};
			// 折叠/展开一段，并把这一段记为「最近查看」。
			// 从「展开 → 折叠」时必须把这条记录拉回滚动区顶部：它自己的正文被收掉后，
			// 下面的内容整体上移，而 scrollTop 数值不变——于是视野停到了别处的记录上
			// （用户反馈：折叠后没回到刚才查看的那一条）。
			const toggleSection = (key, cur, ev) => {
				const card = (ev && ev.currentTarget && ev.currentTarget.closest) ? ev.currentTarget.closest(".drv-section") : null;
				const body = card ? card.closest(".dsdrv-pane-body") : null;
				// 折叠前先量好：卡片头在滚动内容里的偏移（它自身的顶部不会因本段塌陷而改变）
				const docTop = (body && card) ? body.scrollTop + (card.getBoundingClientRect().top - body.getBoundingClientRect().top) : null;
				setCollapsedMap((m) => Object.assign({}, m, { [key]: !cur }));
				setLastViewed(key);
				// 只有「卡片头已经滚出滚动区顶部」（看正文时被吸顶顶上去）才需要回拉；
				// 卡片本来就完整在视野里时不动滚动，避免无谓跳动
				if (!cur && docTop != null && docTop < body.scrollTop) {
					requestAnimationFrame(() => { body.scrollTop = docTop; });
				}
			};
			// 点「省略 N 行」：**只**放这一处（键＝"段 opIndex:该段内省略块序号"），
			// 档位 0 → 20 → 50 → 100 → 全部，同段其它处与其它段一行不放
			const expandSkipOf = (opKey, ci, e) => {
				const el = e && e.currentTarget;
				const body = el && el.closest ? el.closest(".dsdrv-pane-body") : null;
				if (el && body) {
					pendingAnchorRef.current = { opKey: String(opKey), ci: String(ci), offset: el.getBoundingClientRect().top - body.getBoundingClientRect().top };
				}
				setCtxState((cur) => {
					const base = (cur && cur.scope === ctxScope) ? cur.map : {};
					const k = String(opKey) + ":" + String(ci);
					return { scope: ctxScope, map: Object.assign({}, base, { [k]: nextCtxLevel(base[k]) }) };
				});
			};
			if (!session || !rawPath) {
				return React.createElement("div", { className: "drv-empty" }, "无法解析该 tab 的文件地址");
			}
			const sections = (data && data.sections) || [];
			// 与某个基准版本对比（尤其 Git HEAD）时「内容一致」是常态：Host 会把无差异折叠成
			// hunks: []，客户端若照旧渲染就得到一张空卡片、什么都不说——用户要求明确标识。
			// 这里统计所有段的总行数，为 0 时整块换成结论文案；单段为 0 时由 Section 内部说明。
			const totalHunks = sections.reduce((n, sec) => n + ((sec && Array.isArray(sec.hunks)) ? sec.hunks.length : 0), 0);
			const noDiffText = view === "git"
				? "与 Git HEAD 对比：没有修改（HEAD 与工作区当前内容一致）"
				: (view === "initial"
					? "与会话最初版本对比：没有差异"
					: "没有编辑（记录到的操作没有带来内容变化）");
			const revertible = !!(data && data.revertible === true);
			// 撤回（全部 / 单项）：确认框由 LivePanel 挂载的 ConfirmPrompt 统一渲染
			// （本页所在会话的面板一定在场），撤回成功后重取数据并刷新列表
			const doRevert = async (opIndex) => {
				const what = opIndex === null ? "该文件的全部修改" : "该项修改";
				if (!(await askConfirm("确定撤回" + what + "？此操作会直接改写磁盘上的文件，且不可撤销。"))) return;
				setBusy(true);
				try {
					const v = await apiRevert(session, (data && data.path) || rawPath, opIndex === null ? null : opIndex);
					if (v && v.ok) { load(); refreshFromServer(); }
					else { window.alert("撤回失败：" + ((v && v.error) || "未知错误")); }
				} catch (e) {
					window.alert("撤回失败：" + String((e && e.message) || e));
				}
				setBusy(false);
			};
			const display = (data && data.repoPath) || rawPath;
			return React.createElement("div", { className: "dsdrv-pane" + (wrap ? "" : " dsdrv-nowrap") + (scheme === "dark" ? " dsdrv-scheme-dark" : " dsdrv-scheme-light"), ref: paneRef },
				// 顶部固定两行：第一行只放状态 + 路径（路径可收缩省略），
				// 第二行放操作按钮（复制路径 / 打开文件 / 对比模式 / 撤回全部）
				React.createElement("div", { className: "dsdrv-pane-head" },
					React.createElement("div", { className: "drv-detail-toolbar dsdrv-pane-row" },
						React.createElement(StatusChip, { status: data && data.status, colors: colors }),
						React.createElement("span", { className: "drv-detail-path dsdrv-pane-path", title: (data && data.absPath) || rawPath }, display)),
					React.createElement("div", { className: "drv-detail-toolbar dsdrv-pane-row dsdrv-pane-actions" },
						// 工具按钮一律图标 + hover 出文字（侧栏窄，文字按钮太占位）
						React.createElement("button", { className: "drv-btn drv-iconbtn", title: "复制仓库地址（相对仓库根，无仓库时复制完整路径）｜build 0918c", onClick: () => copyText(display) }, React.createElement(Icon, { name: "copy" })),
						React.createElement("button", { className: "drv-btn drv-iconbtn", title: "在侧栏打开该文件的当前内容", onClick: () => openFileDefault({ path: rawPath, cwd: data && data.cwd, absPath: data && data.absPath }, session) }, React.createElement(Icon, { name: "open" })),
						// 手动刷新：会话记录模式本就会随改动（SSE）自动刷新，
						// 但「首次 / Git」两种对比不自动刷新，靠这颗按钮重取
						React.createElement("button", {
							className: "drv-btn drv-iconbtn",
							title: refreshing ? "刷新中…" : "立即重新拉取（会话记录模式会随改动自动刷新；首次 / Git 对比需手动刷新）",
							disabled: refreshing,
							onClick: refreshPane
						}, React.createElement(Icon, { name: "refresh" })),
						// 折行开关：只影响长行显示（纯客户端偏好，localStorage 记忆），不参与取数
						React.createElement("button", {
							className: "drv-btn drv-iconbtn" + (wrap ? " drv-btn-on" : ""),
							title: wrap ? "长行折行显示（点击改为不折行）" : "长行不折行（点击改为折行显示）",
							onClick: toggleWrap
						}, React.createElement(Icon, { name: wrap ? "wrap" : "nowrap" })),
						React.createElement("span", { className: "drv-header-spacer" }),
						// 对比模式：图标 + title 说明（label 仅作 title 兜底）
						React.createElement("div", { className: "drv-mode", role: "group" },
							DIFF_VIEWS.map(([m, label, icon, hint]) => React.createElement("button", {
								key: m,
								className: "drv-mode-btn drv-iconbtn" + (view === m ? " drv-mode-active" : ""),
								title: hint || label,
								onClick: () => setView(m)
							}, React.createElement(Icon, { name: icon })))),
						view === "ops" ? React.createElement("button", { className: "drv-btn drv-btn-revert drv-btn-danger drv-iconbtn", title: "撤回该文件的全部修改：恢复到本会话首次修改之前", disabled: busy || !revertible, onClick: () => doRevert(null) }, React.createElement(Icon, { name: "undoAll" })) : null)),
				// 只有正文参与滚动：文件头与工具行留在滚动容器**之外**——不折行模式横向滚动时
				// 头不会跟着动；段头也因此在正文滚动区里吸顶（top:0，不再依赖 --drv-head-h）
				// 整块代码底色铺在**滚动容器**上：覆盖卡片间隙与滚动条区域，
				// 滚动到哪一段都一致（原先逐行铺底色会露出没上色的缝）
				React.createElement("div", { className: "dsdrv-pane-body", style: { background: colors.ctxBg } },
				!data
					? React.createElement("div", { className: "drv-empty" }, "加载中…")
					: data.error
						? React.createElement("div", { className: "drv-empty" }, data.error)
						: (sections.length > 0 && totalHunks > 0
							? React.createElement("div", null,
								data.baseLabel ? React.createElement("div", { className: "drv-against-note" }, data.baseLabel) : null,
								sections.map((sec, i) => (sec && Array.isArray(sec.hunks))
									? React.createElement(Section, {
										key: sectionKeyOf(sec) || i,
										section: sec,
										// 语法高亮按文件扩展名选语言（认不出就不上色）
										lang: langOf((data && data.path) || rawPath),
										busy: busy,
										// 默认只展开第一段（最新一段改动），其余折叠；
										// 用户点过的段落以点击记录为准（点过 = collapsedMap 里有值）
										collapsed: isCollapsed(sec, i),
										onToggle: (e) => toggleSection(sectionKeyOf(sec), isCollapsed(sec, i), e),
										// 最近查看过的那一条：左侧强调条 + 段头淡蓝底（只保留最后一条）
										marked: lastViewed === sectionKeyOf(sec),
										// 键用 opIndex（payload 的段按时间倒序，序号会错位）＋该段内的省略块序号
										opKey: sec.opIndex != null ? sec.opIndex : i,
										onExpandSkip: (ci, e) => expandSkipOf(sec.opIndex != null ? sec.opIndex : i, ci, e),
										onRevert: (view === "ops" && revertible) ? (opIndex) => doRevert(opIndex) : undefined,
										onLineCtx: (e, h) => openLineMenu(e, (data && data.path) || rawPath, h, setMenu, data && data.repoPath)
									})
									: null))
							: React.createElement("div", null,
								// 明确结论：带上基准说明（例如「Git HEAD 版本 ←→ 工作区当前内容」）
								data.baseLabel ? React.createElement("div", { className: "drv-against-note" }, data.baseLabel) : null,
								React.createElement("div", { className: "drv-empty drv-empty-nodiff" },
									React.createElement("div", null, noDiffText),
									// 与 Git HEAD 一致时最常见的解释就是「改动已经提交了」，明说一句
									view === "git" ? React.createElement("div", { className: "drv-nodiff-hint" }, "内容可能已经提交（本次改动已进入 Git 提交记录）") : null))),
					// 改动间跳转导航：悬浮在正文区底部右侧（≥2 处改动才出现）
					jumpCount > 1 ? React.createElement("div", { className: "dsdrv-jumpnav" },
						React.createElement("button", { title: "上一处改动", onClick: () => jumpTo(-1) }, "↑"),
						React.createElement("span", { className: "dsdrv-jumpnav-n" }, jumpPos + "/" + jumpCount),
						React.createElement("button", { title: "下一处改动", onClick: () => jumpTo(1) }, "↓")) : null),
				React.createElement(CtxMenu, { menu, onClose: () => setMenu(null) }));
		}


		// ── 审查列表的快捷筛选 / 搜索（2026-09-21）：纯客户端内存过滤，不新增取数接口。
		// 语义：关键词命中「四字段并集」（路径/文件名、用户提问、工具名、状态），空格分词后
		// 每个词各自命中即可（允许落在不同字段），大小写不敏感；三组 chip 组内多选 = 或、
		// 组间 = 与；关键词与 chip 之间也是与。
		// 来源分组「编辑 / 命令」互斥且完备：编辑 = 内置 write/edit，其余（pwsh/bash/run_code
		// 以及旧记录里可能出现的未知 via 值，如 'shell'）一律算命令，避免漏筛。
		const LIVE_SOURCE_EDIT = ["write", "edit"];
		/** 工具名 → 来源分组（'edit' 内置编辑器 / 'command' 命令快照类）
		 *  @param {string} tool 记录里的工具名（op.via）
		 *  @returns {string} 'edit' | 'command' */
		function liveSourceOf(tool) {
			return LIVE_SOURCE_EDIT.indexOf(tool) >= 0 ? "edit" : "command";
		}
		/** 关键词匹配用的「字段并集」文本：路径/文件名、用户提问、工具名（含中文别名
		 *  「编辑 / 命令」）、状态（含中文别名「新增 / 修改 / 删除 / 工作区外」）。
		 *  提问：轮次载荷在 sections[0].question，全量 summary 载荷在 question 字段。
		 *  @param {object} f 列表文件项
		 *  @returns {string} 小写化的并集文本 */
		function liveHaystack(f) {
			const parts = [f.path, f.repoPath, f.absPath, f.name];
			parts.push((f.sections && f.sections.length > 0 && f.sections[0].question) || f.question || "");
			// 工具名本身可搜（write / run_code…），同时补上语义别名，让「编辑 / 命令」也能搜
			for (const tool of f.tools || []) {
				parts.push(tool);
				parts.push(liveSourceOf(tool) === "edit" ? "编辑" : "命令");
			}
			// 状态与工作区外同理：英文原值 + 中文别名都进并集
			if (f.status === "added") { parts.push("added", "新增"); }
			else if (f.status === "modified") { parts.push("modified", "修改"); }
			else if (f.status === "deleted") { parts.push("deleted", "删除"); }
			if (f.outside === true) { parts.push("outside", "工作区外", "外部"); }
			return parts.filter((x) => typeof x === "string" && x).join(" ").toLowerCase();
		}
		/** 关键词是否命中：分词后每个词都要在字段并集里出现
		 *  @param {object} f 列表文件项
		 *  @param {string} query 用户输入的关键词（空白分词 = AND）
		 *  @returns {boolean} */
		function liveMatchQuery(f, query) {
			const terms = String(query || "").trim().toLowerCase().split(/\s+/).filter((x) => x);
			if (terms.length === 0) { return true; }
			const hay = liveHaystack(f);
			return terms.every((t) => hay.indexOf(t) >= 0);
		}
		/** 快捷筛选谓词：关键词 + 三组 chip 全部满足才通过
		 *  @param {object} f 列表文件项
		 *  @param {string} query 关键词
		 *  @param {string[]} statusSel 状态 chip（added / modified）
		 *  @param {string[]} sourceSel 来源 chip（edit / command）
		 *  @param {number[]} turnSel 轮次 chip（轮次号；按「文件曾在某一轮被改过」判定）
		 *  @returns {boolean} */
		function liveMatch(f, query, statusSel, sourceSel, turnSel) {
			// 状态组：组内或、组间与 —— 不在选中集合里直接否掉
			if (statusSel.length > 0 && statusSel.indexOf(f.status) < 0) { return false; }
			// 来源组：文件级判定（任一工具属于所选分组即算命中，不精确到单条 op）
			if (sourceSel.length > 0) {
				const hit = (f.tools || []).some((tool) => sourceSel.indexOf(liveSourceOf(tool)) >= 0);
				if (!hit) { return false; }
			}
			// 轮次组：文件曾在所选轮次中的任意一轮被改过即命中
			if (turnSel.length > 0) {
				const hit = (f.turns || []).some((t) => turnSel.indexOf(t) >= 0);
				if (!hit) { return false; }
			}
			return liveMatchQuery(f, query);
		}
		// 状态 / 来源 chip 的展示定义（[取值, 标签]）。删除与工作区外不在这里——它们是
		// 标题栏那两枚降噪开关，二级页面刻意不重复，避免同一条件两处各存一份互相覆盖
		// 标题栏摘要里最多列出的文件名个数（以「 | 」连接）：标题栏宽度有限，文件名再多也只是
		// 把省略号拉长；超出的部分交给摘要的悬停提示（title 里是全部文件名）
		const LIVE_SUMMARY_FILES = 5;
		const LIVE_STATUS_CHIPS = [["added", "新增"], ["modified", "修改"]];
		const LIVE_SOURCE_CHIPS = [["edit", "编辑"], ["command", "命令"]];

		// ── 审查列表面板：对话框上方（conversation.input.dock）展示最新一轮修改的
		// 文件与对应问题，折叠/展开均显示；点击文件行展开该轮 diff，随 SSE/轮询实时刷新。
		function LivePanel(props) {
			const colors = useStore((s) => s.colors);
			const session = useStore((s) => s.currentSession);
			const tick = useStore((s) => s.reviewTick);
			const latestTurn = useStore((s) => s.latestTurn);
			const currentTurn = useStore((s) => s.currentTurn);
			// 作用域轮次：优先「会话当前轮次」（宿主在每轮一开始就给出，此时本轮可能还没有
			// 任何变更），只有旧记录（日志里没有轮次信息）才退回「最近有记录的轮次」
			const scopeTurn = currentTurn > 0 ? currentTurn : latestTurn;
			const files = useStore((s) => s.files);
			// 绑定到「当前对话」：dock 插槽会把活动会话 id 传进来。若沿用全局
			// store.currentSession，新建/切换对话时容易读到上个会话的过期记录
			// （conversation.session.header.actions 对全新的空会话不一定触发），
			// 导致「审查列表」面板在空会话里也残留。这里以 dock 的活动会话为准。
			React.useEffect(() => {
				const sid = props.sessionId;
				if (sid && store.currentSession !== sid) {
					reqSeq++; // 丢弃上一个会话仍在途的请求
					setState({ currentSession: sid, files: null, selected: null, detail: null, mode: "session", turnData: null, latestTurn: 0, currentTurn: 0, error: null, loadingFiles: false, reviewTick: store.reviewTick + 1 });
					refreshFromServer();
				}
			}, [props.sessionId]);
			// 展开/折叠状态：初值取「本会话记忆」，没有记忆时默认折叠。每次用户点击都会
			// 写进模块级记忆 + Host 端 ui-prefs（面板高度同一份 ui/<sessionId>.json），
			// 组件重新挂载/页面刷新后照旧展开，任何自动流程都不改它。
			const [collapsed, setCollapsedState] = React.useState(() => {
				const saved = props.sessionId ? livePanelCollapsed[props.sessionId] : undefined;
				return typeof saved === "boolean" ? saved : true;
			});
			const setCollapsed = (next) => {
				const sid = props.sessionId || session;
				if (sid) { livePanelCollapsed[sid] = next; }
				setCollapsedState(next);
				if (!sid) { return; }
				fetch("/diff-review/ui-prefs", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ session: sid, collapsed: next })
				}).catch(() => {});
			};
			// 范围筛选：三态 —— "latest"（只看最新轮次，默认）/ "all"（全部轮次）/ "none"（两枚
			// 范围按钮都不选中）。「点击选中、再点同一枚取消选中」是刻意设计：范围选 "none" 后
			// 常规改动一条不进列表，内容只由下面两个降噪开关决定，于是单独打开「已删除」= 只看
			// 删除态文件、单独打开「工作区外」= 只看工作区外文件（两者都开 = 并集）
			const [scope, setScope] = React.useState("latest");
			// 范围按钮点击语义：已选中 → 取消选中（none）；未选中 → 选中它
			const toggleScope = (next) => { setScope((cur) => (cur === next ? "none" : next)); };
			// 已删除的文件是否列出：默认隐藏。删除态多为临时脚手架或被移走的文件，它们
			// 按时间倒序挤在列表最前，会把真正有价值的改动压到下面（diff 记录仍在）。
			const [showDeleted, setShowDeleted] = React.useState(false);
			// 工作区外文件（绝对路径不在会话工作区内，例如 $DSH_HOME 下的脚本、别的仓库）
			// 同样默认隐藏，需要时用标题栏按钮显示出来
			const [showOutside, setShowOutside] = React.useState(false);
			// ── 快捷筛选 + 搜索（2026-09-21）：漏斗按钮展开筛选区，就地过滤当前列表。
			// 全部是**组件态**：刷新页面 / 重开面板即重置，不落盘（与上下文展开档位一致）；
			// 折叠成摘要条时筛选区照样能展开，只是列表本身不渲染。
			const [filterOpen, setFilterOpen] = React.useState(false);
			const [query, setQuery] = React.useState("");
			// 状态组：只放「新增 / 修改」。删除态与工作区外仍由标题栏那两枚降噪开关承担，
			// 二级页面不重复出现——否则同一个条件两处各存一份，极容易互相覆盖
			const [fStatus, setFStatus] = React.useState([]);
			// 来源组：'edit'（内置 write/edit）/ 'command'（其余一切，含未知 via）
			const [fSource, setFSource] = React.useState([]);
			// 轮次组：具体轮次号（多选 = 或）
			const [fTurns, setFTurns] = React.useState([]);
			/** chip 通用开关：已选中 → 取消；未选中 → 选中（与标题栏范围按钮同一交互约定）
			 *  @param {Function} setter 对应的 useState setter
			 *  @param {string} v chip 取值 */
			const toggleChip = (setter, v) => {
				setter((cur) => (cur.indexOf(v) >= 0 ? cur.filter((x) => x !== v) : cur.concat(v)));
			};
			/** 轮次 chip：选中任意轮次时自动把范围切到「全部轮次」——具体轮次的数据只在全量
			 *  列表里，「当前轮次」那份只含最新一轮，不切会出现按钮高亮与实际内容自相矛盾；
			 *  全部取消后**不回滚**（停在「全部轮次」，用户看得见按钮状态、想回当前轮再点一下）
			 *  @param {number} t 轮次号 */
			const toggleTurn = (t) => {
				const next = fTurns.indexOf(t) >= 0 ? fTurns.filter((x) => x !== t) : fTurns.concat(t);
				setFTurns(next);
				if (next.length > 0) { setScope("all"); }
			};
			/** 一键清空：关键词 + 三组 chip。标题栏范围与两个降噪开关不在其中——它们一直
			 *  显示在标题栏上，不归「清空筛选」管 */
			const clearFilters = () => {
				setQuery(""); setFStatus([]); setFSource([]); setFTurns([]);
			};
			// 切会话清空关键词与全部 chip；**换轮次、或有新改动到来都保留**——一边看一边改的
			// 时候，筛选条件不能被自动流程悄悄重置
			React.useEffect(() => { clearFilters(); }, [session]);
			// 展开后手动拖拽的高度（px）；null 用默认自适应（列表自适应其内容高度）。初始 null，
			// 已保存的高度由下方 effect 异步从 Host 拉取后应用。
			// 注意：不能用 localStorage——Web GUI 端口每次重启都变，origin 隔离
			// 会把存的偏好随端口丢掉，因此持久化走 Host 端 diff-review/ui.json
			const [panelH, setPanelH] = React.useState(null);
			// 会话切换时拉取该会话已保存的面板高度并应用（各会话高度互相独立）
			React.useEffect(() => {
				if (!session) return;
				// 会话切换：先落到该会话已记忆的折叠状态（没有记忆就默认折叠），
				// Host 端偏好异步到达后再修正——避免沿用上一个会话的展开状态
				const remembered = livePanelCollapsed[session];
				setCollapsedState(typeof remembered === "boolean" ? remembered : true);
				let alive = true;
				fetch("/diff-review/ui-prefs?session=" + encodeURIComponent(session)).then((r) => r.json()).then((v) => {
					const h = v && v.prefs && v.prefs.panelH;
					// 仅当当前无显式高度（用户尚未拖拽）时才应用，避免覆盖用户操作
					if (alive && Number.isFinite(h) && h >= 96) { setPanelH((cur) => (cur == null ? h : cur)); }
					// 折叠状态同理：本次页面里用户已经点过就听用户的，否则用 Host 记忆的
					const savedCollapsed = v && v.prefs && v.prefs.collapsed;
					if (alive && typeof savedCollapsed === "boolean" && livePanelCollapsed[session] === undefined) {
						livePanelCollapsed[session] = savedCollapsed;
						setCollapsedState(savedCollapsed);
					}
				}).catch(() => {});
				return () => { alive = false; };
			}, [session]);
			// 高度持久化策略：只有「用户主动拖拽结束」才把最终高度写入 Host
			// （ui/<sessionId>.json）；打开文件的临时撑大、关闭预览的固化只是
			// 当次显示行为，不写存储——否则会覆盖用户的拖拽偏好。
			// panelHRef 镜像最新高度，供拖拽结束回调读取（避免闭包旧值）
			const panelHRef = React.useRef(null);
			React.useEffect(() => { panelHRef.current = panelH; }, [panelH]);
			const cardRef = React.useRef(null);
			const resizeRef = React.useRef(null);
			// 按住标题栏下方分隔线拖拽调整卡片高度：window 级 mousemove 跟随，
			// 高度钳制在 [96, 视口 85%]；拖拽期间禁用文本选择
			const onResizeStart = (e) => {
				e.preventDefault(); e.stopPropagation();
				const el = cardRef.current;
				if (!el) return;
				resizeRef.current = { startY: e.clientY, startH: el.getBoundingClientRect().height };
				try { document.body.style.userSelect = "none"; } catch (err) {}
				const onMove = (ev) => {
					const r = resizeRef.current;
					if (!r) return;
					const maxH = Math.max(200, Math.round(window.innerHeight * 0.85));
					setPanelH(Math.max(96, Math.min(maxH, r.startH - (ev.clientY - r.startY))));
				};
				const onUp = () => {
					resizeRef.current = null;
					try { document.body.style.userSelect = ""; } catch (err) {}
					window.removeEventListener("mousemove", onMove);
					window.removeEventListener("mouseup", onUp);
					// 拖拽结束：以最终高度持久化用户偏好（打开/关闭引起的临时
					// 变化不走这里，不会覆盖拖拽保存的值）；同时同步镜像，
					// 保证关闭预览时的乐观占位与存储一致
					const h = panelHRef.current;
					if (h != null && session) {
						fetch("/diff-review/ui-prefs", {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ session: session, panelH: h })
						}).catch(() => {});
					}
				};
				window.addEventListener("mousemove", onMove);
				window.addEventListener("mouseup", onUp);
			};
			// 行内 diff 已移除：点行/点「查看 diff」都在右侧栏打开 diff tab
			// 审查列表数据 = **当前轮次**的文件（含该轮问题）。当前轮次由宿主给出：会话里
			// 「最近开始的轮次」——每轮一开始（哪怕这一轮还没有任何改动）就会变化，列表随之
			// 切换，不再沿用上一轮的旧列表。旧记录没有轮次信息（currentTurn 与 latestTurn
			// 皆为 0）时列表为空，范围自动按「全部」处理。
			// 文件列表的「展示字段」签名：内容一致就跳过 setState——SSE 每记录一次改动都会
			// bump tick 触发重取，无谓的 state 更新会让展开的列表整体重渲染（「闪动」来源之一）
			const turnSigOf = (list) => (list || []).map((f) => [
				f.path, f.status, f.lastTime, f.ops, f.added, f.removed, f.repoPath,
				(f.turns || []).join(","), (f.tools || []).join(","), f.outside === true,
				(f.sections && f.sections.length > 0 && f.sections[0].question) || ""
			].join("~")).join("|");
			const scopeKey = (session || "") + "|" + scopeTurn;
			// 初值优先取模块级缓存：面板被重新挂载（框架重建 dock 条目）时立即可用，
			// 不会先渲染成「加载当前轮次…」
			const [latestFiles, setLatestFiles] = React.useState(() => (
				Object.prototype.hasOwnProperty.call(liveTurnCache, scopeKey) ? liveTurnCache[scopeKey] : null
			));
			// 记住上一次取数用的作用域键：**只有它变化才清空列表**（显示「加载当前轮次…」）。
			// 旧实现在每次 tick 变化时都 setLatestFiles(null)，于是同轮次里每来一次新改动，
			// 展开的列表都会先被替换成加载提示再重建——即用户反馈的「闪动」
			const lastScopeKeyRef = React.useRef(null);
			React.useEffect(() => {
				const key = (session || "") + "|" + scopeTurn;
				if (lastScopeKeyRef.current !== key) {
					lastScopeKeyRef.current = key;
					// 真换了轮次/会话：有缓存（重挂载、或在同一轮之间来回）就直接用，没有才显示加载提示
					setLatestFiles(Object.prototype.hasOwnProperty.call(liveTurnCache, key) ? liveTurnCache[key] : null);
				}
				if (!session || !scopeTurn) { return; }
				let alive = true;
				(async () => {
					try {
						const v = await apiTurn(session, scopeTurn);
						if (!alive) { return; }
						const files = (v && v.files) || [];
						rememberTurnFiles(key, files);
						// 内容没变则复用原数组：避免每次 SSE 都触发一次整列表重渲染
						setLatestFiles((cur) => (Array.isArray(cur) && turnSigOf(cur) === turnSigOf(files) ? cur : files));
					} catch (e) {
						// 出错只解除「加载中」：已经有内容就保持不动，别把列表清掉
						if (alive) { setLatestFiles((cur) => (Array.isArray(cur) ? cur : [])); }
					}
				})();
				return () => { alive = false; };
			}, [session, scopeTurn, tick]);
			// 展开列表数据 = 全部修改的文件（不限轮次），按修改时间倒序；
			// slice 复制避免原地改动 store 数据
			const allList = (files || []).slice().sort((a, b) => (b.lastTime || 0) - (a.lastTime || 0));
			// 当前轮次的文件（scopeTurn 那一轮，不再向更早的轮次回退）。
			// 这份数据刻意不「回退到全量」：一旦回退，非当前轮次的文件也会被当成当前轮次，
			// 既被范围筛选放进来、又被涂上标记色（旧实现在数据未就绪时把全量当当前轮次，
			// 于是每个文件名都带颜色）。
			// scopeTurn 为 0 说明这批记录没有任何轮次信息（旧记录），无从判定「当前轮次」，
			// 此时按「全部」处理，否则面板会永远停在「加载当前轮次…」
			const latestLoading = latestFiles === null && scopeTurn > 0;
			const latestList = latestFiles || [];
			// 范围筛选：latest = 只看当前轮次（无轮次信息时退回全量），all = 全部轮次，
			// none = 两枚范围按钮都取消选中 —— 基础列表为空，列表内容完全交给
			// 「已删除 / 工作区外」两个降噪开关（支撑「只查看」删除态或工作区外文件）
			const scopeList = scope === "none" ? [] : ((scope === "latest" && scopeTurn > 0) ? latestList : allList);
			// 生效条件数（漏斗角标）：关键词算 1，每枚选中 chip 各算 1；它同时决定计数文案
			// 与空态是否需要按「没有匹配的文件」来解释
			const filterCount = (query.trim() ? 1 : 0) + fStatus.length + fSource.length + fTurns.length;
			const filterActive = filterCount > 0;
			/** 关键词 + 三组 chip 的过滤谓词（未设任何条件时恒真）
			 *  @param {object} f 列表文件项 @returns {boolean} */
			const matchFilter = (f) => liveMatch(f, query, fStatus, fSource, fTurns);
			// 「范围 → 搜索 → 降噪」三段式：关键词/chip 先收窄「范围列表」与「降噪补入源」，
			// 再走降噪开关——它们同样要吃到同一份过滤，否则打开「已删除」时会冒出一堆与
			// 关键词无关的文件
			const scopeListF = filterActive ? scopeList.filter(matchFilter) : scopeList;
			// 降噪补入源（2026-09-21 起**跟随范围**）：开关打开的「已删除 / 工作区外」文件从
			// 当前范围里补，不再一律从全量补——「当前轮次」下打开「已删除」时，其它轮次的
			// 删除态文件不该混进这份列表（用户要求：这两枚筛选按钮也要遵循当前轮次 / 全部轮次）。
			// 唯一例外是范围全取消（scope === "none"）：那时基础列表为空，开关退回全量，
			// 保住「只看删除态 / 只看工作区外」这个入口
			const noiseSrcList = scope === "none" ? allList : scopeList;
			const noiseSrcListF = filterActive ? noiseSrcList.filter(matchFilter) : noiseSrcList;
			// 降噪开关（默认都隐藏）：已删除 = 多为临时脚手架/被移走的文件；
			// 工作区外 = 会话工作区之外的路径。这两个数量恒按「会话总量」统计，
			// 不随范围筛选联动——它回答的是「本会话有多少这类文件」，切「全部」也不变
			const deletedCount = allList.filter((f) => f.status === "deleted").length;
			const outsideCount = allList.filter((f) => f.outside === true).length;
			// 数字用「当前范围数量/会话总量」：让「本轮没有、会话里有 N 个」一眼可见
			const deletedInScope = scopeList.filter((f) => f.status === "deleted").length;
			const outsideInScope = scopeList.filter((f) => f.outside === true).length;
			// 「只查看」模式（scope = "none"）下基础列表为空，「当前范围数量」没有意义：两个降噪
			// 按钮只显示会话总量，否则会出现「显示 0/3、点开却有 3 条」的困惑
			const deletedBadge = scope === "none" ? String(deletedCount) : deletedInScope + "/" + deletedCount;
			const outsideBadge = scope === "none" ? String(outsideCount) : outsideInScope + "/" + outsideCount;
			// 打开的降噪开关在**当前范围**里能补进多少条（未套用关键词/chip 的口径）。为 0 时
			// 不能说成「被降噪开关藏起来了」——那是「这个范围本来就没有」，空态要给准确解释与
			// 出口；noiseTotalCount 是同一口径的会话总量，用来措辞「会话里共 N 个」
			const noiseActive = showDeleted || showOutside;
			const noiseHitOf = (list) => list.filter((f) => (showDeleted && f.status === "deleted") || (showOutside && f.outside === true)).length;
			const noiseInScopeCount = noiseHitOf(noiseSrcList);
			const noiseTotalCount = noiseHitOf(allList);
			// 开关类别名（顺序固定：已删除 → 工作区外），摘要前缀与空态文案共用
			const noiseLabel = [showDeleted ? "已删除" : "", showOutside ? "工作区外" : ""].filter((x) => x).join(" / ");
			/** 降噪按钮的悬停说明：数量按当前范围措辞，避免把「本轮 0 个」说成「会话里 3 个」
			 *  @param {string} label 类别名（已删除 / 工作区外）
			 *  @param {number} inScope 当前范围内该类文件数
			 *  @param {number} total 会话该类文件总数
			 *  @param {boolean} on 开关是否已打开
			 *  @returns {string} title 文案 */
			const noiseTitle = (label, inScope, total, on) => {
				if (on) {
					return scope === "none" ? ("取消「" + label + "」筛选（当前列表只显示删除态 / 工作区外）") : ("隐藏" + label + "的文件（diff 记录仍保留）");
				}
				if (scope === "latest") {
					return "显示本轮" + label + "的文件（本轮 " + inScope + " 个 / 会话共 " + total + " 个）";
				}
				if (scope === "none") {
					return "只查看" + label + "的文件（会话共 " + total + " 个）";
				}
				return "显示" + label + "的文件（会话共 " + total + " 个）";
			};
			// 范围按钮上的数量 = 该范围里「默认会列出多少」：**不含**删除态与工作区外
			// （这两类默认被降噪开关藏起来，计进去会与实际列出的条数对不上）；无轮次
			// 信息时「最新」实际走全量，数字也跟着走
			const latestCount = (scopeTurn > 0 ? latestList : allList).filter((f) => f.status !== "deleted" && f.outside !== true).length;
			const allCount = allList.filter((f) => f.status !== "deleted" && f.outside !== true).length;
			// 列表 = 范围筛选结果（默认已藏起删除态/工作区外）＋ 开关打开时从**当前范围**补
			// 进来的该类文件（范围全取消时退回全量，见上面的 noiseSrcList）。开关跟随范围是
			// 2026-09-21 的行为变更：旧实现恒从全量补，于是「当前轮次」下打开「已删除」会把其它
			// 轮次的文件混进来（当时是为「按钮可见、点了没反应」让路；现在改成按钮保留 ＋ 角标
			// 0/N ＋ 空态明确提示，不再需要那个口子）。
			// 合并逻辑抽成 mergeVisible 跑两遍——一遍带关键词/chip（结果列表），
			// 一遍不带（「命中 N / 范围 M」里 M 的口径：筛之前本来能看到多少条）
			/** 把「范围列表 + 降噪补入列表」合并去重、按最近修改时间倒序
			 *  @param {object[]} scopeSrc 范围列表（已可选地过滤过）
			 *  @param {object[]} noiseSrc 降噪补入源（已可选地过滤过）
			 *  @returns {object[]} 最终展示顺序的列表 */
			const mergeVisible = (scopeSrc, noiseSrc) => {
				const base = scopeSrc.filter((f) => f.status !== "deleted" && f.outside !== true);
				const extra = noiseActive
					? noiseSrc.filter((f) => (showDeleted && f.status === "deleted") || (showOutside && f.outside === true))
					: [];
				// 合并去重（同一文件可能同时命中两个开关），再按最近修改时间倒序
				const seenPaths = new Set();
				const out = [];
				for (const f of base.concat(extra)) {
					const pathKey = String(f.path);
					if (seenPaths.has(pathKey)) { continue; }
					seenPaths.add(pathKey);
					out.push(f);
				}
				out.sort((a, b) => (b.lastTime || 0) - (a.lastTime || 0));
				return out;
			};
			const visibleList = mergeVisible(scopeListF, noiseSrcListF);
			// 没设关键词/chip 时 visibleList 就是未过滤结果，直接复用它的长度（省一次过滤）
			const scopeTotal = filterActive ? mergeVisible(scopeList, noiseSrcList).length : visibleList.length;
			// 轮次 chip 候选：全量列表里出现过的轮次号，倒序取最近 6 个。候选只来自 summary
			// （有过改动的轮次），空转轮次不出现——这是期望行为；已选中但已掉出候选的轮次号
			// 补回来，避免它的选中态莫名消失
			const turnChipList = (() => {
				const seen = [];
				for (const f of allList) {
					for (const t of f.turns || []) {
						if (t > 0 && seen.indexOf(t) < 0) { seen.push(t); }
					}
				}
				seen.sort((a, b) => b - a);
				const list = seen.slice(0, 6);
				for (const t of fTurns) {
					if (list.indexOf(t) < 0) { list.push(t); }
				}
				list.sort((a, b) => b - a);
				return list;
			})();
			// 条件互斥：打开「已删除」时补进来的文件状态必为 deleted，而状态 chip 只认
			// 「新增 / 修改」——两者不可能同时成立。空列表要明确说是条件打架，否则会被
			// 当成「确实没有这类改动」
			const filterConflict = showDeleted && fStatus.length > 0;
			// 空列表提示：按「数据还没到 → 范围没选 → 这一轮确实没有 → 这个范围本来就没有该类
			// 文件 → 被筛掉 / 被降噪藏起」的优先级判定。客观事实优先于筛选解释：本轮真的没有
			// 改动时，不能说成「没有匹配的文件」，反过来误导用户
			let emptyHint = "";
			if (latestLoading && scope === "latest") {
				emptyHint = "加载当前轮次…";
			} else if (scope === "none" && !noiseActive) {
				emptyHint = "未选择范围：点上方图标选「最新轮次」或「全部轮次」，或打开「已删除 / 工作区外」只看该类文件";
			} else if (scope === "latest" && latestList.length === 0 && !noiseActive) {
				emptyHint = "本轮暂无变更";
			} else if (noiseActive && noiseInScopeCount === 0) {
				// 开关打开的类别在**当前范围**里一个都没有：不是「被藏起来了」，而是这个范围本来就
				// 没有——按钮保留（角标 0/N），点开后必须给出出口，不能是没反应的空点击
				emptyHint = (scope === "latest" && noiseTotalCount > 0)
					? ("本轮没有「" + noiseLabel + "」的文件：会话里共 " + noiseTotalCount + " 个，切到「全部轮次」可查看")
					: ("没有「" + noiseLabel + "」的文件");
			} else if (filterActive) {
				emptyHint = filterConflict
					? "当前筛选条件互相排斥（「已删除」与「新增 / 修改」不可能同时成立）"
					: "没有匹配的文件";
			} else {
				emptyHint = "当前范围的文件都被降噪开关藏起来了（点上方图标可查看）";
			}
			// 标题行摘要数据 = **当前列表里实际列出的文件**（visibleList）：范围或降噪开关一变，
			// 摘要立刻跟着变——最新轮次 = 本轮文件、全部轮次 = 全量改动、只查看模式 = 该类文件
			// （旧实现恒取 latestList（当前轮次），于是「全部轮次」与「只查看删除」下摘要与列表对不上）
			const titleList = visibleList;
			// 该轮提问（qOf）：轮次载荷里 sections 已倒序，sections[0] 即该文件该轮最近一次修改；
			// 「全部轮次」用的是 summary 载荷（没有 sections），改读宿主补的 question 字段
			// （2026-09-21）。**摘要里不再拼接它**（用户要求：标题栏只显示最近修改的文件），
			// 这里只为下面的列表行渲染保留（scope !== "latest" 时行尾显示该问题的标记色文本）
			const qOf = (f) => (f && ((f.sections && f.sections.length > 0 && f.sections[0].question) || f.question)) || '';
			// 摘要前缀 = 当前视图标签：范围（最近变动 / 全部轮次）与已打开的降噪开关（已删除 /
			// 工作区外）组合；范围全取消（none）时前缀只由开关决定，两个都开则为「已删除 / 工作区外」
			const scopeLabel = scope === "all" ? "全部轮次" : (scope === "latest" ? "最近变动" : "");
			// noiseLabel 已在上方（角标那一段）定义：摘要前缀与空态文案共用同一份类别名
			const sumLabel = scope === "none" ? (noiseLabel || "未选择范围") : (noiseLabel ? scopeLabel + " + " + noiseLabel : scopeLabel);
			// 摘要正文（2026-09-21 改版）：只列**最近修改的文件名**，最多 LIVE_SUMMARY_FILES 个
			// （以「 | 」连接，按修改时间倒序，与列表顺序一致）；**不再拼接用户提问**——标题栏一行
			// 放不下，提问在列表行（全部轮次视图的行尾）与行悬停提示里都能看到。
			const basenameOf = (f) => String((f && f.path) || "").split(/[\/\\]/).pop() || (f && f.name) || "";
			// 可见文案：前缀 + 最近 LIVE_SUMMARY_FILES 个文件名；超出的部分折成「…（共 N 个）」，
			// 再长的部分交给 CSS 单行省略
			const sumNames = titleList.slice(0, LIVE_SUMMARY_FILES).map(basenameOf).join(" | ");
			const sumMore = titleList.length > LIVE_SUMMARY_FILES ? ("…（共 " + titleList.length + " 个）") : "";
			const summaryText = sumLabel + " - " + sumNames + sumMore;
			// 悬停提示：标题栏宽度有限、可见文案会被省略号截断，title 不受这个限制，于是
			// 超出上限的文件在这里照样能看到（未超上限时与可见文案逐字相同，不做冗余拼接）
			const summaryTitle = titleList.length > LIVE_SUMMARY_FILES
				? (sumLabel + " - " + titleList.map(basenameOf).join(" | "))
				: summaryText;
			// 行内 diff 已移除（改由右侧栏 diff tab 承载），这里只保留列表所需的
			// 早退与「打开 diff」入口；高度拖拽与偏好持久化逻辑保持不变。
			if (!session || allList.length === 0) return null;
			// 打开侧栏 diff tab（原先的行内展开与全屏窗口都改为侧栏承载）；
			// 侧栏 tab 不可用（sidebarRight 服务缺失 / 类型未注册）时降级为
			// 在侧栏打开该文件，保证点击永远有反馈。
			const openDiff = (f) => {
				if (!session || !f || !f.path) return;
				if (openSidebarDiff(session, f.path)) return;
				openFileDefault(f, session);
			};
			/** 筛选区 chip：选中态再点一次即取消（与标题栏范围按钮同一交互约定）
			 *  @param {string} key React key
			 *  @param {string} label 按钮文字
			 *  @param {boolean} on 是否选中
			 *  @param {Function} onClick 点击回调
			 *  @param {string} title 悬停说明
			 *  @returns {object} React 元素 */
			const filterChip = (key, label, on, onClick, title) => React.createElement("button", {
				type: "button",
				key: key,
				className: "drv-btn dsdrv-livepanel-fb-chip" + (on ? " dsdrv-livepanel-fb-chip-on" : ""),
				title: title,
				"aria-pressed": on ? "true" : "false",
				onClick: (e) => { e.stopPropagation(); onClick(); }
			}, label);
			return React.createElement(React.Fragment, null,
				React.createElement("div", { className: "dsdrv-livepanel" },
				React.createElement("div", { ref: cardRef, className: "dsdrv-livepanel-card", style: (!collapsed && panelH) ? { height: panelH + "px", maxHeight: "none" } : undefined },
				React.createElement("div", { className: "dsdrv-livepanel-head" + (collapsed ? "" : " dsdrv-livepanel-head-open"), title: collapsed ? "展开审查列表" : "折叠审查列表", onClick: () => setCollapsed(!collapsed) },
					React.createElement("span", { className: "dsdrv-livepanel-icon" },
						React.createElement("svg", { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" },
							React.createElement("circle", { cx: 12, cy: 12, r: 9 }),
							React.createElement("path", { d: "M12 6.5v5.5l3.5 2" }))),
					React.createElement("span", { className: "dsdrv-livepanel-title" }, "审查列表"),
					// 计数：未筛选时是「N 个文件」；筛选/搜索生效时换成「命中 N / 范围 M」——M 是
					// 不套用关键词与 chip 时列表本来会显示的数量（已含范围与降噪开关的效果）
					React.createElement("span", {
						className: "dsdrv-livepanel-count",
						title: filterActive ? ("命中 " + visibleList.length + " 个；筛选前本来显示 " + scopeTotal + " 个") : undefined
					}, filterActive ? ("命中 " + visibleList.length + " / 范围 " + scopeTotal) : (visibleList.length + " 个文件")),
					// 摘要 span：视图标签前缀（随范围/降噪开关变化）+ 最近修改的文件名；
					// 提问不再出现在这里（只列文件）；悬停提示给全部文件名（见 summaryTitle）
					titleList.length > 0 ? React.createElement("span", { className: "dsdrv-livepanel-summary", title: summaryTitle },
						summaryText) : null,
					// 占位块只在**没有摘要**时渲染：摘要的 flex-grow 与占位块同为 1，两个都在时会把
					// 剩余宽度对半分，于是文件名提前被省略号截断、右侧还留一段空位（用户反馈
					// 「空位还有一点，给他大一点的长度」）。没有摘要（无文件可列）时才靠它把右侧
					// 按钮顶到最右，避免按钮贴着计数左对齐
					titleList.length > 0 ? null : React.createElement("span", { className: "drv-header-spacer" }),
			// 范围筛选：两枚互斥**纯图标 + 数量**按钮（首行高亮 = 只看最新轮次；三行 = 全部），
			// 点已选中的那枚即取消选中（scope = "none"：两枚都不高亮，列表只剩降噪开关给出的
			// 内容）；完整语义放 title / aria-label，窄面板也放得下
			React.createElement("button", {
				type: "button",
				className: "drv-btn dsdrv-livepanel-filter dsdrv-livepanel-filter-icon" + (scope === "latest" ? " dsdrv-livepanel-filter-on" : ""),
				title: scope === "latest"
					? "取消范围筛选（取消后列表只显示「已删除 / 工作区外」里打开的开关）"
					: "只看最新轮次（" + latestCount + " 个文件）",
				"aria-label": "只看最新轮次（再点取消）",
				onClick: (e) => { e.stopPropagation(); toggleScope("latest"); }
			},
				React.createElement("svg", { width: 12, height: 12, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" },
					React.createElement("path", { d: "M4 6h16" }),
					React.createElement("path", { d: "M4 12h10", opacity: 0.35 }),
					React.createElement("path", { d: "M4 18h10", opacity: 0.35 })),
				React.createElement("span", { className: "dsdrv-livepanel-filter-n" }, String(latestCount))),
			React.createElement("button", {
				type: "button",
				className: "drv-btn dsdrv-livepanel-filter dsdrv-livepanel-filter-icon" + (scope === "all" ? " dsdrv-livepanel-filter-on" : ""),
				title: scope === "all"
					? "取消范围筛选（取消后列表只显示「已删除 / 工作区外」里打开的开关）"
					: "显示全部轮次（" + allCount + " 个文件）",
				"aria-label": "显示全部轮次（再点取消）",
				onClick: (e) => { e.stopPropagation(); toggleScope("all"); }
			},
				React.createElement("svg", { width: 12, height: 12, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" },
					React.createElement("path", { d: "M4 6h16" }),
					React.createElement("path", { d: "M4 12h16" }),
					React.createElement("path", { d: "M4 18h16" })),
				React.createElement("span", { className: "dsdrv-livepanel-filter-n" }, String(allCount))),
					// 已删除：图标 + 数量（默认隐藏）
					deletedCount > 0 ? React.createElement("button", {
						type: "button",
						className: "drv-btn dsdrv-livepanel-filter dsdrv-livepanel-filter-icon" + (showDeleted ? " dsdrv-livepanel-filter-on" : ""),
						title: noiseTitle("已删除", deletedInScope, deletedCount, showDeleted),
						"aria-label": "显示或隐藏已删除的文件",
						onClick: (e) => { e.stopPropagation(); setShowDeleted(!showDeleted); }
					},
						React.createElement("svg", { width: 12, height: 12, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" },
							React.createElement("path", { d: "M3 6h18" }),
							React.createElement("path", { d: "M8 6V4h8v2" }),
							React.createElement("path", { d: "M6 6l1 14h10l1-14" })),
						React.createElement("span", { className: "dsdrv-livepanel-filter-n" }, deletedBadge)) : null,
					// 工作区外：图标 + 数量（默认隐藏）
					outsideCount > 0 ? React.createElement("button", {
						type: "button",
						className: "drv-btn dsdrv-livepanel-filter dsdrv-livepanel-filter-icon" + (showOutside ? " dsdrv-livepanel-filter-on" : ""),
						title: noiseTitle("工作区外", outsideInScope, outsideCount, showOutside),
						"aria-label": "显示或隐藏工作区外的文件",
						onClick: (e) => { e.stopPropagation(); setShowOutside(!showOutside); }
					},
						React.createElement("svg", { width: 12, height: 12, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" },
							React.createElement("path", { d: "M14 4h6v6" }),
							React.createElement("path", { d: "M20 4l-8 8" }),
							React.createElement("path", { d: "M18 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" })),
						React.createElement("span", { className: "dsdrv-livepanel-filter-n" }, outsideBadge)) : null,
					// 快捷筛选入口：漏斗 + 生效条件数角标。点开的是「筛选区」（搜索框 + 三组 chip），
					// 列表就地过滤；折叠成摘要条时也能点开。刻意不做键盘快捷键——官方客户端没有
					// 空闲的全局键位，而「/」在输入框里是斜杠命令菜单的触发字符，全局监听会抢掉它
					React.createElement("button", {
						type: "button",
						className: "drv-btn dsdrv-livepanel-filter dsdrv-livepanel-filter-icon" + (filterOpen ? " dsdrv-livepanel-filter-on" : ""),
						title: filterOpen ? "收起筛选区" : "展开筛选区：搜索文件名 / 提问 / 工具 / 状态，或按状态、来源、轮次快筛",
						"aria-label": "展开或收起筛选区",
						onClick: (e) => { e.stopPropagation(); setFilterOpen(!filterOpen); }
					},
						React.createElement("svg", { width: 12, height: 12, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" },
							React.createElement("path", { d: "M3 5h18l-7 8v7l-4-2v-5z" })),
						filterCount > 0 ? React.createElement("span", { className: "dsdrv-livepanel-filter-badge", title: "生效中的筛选条件数" }, String(filterCount)) : null),
					React.createElement("button", { type: "button", className: "dsdrv-livepanel-collapse", title: collapsed ? "展开" : "折叠", onClick: (e) => { e.stopPropagation(); setCollapsed(!collapsed); } },
						React.createElement("svg", { width: 13, height: 13, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round" },
							collapsed ? React.createElement("polyline", { points: "18 15 12 9 6 15" }) : React.createElement("polyline", { points: "6 9 12 15 18 9" })))),
				// 筛选区（即「二级页面」）：标题栏下方就地展开，列表留在下面实时过滤；折叠成摘要条
				// 时也渲染——可以在摘要条上直接改条件、看头部计数变化。整块阻断冒泡：标题栏的
				// onClick 是折叠开关，点筛选区不能触发它
				filterOpen ? React.createElement("div", { className: "dsdrv-livepanel-filterbar", onClick: (e) => e.stopPropagation() },
					// 第一行：搜索框（右侧 × 清空关键词；placeholder 点明可搜的四个字段）
					React.createElement("div", { className: "dsdrv-livepanel-fb-row" },
						React.createElement("div", { className: "dsdrv-livepanel-fb-search" },
							React.createElement("input", {
								type: "text",
								className: "dsdrv-livepanel-fb-input",
								placeholder: "搜索文件名 / 提问 / 工具 / 状态",
								value: query,
								onChange: (e) => setQuery(e.target.value)
							}),
							query ? React.createElement("button", {
								type: "button",
								className: "dsdrv-livepanel-fb-clear",
								title: "清空关键词",
								onClick: (e) => { e.stopPropagation(); setQuery(""); }
							}, "×") : null)),
					// 第二行：状态 / 来源 / 轮次三组 chip（组内多选 = 或，组间 = 与）。删除与工作区外
					// 不在这里——它们是标题栏那两枚降噪开关，刻意不重复
					React.createElement("div", { className: "dsdrv-livepanel-fb-row dsdrv-livepanel-fb-chips" },
						React.createElement("span", { className: "dsdrv-livepanel-fb-group" }, "状态"),
						LIVE_STATUS_CHIPS.map((c) => filterChip(c[0], c[1], fStatus.indexOf(c[0]) >= 0, () => toggleChip(setFStatus, c[0]), "只看「" + c[1] + "」的文件（可多选，再点取消）")),
						React.createElement("span", { className: "dsdrv-livepanel-fb-sep" }),
						React.createElement("span", { className: "dsdrv-livepanel-fb-group" }, "来源"),
						LIVE_SOURCE_CHIPS.map((c) => filterChip(c[0], c[1], fSource.indexOf(c[0]) >= 0, () => toggleChip(setFSource, c[0]), c[0] === "edit"
							? "只看内置 write / edit 工具改过的文件（可多选，再点取消）"
							: "只看命令跑出来的改动：pwsh / bash / run_code 快照（含未知来源，可多选，再点取消）")),
						turnChipList.length > 0 ? React.createElement("span", { className: "dsdrv-livepanel-fb-sep" }) : null,
						turnChipList.length > 0 ? React.createElement("span", { className: "dsdrv-livepanel-fb-group" }, "轮次") : null,
						turnChipList.map((t) => filterChip("t" + t, "#" + t, fTurns.indexOf(t) >= 0, () => toggleTurn(t), "只看第 " + t + " 轮改过的文件（会自动切到「全部轮次」；再点取消）")))) : null,
				collapsed
					? null
					: React.createElement(React.Fragment, null,
						// 拖拽手柄：展开时出现在标题栏下方，按住上下拖动调整列表高度
						// 拖拽手柄：悬浮在卡片上边框（absolute），按住上下拖动调整高度；
// onClick 阻断冒泡，避免拖拽结束的 click 落到标题栏误触折叠
						React.createElement("div", { className: "dsdrv-livepanel-resize", title: "拖拽调整高度", onMouseDown: onResizeStart, onClick: (e) => { e.preventDefault(); e.stopPropagation(); } }),
						// 筛选区展开时也把列表限高（不是只有长列表才滚）：否则卡片会被两行筛选区
						// 顶得很高，把上方对话挤掉
						React.createElement("div", { className: "dsdrv-livepanel-list" + ((visibleList.length > 5 || filterOpen) && !panelH ? " dsdrv-livepanel-list-scroll" : "") },
						visibleList.length === 0
							? React.createElement("div", { className: "drv-empty" },
								emptyHint,
								// 筛选/搜索生效时给一键清空：条件互斥或无命中时，用户需要一眼看到出口
								filterActive ? React.createElement("button", {
									type: "button",
									className: "dsdrv-livepanel-clear",
									title: "清空关键词与全部 chip（标题栏的范围与降噪开关不受影响）",
									onClick: (e) => { e.stopPropagation(); clearFilters(); }
								}, "清空筛选") : null)
							: visibleList.map((f) => {
							const time = fmtTime(f.lastTime);
							const q = qOf(f);
							// 只有「最新轮次」的文件才用标记色高亮（colors.latestName 随浅色/深色
							// 主题自动切换）；其余轮次保持默认色，不额外着色
							const isLatest = latestList.some((t) => t.path === f.path);
							// 行上显示路径：地址取仓库相对路径 repoPath（无仓库时回退记录
							// 路径），拆成「目录段 + 文件名段」——目录段可收缩、空间不足时
							// 尾部省略，文件名段 flex:none 恒完整显示；悬停提示是完整绝对路径。
							// 点文件名 / 点整行 = 在侧栏打开 diff（默认动作）；行尾「打开文件」
							// 按钮才是在侧栏打开文件本身。
							const displayPath = String(f.repoPath || f.path || "");
							const baseName = displayPath.split(/[\/\\]/).pop() || f.name || "";
							const dirName = displayPath.slice(0, displayPath.length - baseName.length);
							// 删除态：文件已不在磁盘上，只禁用「打开文件」（会报错）；文件名
							// 仍可点（diff 数据来自记录，不依赖磁盘），文件名加删除线
							const deleted = f.status === "deleted";
							return React.createElement("div", { key: f.path, className: "dsdrv-livepanel-file" + (deleted ? " dsdrv-livepanel-file-deleted" : "") },
								React.createElement("button", { type: "button", className: "dsdrv-livepanel-row", title: "在右侧栏查看该文件的 diff", onClick: () => openDiff(f) },
									React.createElement(StatusChip, { status: f.status, colors: colors }),
									React.createElement("span", {
										className: "dsdrv-livepanel-name" + (isLatest ? " dsdrv-livepanel-name-latest" : "") + " drv-openable",
										title: (deleted ? ((f.absPath || f.path) + "（文件已删除）") : (f.absPath || f.path)) + " —— 点击查看 diff",
										style: isLatest ? { color: colors.latestName, fontWeight: 600 } : undefined,
										onClick: (e) => { e.preventDefault(); e.stopPropagation(); openDiff(f); }
									},
										dirName ? React.createElement("span", { className: "dsdrv-livepanel-dir" }, dirName) : null,
										React.createElement("span", { className: "dsdrv-livepanel-base" }, baseName)),
									// 工具标签：该文件由哪些工具改过 —— write/edit 是内置工具，
									// pwsh/bash/run_code 是脚本快照发现的（标签用暖色区分）
									(f.tools && f.tools.length) ? React.createElement("span", { className: "dsdrv-livepanel-tools" },
										f.tools.map((tool) => React.createElement("span", {
											key: tool,
											className: "dsdrv-livepanel-tool" + (SHELL_TOOL_LABELS.indexOf(tool) >= 0 ? " dsdrv-livepanel-tool-shell" : ""),
											title: SHELL_TOOL_LABELS.indexOf(tool) >= 0
												? "由 " + tool + " 脚本修改（内容取自命令前后两次磁盘快照）"
												: "由内置 " + tool + " 工具修改"
										}, tool))) : null,
									// 工作区外标识：绝对路径不在会话工作区内（例如 $DSH_HOME 下的脚本）
									f.outside === true ? React.createElement("span", {
										className: "dsdrv-livepanel-outside",
										title: "该文件在当前会话工作区之外：" + (f.absPath || f.path)
									}, "工作区外") : null,
									// 轮次徽章尽量多显示几轮（最新优先，最多 3 个，紧凑共用「第…轮」）；
									// 更早的轮次以「…」前缀示意，完整历史保留在悬停提示里
									(f.turns && f.turns.length) ? React.createElement("span", {
										className: "dsdrv-livepanel-turn",
										title: "该文件在第 " + f.turns.join("、") + " 轮被修改"
									}, (() => {
										const shown = f.turns.slice(-3);
										const ellipsis = shown.length < f.turns.length ? "…" : "";
										return ellipsis + "第" + shown.join("、") + "轮";
									})()) : null,
									// 行内问题文本：独立标记色（colors.qText 随浅/深主题切换），与文件名蓝色区分。
									// 只在「全部轮次」视图显示——「当前轮次」视图里整份列表都属于同一个问题，
									// 逐行重复用户提问纯属噪声、还挤占文件名与统计的位置（用户要求）。
									(scope !== "latest" && q) ? React.createElement("span", { className: "dsdrv-livepanel-rowq", title: q, style: { color: colors.qText } }, q) : null,
									React.createElement("span", { className: "drv-header-spacer" }),
									React.createElement("span", { className: "dsdrv-livepanel-diff" },
										React.createElement("span", { style: { color: colors.turnAdd } }, "+" + f.added),
										React.createElement("span", { style: { color: colors.turnDel } }, "−" + f.removed)),
									React.createElement("span", { className: "dsdrv-livepanel-time" }, time),
									// 行尾「打开文件」：显式入口，阻断冒泡以免同时触发整行的打开 diff；
									// 删除态只置灰不可点（文件已不存在，打开只会报错）
									React.createElement("span", {
										className: "dsdrv-livepanel-diffbtn" + (deleted ? " dsdrv-livepanel-diffbtn-off" : ""),
										title: deleted ? "文件已从磁盘删除，无法打开" : "在右侧栏打开该文件",
										onClick: (e) => { e.preventDefault(); e.stopPropagation(); if (!deleted) { openFileDefault(f, session); } }
									}, "打开文件")));
						}))))),
					React.createElement(ConfirmPrompt, null));
		}

		function TabLabel() {
			const files = useStore((s) => s.files);
			const colors = useStore((s) => s.colors);
			const count = files ? files.length : 0;
			return React.createElement("span", { className: "drv-tab-label" },
				React.createElement("span", null, "审查"),
				count > 0 ? React.createElement("span", {
					className: "drv-tab-badge",
					style: { background: colors.badgeBg, color: colors.badgeFg }
				}, String(count)) : null);
		}

		function TurnReview({ matched, sessionId, turn: turnLoc, seq, openFile }) {
			const colors = useStore((s) => s.colors);
			const liveSession = useStore((s) => s.currentSession);
			const tick = useStore((s) => s.reviewTick);
			const turnNo = matched && matched.turn;
			// turnTail slot 不会把 sessionId 传进来，回退到共享 store 的当前会话
			const sid = sessionId || liveSession;
			const [data, setData] = React.useState(null);
			const [expanded, setExpanded] = React.useState(null);
			const [busy, setBusy] = React.useState(false);
			const [menu, setMenu] = React.useState(null);
			React.useEffect(() => {
				let alive = true;
				setData(null);
				if (sid && turnNo != null) {
					apiTurn(sid, turnNo).then((v) => {
						if (alive) setData(v);
					}).catch(() => {
						if (alive) setData(null);
					});
				}
				return () => { alive = false; };
			}, [sid, turnNo]);
			// 对话过程中（本回合还没结束）SSE 每次刷新就实时重拉本轮数据：
			// 不清空旧数据，避免闪烁，让“本轮变更审查”在回合进行中就逐条出现
			React.useEffect(() => {
				if (!sid || turnNo == null || tick === 0) return;
				let alive = true;
				apiTurn(sid, turnNo).then((v) => {
					if (alive) setData(v);
				}).catch(() => {
					/* 忽略瞬时失败，等待下一次刷新 */
				});
				return () => { alive = false; };
			}, [sid, turnNo, tick]);
			// This entry wins the turnTail chain, so re-render the shipped
			// "produced files" chips from the deliverables turn data to avoid
			// shadowing that built-in feature.
			const produced = [];
			try {
				const dv = turnLoc && turnLoc.data ? turnLoc.data.get("deliverables") : null;
				if (dv && dv.produced) {
					const seen = new Set();
					for (const item of dv.produced) {
						if (item && typeof item.path === "string" && item.seq <= seq && !seen.has(item.path)) {
							seen.add(item.path);
							produced.push(item.path);
						}
					}
				}
			} catch (e) {}
			const hasFiles = data && data.files && data.files.length > 0;
			if (!hasFiles && produced.length === 0) return null;
			const revertOp = async (filePath, opIndex) => {
				if (!sid || !filePath) return;
				if (!(await askConfirm("确定撤回该项修改？此操作会直接改写磁盘上的文件，且不可撤销。"))) return;
				setBusy(true);
				apiRevert(sid, filePath, opIndex).then((v) => {
					if (v && v.ok) {
						apiTurn(sid, turnNo).then((nv) => { if (nv) setData(nv); }).catch(() => {});
						refreshFromServer();
					} else {
						window.alert("撤回失败：" + ((v && v.error) || "未知错误"));
					}
				}).catch((e) => {
					window.alert("撤回失败：" + String((e && e.message) || e));
				}).finally(() => setBusy(false));
			};
			const showCtx = (e, path, cwd) => {
				e.preventDefault(); e.stopPropagation();
				setMenu({ x: e.clientX, y: e.clientY, items: [
					{ label: "打开文件", run: () => { if (sid) openFileFor(sid, path, cwd); } },
					{ label: "在 Finder 中展示", run: () => { if (sid) revealInFinderFor(sid, path, cwd); } }
				]});
			};
			return React.createElement("div", { className: "drv-turn", style: { background: colors.turnBg, borderColor: colors.turnBorder } },
				React.createElement(CtxMenu, { menu, onClose: () => setMenu(null) }),
				produced.length > 0 ? React.createElement("div", { className: "drv-turn-produced" },
					React.createElement("span", { className: "drv-turn-produced-label" }, "产物"),
					produced.map((path) => React.createElement("button", {
						type: "button",
						key: path,
						className: "drv-turn-produced-chip",
						title: path,
						onClick: () => { if (sid) openFileFor(sid, path, null); },
						onContextMenu: (e) => showCtx(e, path, null)
					}, String(path).split('/').pop()))) : null,
				hasFiles ? React.createElement(React.Fragment, null,
					React.createElement("div", { className: "drv-turn-head" },
						React.createElement("span", { className: "drv-turn-title" }, "本轮变更审查"),
						React.createElement("span", { className: "drv-count" }, data.files.length + " 个文件"),
						React.createElement("span", { className: "drv-header-spacer" }),
						React.createElement("span", { className: "drv-turn-hint" }, "会话累计变更见「审查」标签")),
					data.files.map((f) => {
						const open = expanded === f.path;
						return React.createElement("div", { key: f.path, className: "drv-turn-file" },
							React.createElement("button", {
								type: "button",
								className: "drv-turn-file-head",
								onClick: () => setExpanded(open ? null : f.path),
								onContextMenu: (e) => showCtx(e, f.path, f.cwd)
							},
								React.createElement("span", { className: "drv-turn-file-name" }, f.name),
								React.createElement("span", { className: "drv-file-meta" },
									(f.writes > 0 ? "写入×" + f.writes + " " : "") + (f.edits > 0 ? "编辑×" + f.edits : ""),
									React.createElement("span", { style: { color: colors.turnAdd } }, "  ~+" + f.added),
									React.createElement("span", { style: { color: colors.turnDel } }, "  ~−" + f.removed)),
								React.createElement("span", { className: "drv-header-spacer" }),
								React.createElement("span", { className: "drv-turn-chevron" }, open ? "▾" : "▸")),
							open ? React.createElement("div", { className: "drv-turn-file-body" },
								f.sections.map((sec, i) => React.createElement(Section, {
									key: i, section: sec, lang: langOf(f.path),
									onRevert: (opIndex) => revertOp(f.path, opIndex),
									busy: busy,
									onLineCtx: (e, h) => openLineMenu(e, f.path, h, setMenu, f && f.repoPath)
								}))) : null);
					})) : null,
					React.createElement(ConfirmPrompt, null));
		}

		function ReviewView(props) {
			React.useEffect(() => {
				if (props.sessionId) {
					if (store.currentSession !== props.sessionId) {
						reqSeq++;
						setState({ currentSession: props.sessionId, files: null, selected: null, detail: null, mode: "session", turnData: null, latestTurn: 0, currentTurn: 0, error: null, loadingFiles: true });
					}
					loadSummary();
				}
			}, [props.sessionId]);
			const files = useStore((s) => s.files);
			const mode = useStore((s) => s.mode);
			const turnData = useStore((s) => s.turnData);
			const count = mode === "latest" ? (((turnData && turnData.files) || []).length) : (files ? files.length : 0);
			const [busy, setBusy] = React.useState(false);
			const [notice, setNotice] = React.useState(null);
			const noticeTimer = React.useRef(null);
			const showNotice = (msg) => {
				setNotice(msg);
				if (noticeTimer.current) clearTimeout(noticeTimer.current);
				noticeTimer.current = setTimeout(() => setNotice(null), 4000);
			};
			React.useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);
			const doRevert = async (op) => {
				const session = store.currentSession;
				const path = store.selected;
				if (!session || !path) return;
				const what = op === null ? "该文件的全部修改" : "该项修改";
				if (!(await askConfirm("确定撤回" + what + "？此操作会直接改写磁盘上的文件，且不可撤销。"))) return;
				setBusy(true);
				apiRevert(session, path, op).then((v) => {
					if (v && v.ok) {
						showNotice(v.message || "已撤回");
						if (op === null) setState({ selected: null, detail: null });
						refresh();
					} else {
						window.alert("撤回失败：" + ((v && v.error) || "未知错误"));
					}
				}).catch((e) => {
					window.alert("撤回失败：" + String((e && e.message) || e));
				}).finally(() => setBusy(false));
			};
			const revertOp = (opIndex) => doRevert(opIndex);
			const revertAll = () => doRevert(null);
			return React.createElement("div", { className: "drv-view" },
				React.createElement("div", { className: "drv-view-header" },
					React.createElement("span", { className: "drv-title" }, "实时审查"),
					React.createElement("span", { className: "drv-count" }, (mode === "latest" ? "最新一轮 · " : "") + count + " 个文件"),
					React.createElement("div", { className: "drv-mode", role: "group" },
						React.createElement("button", {
							className: "drv-mode-btn" + (mode === "session" ? " drv-mode-active" : ""),
							onClick: () => setMode("session")
						}, "此会话"),
						React.createElement("button", {
							className: "drv-mode-btn" + (mode === "latest" ? " drv-mode-active" : ""),
							onClick: () => setMode("latest")
						}, "最新一轮")),
					React.createElement("span", { className: "drv-header-spacer" }),
					notice ? React.createElement("span", { className: "drv-notice" }, notice) : null,
					React.createElement("button", { className: "drv-btn", title: "刷新", onClick: refresh }, "↻"),
					React.createElement("button", {
						className: "drv-btn", title: "清空记录",
						onClick: () => { apiClear(store.currentSession).then(() => { setState({ files: [], detail: null, selected: null, turnData: null, latestTurn: 0, currentTurn: 0 }); }); }
					}, "清空")),
				React.createElement("div", { className: "drv-view-body" },
					React.createElement("div", { className: "drv-filelist" }, React.createElement(FileList, { openFile: props.openFile })),
					React.createElement("div", { className: "drv-detail" }, React.createElement(Detail, { onRevert: revertOp, onRevertAll: revertAll, busy: busy }))),
				React.createElement(ConfirmPrompt, null));
		}

		function SettingsPage() {
			return React.createElement("div", { className: "drv-settings-page" },
				React.createElement("p", { className: "drv-settings-desc" },
					"「实时审查」追踪本进程内通过写入 / 编辑工具产生的文件修改：改动列表常驻输入框上方，diff 详情在右侧栏的「文件名 (diff)」标签页中查看。下方可自定义 diff 行与状态徽章所用颜色，改动即时生效并自动保存（刷新页面后保留）。默认颜色随 DSH 外观（浅色 / 深色）自动切换；「恢复默认」恢复到当前外观对应的颜色。"),
				React.createElement(ColorRows, null),
				React.createElement(PresetButtons, null));
		}

		// ── editor picker: choose the default code editor for「打开文件」 ──────
		function EditorIcon({ id, size }) {
			return React.createElement("img", {
				src: "/diff-review/editor-icon/" + encodeURIComponent(id),
				style: { width: size || 16, height: size || 16, verticalAlign: "middle", borderRadius: 3, flexShrink: 0 },
				alt: "",
				onError: (e) => { e.target.style.display = "none"; }
			});
		}
		function EditorPicker(props) {
			const editors = useStore((s) => s.editors);
			const editorLoading = useStore((s) => s.editorLoading);
			const selectedEditor = useStore((s) => s.selectedEditor);
			const [open, setOpen] = React.useState(false);
			const rootRef = React.useRef(null);
			React.useEffect(() => { loadEditors(); }, []);
			React.useEffect(() => {
				if (!open) return;
				const onDoc = (e) => {
					if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
				};
				document.addEventListener("mousedown", onDoc, true);
				document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); }, true);
				return () => {
					document.removeEventListener("mousedown", onDoc, true);
					document.removeEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); }, true);
				};
			}, [open]);
			const detected = (editors || []).filter((e) => e.detected);
			const label = selectedEditor ? "用" + selectedEditor.name + "打开" : "编辑器";
			return React.createElement("div", { className: "drv-editor", ref: rootRef },
				React.createElement("button", {
					type: "button",
					className: "drv-editor-btn",
					title: selectedEditor ? "当前默认编辑器：" + selectedEditor.name + "（点击更换）" : "选择打开文件时使用的代码编辑器",
					onClick: () => setOpen(!open)
				},
					React.createElement("span", { className: "drv-editor-label" },
						editorLoading ? "检测中…" : (selectedEditor ? React.createElement(React.Fragment, null,
							React.createElement(EditorIcon, { id: selectedEditor.id, size: 16 }),
							" " + label) : label)),
					React.createElement("span", { className: "drv-editor-caret" }, open ? "▴" : "▾")),
				open ? React.createElement("div", { className: "drv-editor-menu" },
					detected.length === 0 ? React.createElement("div", { className: "drv-editor-empty" }, "未检测到已安装的代码编辑器") : null,
					React.createElement("button", {
						type: "button",
						className: "drv-editor-opt" + (!selectedEditor ? " drv-editor-opt-active" : ""),
						onClick: () => { selectEditor(null); setOpen(false); }
					}, "系统默认"),
					detected.map((ed) => React.createElement("button", {
						type: "button",
						key: ed.id,
						className: "drv-editor-opt" + (selectedEditor && selectedEditor.id === ed.id ? " drv-editor-opt-active" : ""),
						style: { display: "flex", alignItems: "center", gap: 6 },
						onClick: () => { selectEditor(ed); setOpen(false); }
					},
						React.createElement(EditorIcon, { id: ed.id, size: 16 }),
						React.createElement("span", null, ed.name)))) : null);
		}

		// ── plugin ─────────────────────────────────────────────────────────
		const inject = ["slots", "sessions", "theme", "workspaces"];
		const CSS = `
.drv-view { flex:1 1 0; min-height:0; overflow:hidden; display:flex; flex-direction:column; padding:12px 14px; box-sizing:border-box; font-size:13px; }
.drv-view-header { display:flex; align-items:center; gap:8px; padding:4px 0 10px; border-bottom:1px solid rgba(128,128,128,0.3); }
.drv-title { font-weight:600; }
.drv-count { opacity:0.7; font-size:12px; }
.drv-header-spacer { flex:1; }
.drv-btn { display:inline-flex; align-items:center; justify-content:center; gap:5px; border:none; background:rgba(128,128,128,0.12); color:inherit; cursor:pointer; border-radius:6px; padding:3px 9px; font-size:11.5px; }
/* 纯图标按钮：方形内边距；.drv-btn-on 是选中态（折行开关） */
.drv-iconbtn { padding:3px 6px; }
/* 选中态要压过 .drv-btn:hover（类 + 伪类的优先级更高），所以把 hover 也一起写 */
.drv-btn-on, .drv-btn-on:hover { background:rgba(128,128,128,0.35); }
.drv-btn:hover { background:rgba(128,128,128,0.25); }
.drv-view-body { flex:1; display:flex; min-height:0; margin-top:10px; border:1px solid rgba(128,128,128,0.3); border-radius:8px; overflow:hidden; }
.drv-filelist { width:250px; border-right:1px solid rgba(128,128,128,0.3); overflow:auto; overscroll-behavior:contain; flex-shrink:0; padding:6px 0; }
.drv-file { display:flex; align-items:center; gap:6px; width:100%; padding:6px 10px; cursor:pointer; border:none; background:transparent; color:inherit; text-align:left; font-family:inherit; font-size:12.5px; }
.drv-file:hover { background:rgba(128,128,128,0.12); }
.drv-file.drv-selected { background:rgba(80,120,255,0.18); }
.drv-file-name { font-weight:500; word-break:break-all; }
.drv-file-meta { font-size:11px; opacity:0.75; white-space:nowrap; }
.drv-detail { flex:1; overflow:auto; overscroll-behavior:contain; padding:10px; }
/* 顶部不留圆角：段头是 sticky 的，圆角会在吸顶时露出两个缺口（下面滚过的行从角里透出来），
   所以卡片顶部做成方角、只保留下圆角 */
.drv-section { margin-bottom:12px; border:1px solid rgba(128,128,128,0.35); border-radius:12px; }
/* 最近查看过的那一条：**只用段头淡蓝底**做标记（用户明确说不要左侧强调竖线）。
   只保留最后一条；刷新/切文件/切对比模式即清除（纯组件态）。 */
.drv-section.drv-sec-last .drv-section-head { background-color:color-mix(in srgb, var(--dsw-alias-state-business-primary, #4493f8) 16%, var(--dsw-alias-bg-layer-2, #22272e)); }
/* 折叠态：段头是卡片唯一可见的一层，四个角都要跟卡片圆角一致（11px）。旧写法只圆上面两角，
   实心断头底色会把卡片下面两角的圆弧顶成直角（用户反馈的「圆角有点问题」）。 */
.drv-section.drv-sec-closed .drv-section-head { border-radius:11px; }
/* 吸顶 + 折叠：上面两角本来就贴着滚动区上沿（卡片顶在视野外），下面两角仍要圆 */
.drv-section.drv-sec-stuck.drv-sec-closed .drv-section-head { border-radius:0 0 11px 11px; }
/* 语法高亮：正文默认就按语言着色（One Dark Pro / One Light 同系），增/删只叠背景色。
   只给有颜色的片段上色；语言未识别（plain）时退回普通前景色。 */
.dsdrv-scheme-dark .drv-text { color:#abb2bf; }
.dsdrv-scheme-light .drv-text { color:#383a42; }
.dsdrv-scheme-dark .drv-tok-kw { color:#c678dd; }
.dsdrv-scheme-dark .drv-tok-str { color:#98c379; }
.dsdrv-scheme-dark .drv-tok-num { color:#d19a66; }
.dsdrv-scheme-dark .drv-tok-com { color:#7f848e; font-style:italic; }
.dsdrv-scheme-dark .drv-tok-fn { color:#61afef; }
.dsdrv-scheme-dark .drv-tok-typ { color:#e5c07b; }
.dsdrv-scheme-dark .drv-tok-op { color:#56b6c2; }
.dsdrv-scheme-dark .drv-tok-tag { color:#e06c75; }
.dsdrv-scheme-dark .drv-tok-attr { color:#d19a66; }
.dsdrv-scheme-light .drv-tok-kw { color:#a626a4; }
.dsdrv-scheme-light .drv-tok-str { color:#50a14f; }
.dsdrv-scheme-light .drv-tok-num { color:#986801; }
.dsdrv-scheme-light .drv-tok-com { color:#a0a1a7; font-style:italic; }
.dsdrv-scheme-light .drv-tok-fn { color:#4078f2; }
.dsdrv-scheme-light .drv-tok-typ { color:#c18401; }
.dsdrv-scheme-light .drv-tok-op { color:#0184bc; }
.dsdrv-scheme-light .drv-tok-tag { color:#e45649; }
.dsdrv-scheme-light .drv-tok-attr { color:#986801; }
/* 吸顶（.drv-sec-stuck 由 DiffPane 的 IntersectionObserver 打上）时去掉顶部圆角，
   否则圆角缺口会把下面滚过的行漏出来 */
.drv-section.drv-sec-stuck { border-radius:0 0 12px 12px; }
/* 段头可点折叠；吸顶跟随（top = 面板头高度，由 DiffPane 用 ResizeObserver 写入 CSS 变量）。
   注意不能用 overflow:hidden 裁圆角——那会打破子元素 sticky */
/* 吸顶时下面滚过的行会从半透明底透出来，所以底色必须不透明；
   hover 高亮改用叠加层（不透明的 background-color + background-image 叠加）*/
/* 半透明 + backdrop 模糊：保留「透一点底色」的观感，但下面滚过的**文字**被打糊、不会读出来
   （纯半透明会漏字，纯不透明又太死板——用户要的是这个折中）*/
.drv-section-head { padding:6px 10px; font-weight:600; background:color-mix(in srgb, var(--dsw-alias-bg-layer-2, #22272e) 86%, transparent); -webkit-backdrop-filter:blur(6px); backdrop-filter:blur(6px); display:flex; gap:8px; align-items:center; cursor:pointer; user-select:none; position:sticky; top:0; z-index:5; border-radius:11px 11px 0 0; }
.drv-section.drv-sec-stuck .drv-section-head { border-radius:0; }
.drv-section-head:hover { background-image:linear-gradient(rgba(128,128,128,0.14), rgba(128,128,128,0.14)); }
/* 折叠指示：SVG chevron（原来是 ▸/▾ 字符，观感差）；展开时旋转 90° */
.drv-sec-chevron { flex:none; display:inline-flex; align-items:center; opacity:0.72; transition:transform 0.12s ease; }
.drv-sec-chevron-open { transform:rotate(90deg); }
/* 吸顶哨兵：不占高度、不可见，只给 IntersectionObserver 当靶子 */
.drv-sec-sentinel { height:1px; margin-bottom:-1px; }
/* 撤回按钮 hover 段头才出现，降低视觉噪音 */
.drv-section-head .drv-btn-revert { visibility:hidden; }
.drv-section-head:hover .drv-btn-revert { visibility:visible; }
.drv-section-body { border-radius:0 0 11px 11px; overflow:hidden; }
/* 段头说明文字（「修改对比」等）已随 2026-09-18 改版移除：badge 足以表达 */
/* 段头次级文字（时间/截断提示）：flex:none + nowrap —— 否则在窄栏里中文会逐字换行，
   被挤成一列竖排（实测过：整块卡片被撑高、正文被顶走） */
.drv-section-time { font-weight:400; opacity:0.7; font-size:11px; flex:none; white-space:nowrap; }
/* 段头元信息：轮次 + 时间合成的次级灰字（「第2轮 · 18:48」），不再是胶囊 */
.drv-section-turn { flex:none; font-size:11px; opacity:0.62; white-space:nowrap; font-variant-numeric:tabular-nums; }
/* 问题文本单行省略，但**宽度封顶 38%**：它占满整行会把徽标/元信息/撤回按钮挤到边上
   （用户反馈「标题内容占比过大」）。剩余空白由 .drv-header-spacer 吃掉 */
.drv-section-question { flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11px; opacity:0.72; }
.drv-badge { flex:none; white-space:nowrap; display:inline-block; padding:0 6px; border-radius:8px; font-size:10px; font-weight:600; }
.drv-badge-new { background:rgba(46,160,67,0.22); color:#1a7f37; }
.drv-badge-edit { background:rgba(9,105,218,0.16); color:#0969da; }
/* 左侧 3px 色条：所有行都留位（透明），增删行由下方 .drv-add/.drv-del 着色，保证列对齐 */
.drv-line { display:flex; border-left:3px solid transparent; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:13px; line-height:1.65; }
/* 折叠段：整行可点击展开（点击后客户端带更大 ctx 重取） */
/* 「显示剩余 N 行」：段内渐进渲染的展开按钮（整行宽、居中，别抢正文的视觉重量） */
.drv-more-btn { display:block; width:auto; margin:6px 8px 8px; padding:4px 0; text-align:center; font-size:11.5px; opacity:0.85; }
/* 「没有差异」结论：比普通空态更明确一点（居中、略大） */
.drv-empty-nodiff { padding:20px 12px; font-size:12.5px; opacity:0.75; }
/* 「没有差异」下面那行补充解释（如「内容可能已经提交」） */
.drv-nodiff-hint { margin-top:8px; font-size:11.5px; opacity:0.62; }
/* 单段无差异时的段内说明 */
.drv-sec-nodiff { padding:8px 10px; font-size:12px; opacity:0.6; }
.drv-skip { justify-content:center; cursor:pointer; background:rgba(128,128,128,0.05); color:var(--dsw-alias-label-tertiary, #8b949e); font-size:11px; }
.drv-skip:hover { color:var(--dsw-alias-state-business-primary, #4493f8); }
/* 双列行号 + 符号列：底色 10% / 分隔线 30% 是按「行号区要与正文分得开」调过的，别降回去；
   12px 行号配 13px 正文，窄侧栏下也不抢宽度 */
.drv-gutter { flex:0 0 34px; text-align:right; padding:0 4px; user-select:none; opacity:0.9; font-size:12px; background:rgba(128,128,128,0.10); border-right:1px solid rgba(128,128,128,0.30); }
.drv-gutter-sign { flex:0 0 16px; text-align:center; padding:0 1px; }
/* 折行时续行缩进 2ch（悬挂缩进）：首行顶格、折回来的部分缩进，避免与下一行糊在一起 */
.drv-text { flex:1; padding:0 9px; padding-left:calc(9px + 2ch); text-indent:-2ch; white-space:pre-wrap; word-break:break-word; min-width:0; }
/* 不折行模式（面板头的折行开关）：整行按内容撑宽，由面板横向滚动。
   三个坑：① .drv-section-body 为裁圆角设了 overflow:hidden，不放开的话横向溢出被裁掉、
   永远滚不动；② 行与段必须跟着 width:max-content 撑宽，否则滚到右边行背景与段头只铺到
   可见宽度、右边一片空白；③ 两个吸顶头加 left:0，横向滚动时不会跟着滚出视野。
   ⚠ 2026-09-20 修正：行**不能**各自 width:max-content——短行只有自己的内容宽，横向滚到
   右边时它的改动底色就停在中途（用户原话「改动行的背景色，要完全整行显示」）。改成在行
   外面包 .drv-rows（列向 flex + min-width:max-content），由容器撑到最宽行、所有行跟着拉伸。 */
/* 横滚**下沉到每张段卡片内部**：滚动条出现在正文卡片里（贴着该段最后一行），
   而不是挂在面板/侧栏底部——外层（.dsdrv-pane、.dsdrv-pane-body）永远不会出现横向滚动条。
   overflow-y 只能是 hidden（横滚+纵 visible 不合法，会被算成 auto 而冒出内层纵向滚动条），
   卡片高度本来就是内容高度，所以不会裁到东西。 */
.dsdrv-nowrap .drv-section-body { overflow-x:auto; overflow-y:hidden; }
/* 只撑宽「行」——段不要撑宽：段头 sticky 需要比滚动视口窄才有水平吸附的余量（
   撑成 max-content 后段头与段同宽，横向滚动时头会跟着滚出去） */
/* 行容器撑到最宽的那一行；行作为列向 flex 项自动拉伸到同宽（改动底色因此铺满整行） */
.dsdrv-nowrap .drv-rows { display:flex; flex-direction:column; min-width:max-content; }
.dsdrv-nowrap .drv-text { flex:1 1 auto; padding-left:9px; text-indent:0; white-space:pre; }
/* ── 色弱强化：不看红绿也能分清增删 ────────────────────────────────────
   ① 左侧 3px 色条（取 turnAdd/turnDel）② 增行提亮 / 删行压暗的明度差
   ③ 符号列 ± 加粗着色。明度差用叠加层实现，不动色板色相；
   明暗两套数值分开写，因为浅色下「加白」空间小、得靠压暗删行来拉差。 */
.drv-add, .drv-del { border-left-color:color-mix(in srgb, var(--drv-mark-c) 85%, transparent); }
.dsdrv-scheme-dark .drv-add { background-image:linear-gradient(rgba(255,255,255,0.05), rgba(255,255,255,0.05)); }
.dsdrv-scheme-dark .drv-del { background-image:linear-gradient(rgba(0,0,0,0.28), rgba(0,0,0,0.28)); }
.dsdrv-scheme-light .drv-add { background-image:linear-gradient(rgba(255,255,255,0.30), rgba(255,255,255,0.30)); }
.dsdrv-scheme-light .drv-del { background-image:linear-gradient(rgba(0,0,0,0.14), rgba(0,0,0,0.14)); }
.drv-add .drv-gutter-sign, .drv-del .drv-gutter-sign { font-weight:700; color:color-mix(in srgb, var(--drv-mark-c) 88%, currentColor); }
/* 跳转落点闪烁 */
.drv-flash { animation:drv-flash 0.9s ease-out 1; }
@keyframes drv-flash { 0% { outline:2px solid rgba(80,120,255,0.65); outline-offset:-2px; } 100% { outline:2px solid transparent; } }
.drv-empty { padding:24px; text-align:center; opacity:0.6; }
.drv-settings { border-top:1px solid rgba(128,128,128,0.3); padding:6px 0 0; margin-top:10px; }
.drv-settings-toggle { border:none; background:transparent; color:inherit; cursor:pointer; font-size:12px; padding:4px 0; }
.drv-settings-body { margin-top:6px; }
.drv-color-row { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:3px 0; font-size:12px; }
.drv-color-row input[type=color] { width:38px; height:24px; border:none; border-radius:4px; padding:0; background:transparent; cursor:pointer; }
.drv-color-controls { display:flex; align-items:center; gap:6px; }
.drv-color-controls input[type=range] { width:76px; accent-color:var(--dsw-alias-state-business-primary, #4493f8); }
.drv-color-alpha { font-size:11px; opacity:0.7; min-width:34px; text-align:right; }
.drv-presets { display:flex; gap:6px; margin-top:8px; }
.drv-presets button { border:1px solid rgba(128,128,128,0.4); background:transparent; color:inherit; cursor:pointer; border-radius:6px; padding:3px 8px; font-size:11px; }
.drv-presets button:hover { background:rgba(128,128,128,0.15); }
.drv-settings-page { padding:16px; font-size:13px; }
.drv-settings-desc { opacity:0.7; margin:0 0 14px; line-height:1.6; }
.drv-detail-toolbar { display:flex; align-items:center; gap:8px; margin-bottom:10px; }
.drv-detail-path { font-size:12px; opacity:0.8; word-break:break-all; }
.drv-btn-revert { font-size:11px; padding:2px 8px; }
.drv-btn-danger { color:#cf222e; }
.drv-notice { font-size:12px; color:#1a7f37; background:rgba(46,160,67,0.15); border-radius:6px; padding:3px 8px; }
/* 对比模式切换：分段控件（外框包住三枚按钮，选中项填充，贴近预览页） */
.drv-mode { display:flex; gap:2px; border:1px solid rgba(128,128,128,0.4); border-radius:7px; padding:2px; }
.drv-mode-btn { display:inline-flex; align-items:center; justify-content:center; border:none; background:transparent; color:inherit; cursor:pointer; border-radius:5px; padding:3px 7px; font-size:11.5px; opacity:0.7; }
.drv-mode-btn:hover { opacity:1; }
.drv-mode-btn.drv-mode-active { background:rgba(128,128,128,0.28); opacity:1; font-weight:500; }
.drv-against-note { font-size:12px; opacity:0.75; margin-bottom:8px; margin-top:2px; padding:4px 8px; background:rgba(128,128,128,0.1); border-radius:6px; }
.drv-turn { border:1px solid rgba(128,128,128,0.3); border-radius:8px; padding:6px 10px; font-size:12px; }
.drv-turn-produced { display:flex; align-items:center; gap:6px; flex-wrap:wrap; padding:0 0 6px; }
.drv-turn-produced-label { font-size:11px; opacity:0.7; }
.drv-turn-produced-chip { border:1px solid rgba(128,128,128,0.35); background:transparent; color:inherit; cursor:pointer; border-radius:10px; padding:1px 8px; font-size:11px; font-family:inherit; }
.drv-turn-produced-chip:hover { background:rgba(128,128,128,0.12); }
.drv-turn-head { display:flex; align-items:center; gap:8px; padding:2px 0 6px; }
.drv-turn-title { font-weight:600; }
.drv-turn-hint { font-size:11px; opacity:0.6; }
.drv-turn-file { border-top:1px solid rgba(128,128,128,0.15); }
.drv-turn-file-head { display:flex; align-items:center; gap:8px; width:100%; padding:5px 0; border:none; background:transparent; color:inherit; cursor:pointer; font-family:inherit; font-size:12px; text-align:left; }
.drv-turn-file-name { font-weight:500; word-break:break-all; }
/* 宽度/居中照抄官方「任务」面板 TodoPanel 根节点（ui-conversation 的
   TodoPanel.module.css）：同一 conversation.input.dock 插槽内保持同宽。
   桌面端 --dsh-composer-side-clearance=16px、--dsh-composer-dock-inset=8px，
   即宽度 100%-64px、上限 card-max-32px。 */
.dsdrv-livepanel { box-sizing:border-box; width:calc(100% - var(--dsh-composer-side-clearance,16px) - var(--dsh-composer-side-clearance,16px) - var(--dsh-composer-dock-inset,8px) - var(--dsh-composer-dock-inset,8px) - var(--dsh-composer-dock-inset,8px) - var(--dsh-composer-dock-inset,8px)); max-width:calc(var(--dsh-composer-card-max-width,780px) - var(--dsh-composer-dock-inset,8px) - var(--dsh-composer-dock-inset,8px) - var(--dsh-composer-dock-inset,8px) - var(--dsh-composer-dock-inset,8px)); margin:0 auto; }
.dsdrv-livepanel-card { box-sizing:border-box; position:relative; width:100%; max-width:calc(var(--dsh-composer-card-max-width,780px) - var(--dsh-composer-dock-inset,8px) - var(--dsh-composer-dock-inset,8px) - var(--dsh-composer-dock-inset,8px) - var(--dsh-composer-dock-inset,8px)); margin:0 auto; border:1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.3)); background:var(--dsw-alias-bg-layer-2, #22272e); border-radius:12px; max-height:min(70vh, 600px); display:flex; flex-direction:column; overflow:hidden; }
/* 标题栏：min-height + flex-wrap —— 窄面板（带「已删除/工作区外」时按钮有 6 枚）里
   固定 height:36px 会把尾部控件直接裁掉（2026-09-21 无头截图实测：卡片 336px 宽时
   「已删除/工作区外/筛选/折叠」四枚全部消失，连新的筛选入口都点不到）；改成可换行后
   窄宽度下按钮折到第二行，正常宽度下单行 36px 完全不变 */
.dsdrv-livepanel-head { box-sizing:border-box; width:100%; display:flex; align-items:center; gap:10px; min-height:36px; height:auto; flex-wrap:wrap; padding:4px 6px 4px 12px; background:var(--dsw-specific-tip, transparent); flex:none; cursor:pointer; user-select:none; }
.dsdrv-livepanel-head-open { border-bottom:1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.2)); }
/* 拖拽手柄：悬浮在卡片上边框的窄条（像拖窗口边缘一样调整高度），hover 顶边高亮 */
.dsdrv-livepanel-resize { position:absolute; top:0; left:0; right:0; height:6px; cursor:row-resize; z-index:3; user-select:none; touch-action:none; }
.dsdrv-livepanel-resize::before { content:''; position:absolute; left:0; right:0; top:0; height:2px; background:transparent; transition:background .15s; }
.dsdrv-livepanel-resize:hover::before { background:var(--dsw-alias-state-business-primary, #4493f8); }
.dsdrv-livepanel-icon { flex:none; display:inline-flex; color:var(--dsw-alias-label-tertiary, #8b949e); }
.dsdrv-livepanel-title { flex:none; font-size:13px; font-weight:500; }
/* flex-basis:0（不是 auto）是关键：标题栏现在允许换行，若摘要按内容宽度参与换行计算，
   正常宽度下也会被挤到第二行；basis=0 让它先吸收剩余空间（照旧单行省略），只有固定控件
   本身就放不下时才换行。摘要渲染时不再同时渲染 .drv-header-spacer（两者 flex-grow 都是 1，
   会各吃一半剩余宽度 → 文件名提前截断、右侧留空位），于是剩余宽度全给摘要 */
.dsdrv-livepanel-summary { flex:1 1 0; min-width:40px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11px; opacity:0.82; }
.dsdrv-livepanel-count { flex:none; opacity:0.6; font-size:11px; }
.dsdrv-livepanel-filter { flex:none; font-size:11px; padding:2px 8px; opacity:0.75; }
.dsdrv-livepanel-filter:hover { opacity:1; }
.dsdrv-livepanel-filter-on { opacity:1; background:rgba(128,128,128,0.28); }
.dsdrv-livepanel-filter-icon { display:inline-flex; align-items:center; justify-content:center; gap:3px; padding:3px 7px; }
.dsdrv-livepanel-filter-n { font-size:10px; line-height:1; opacity:0.85; }
/* 行内「工作区外」徽章：不在会话工作区内的路径 */
.dsdrv-livepanel-outside { flex:none; font-size:10px; line-height:15px; padding:0 5px; border-radius:8px; border:1px solid rgba(128,128,128,0.4); opacity:0.7; white-space:nowrap; }
/* 行内工具标签：内置 write/edit 用中性底，脚本类（快照发现）用暖色底区分 */
.dsdrv-livepanel-tools { flex:none; display:inline-flex; gap:3px; }
.dsdrv-livepanel-tool { font-size:9.5px; line-height:14px; padding:0 4px; border-radius:6px; background:rgba(128,128,128,0.16); opacity:0.9; white-space:nowrap; }
.dsdrv-livepanel-tool-shell { background:rgba(255,169,77,0.2); }
.dsdrv-livepanel-last { flex:none; font-size:12px; opacity:0.85; max-width:240px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:default; }
.dsdrv-livepanel-collapse { width:28px; height:28px; flex:none; border:none; background:transparent; color:var(--dsw-alias-label-tertiary, #8b949e); cursor:pointer; border-radius:999px; padding:0; display:inline-flex; align-items:center; justify-content:center; }
.dsdrv-livepanel-collapse:hover { background:transparent; color:var(--dsw-alias-label-primary, inherit); }
.dsdrv-livepanel-list { box-sizing:border-box; width:100%; padding:4px 10px 4px 4px; flex:1 1 auto; min-height:0; overflow-y:auto; overscroll-behavior:contain; }
/* 超过 5 个文件时限制可见高度为 5 行，出现滚动条 */
.dsdrv-livepanel-list-scroll { max-height:156px; overflow-y:auto; overscroll-behavior:contain; }
.dsdrv-livepanel-file { border:1px solid rgba(128,128,128,0.3); border-radius:8px; margin-bottom:4px; overflow:hidden; }
.dsdrv-livepanel-row { display:flex; align-items:center; gap:8px; width:100%; padding:4px 8px; border:none; background:transparent; color:inherit; cursor:pointer; font-family:inherit; font-size:11.5px; text-align:left; overflow:hidden; }
.dsdrv-livepanel-row:hover { background:rgba(128,128,128,0.12); }
/* 审查列表行的地址单元：目录段可收缩省略、文件名段恒完整显示 */
.dsdrv-livepanel-name { flex:0 1 auto; min-width:0; display:inline-flex; align-items:baseline; white-space:nowrap; font-weight:500; overflow:hidden; }
.dsdrv-livepanel-dir { flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; opacity:0.62; }
.dsdrv-livepanel-base { flex:none; white-space:nowrap; }
.dsdrv-openable { cursor:pointer; }
.dsdrv-openable:hover { text-decoration:underline; }
.drv-path-link { text-decoration:underline; cursor:pointer; }
.drv-path-link:hover { color:var(--dsw-alias-state-business-primary, #4493f8); }
/* 文件状态胶囊（新增/修改/删除）：文字与边框用同一个 currentColor，
   颜色由内联 style 按状态给出（新增 turnAdd / 修改 latestName / 删除 turnDel） */
.dsdrv-status { flex:none; font-size:10px; line-height:15px; padding:0 5px; border-radius:8px; border:1px solid currentColor; white-space:nowrap; opacity:0.9; }
/* 删除态：文件名加删除线，弱化显示 */
.dsdrv-livepanel-file-deleted .dsdrv-livepanel-base { text-decoration:line-through; opacity:0.75; }
.dsdrv-livepanel-turn { flex:none; font-size:10px; opacity:0.75; border:1px solid rgba(128,128,128,0.35); border-radius:8px; padding:0 5px; line-height:15px; white-space:nowrap; }
.dsdrv-livepanel-diff { font-size:11px; white-space:nowrap; }
.dsdrv-livepanel-time { font-size:11px; opacity:0.7; white-space:nowrap; }
.dsdrv-livepanel-rowq { flex:0 1 200px; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:10.5px; }
.dsdrv-livepanel-collapsed { box-sizing:border-box; width:100%; padding:2px 6px 6px; max-height:140px; overflow-y:auto; overscroll-behavior:contain; border-top:1px solid rgba(128,128,128,0.15); }
.dsdrv-livepanel-crow { display:flex; align-items:center; gap:6px; padding:2px 4px; font-size:11.5px; line-height:18px; cursor:pointer; border-radius:6px; }
.dsdrv-livepanel-crow:hover { background:rgba(128,128,128,0.12); }
.dsdrv-livepanel-cname { flex:none; max-width:44%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500; }
.dsdrv-livepanel-cq { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; opacity:0.72; font-size:11px; }
.dsdrv-livepanel-detail { padding:6px 8px; border-top:1px solid rgba(128,128,128,0.2); max-height:min(440px, calc(58vh - 60px)); overflow-y:auto; }
/* ── 侧栏「审查 diff」tab 正文（原先的全屏最大化窗口已移除）──────────────
   面板内自带滚动：父级若给固定高度就内部滚动，否则随内容撑高。 */
/* 面板 = 固定头 + 唯一滚动正文（.dsdrv-pane-body）：头与工具行不参与滚动，
   不折行模式的横向滚动只作用在正文区（用户明确要求「横滚别加到整个面板上」） */
/* min-width:0 / max-width:100% 是关键：宿主把面板当 flex/grid 项时，min-width:auto 会让
   不折行模式的长行把面板顶得比容器还宽，横向滚动便落到宿主那一层——标题行于是跟着滚。
   钳住宽度后，溢出只可能发生在 .dsdrv-pane-body 内部。 */
.dsdrv-pane { box-sizing:border-box; display:flex; flex-direction:column; width:100%; max-width:100%; min-width:0; height:100%; min-height:0; overflow:hidden; padding:0 12px; }
.dsdrv-pane-head { background:var(--dsw-alias-bg-base, #1c2128); padding:10px 0; box-sizing:border-box; border-bottom:1px solid rgba(128,128,128,0.3); margin-bottom:12px; }
/* 唯一滚动容器：纵向 + 横向都归它，底部 24px 作为滚动余量 */
.dsdrv-pane-body { flex:1 1 auto; min-height:0; overflow-y:auto; overflow-x:hidden; overscroll-behavior:contain; padding-right:6px; padding-bottom:24px; }
/* 两行之间留出呼吸空间（文件名行 ↔ 工具按钮行）；底部再多留一点，
   避免第一段 diff 紧贴按钮 */
.dsdrv-pane-row { margin-bottom:10px; min-width:0; flex-wrap:wrap; row-gap:6px; }
.dsdrv-pane-row:last-child { margin-bottom:0; }
/* 第二行按钮区：窄栏时允许换行，避免按钮被裁切 */
.dsdrv-pane-actions { flex-wrap:wrap; row-gap:6px; }
/* 第一行的路径：单行省略（悬停看完整绝对路径），不参与换行 */
.dsdrv-pane-path { flex:0 1 auto; min-width:6em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
/* 改动间跳转导航：sticky 跟随滚动、悬浮在面板底部右侧（≥2 处改动才出现） */
.dsdrv-jumpnav { position:sticky; bottom:10px; z-index:6; margin-left:auto; margin-right:6px; width:max-content; display:flex; align-items:center; gap:2px; padding:2px 4px; background:var(--dsw-alias-surface-2, #22272e); border:1px solid rgba(128,128,128,0.45); border-radius:999px; box-shadow:0 4px 14px rgba(0,0,0,0.35); font-size:11px; }
.dsdrv-jumpnav button { border:none; background:transparent; color:inherit; cursor:pointer; width:24px; height:24px; border-radius:999px; font-size:13px; line-height:1; padding:0; }
.dsdrv-jumpnav button:hover { background:rgba(128,128,128,0.2); }
.dsdrv-jumpnav-n { min-width:36px; text-align:center; opacity:0.8; }
/* 侧栏 diff tab 的 chip：图标 + 标题。宿主 chip 只画 title 文本，图标由
   sidebar.right.pane.tab.title 席位补；改成自定义元素后宿主的文本省略不再
   生效，故这里自带单行省略。 */
.dsdrv-tabtitle { display:inline-flex; align-items:center; gap:5px; min-width:0; max-width:100%; }
.dsdrv-tabicon { flex:none; display:inline-flex; align-items:center; }
.dsdrv-tablabel { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
/* 列表行尾的「查看 diff」入口（点击由整行 button 承接，仅作可见提示） */
.dsdrv-livepanel-diffbtn { flex:none; font-size:10.5px; opacity:0.85; border:1px solid rgba(128,128,128,0.4); border-radius:8px; padding:0 6px; line-height:16px; white-space:nowrap; cursor:pointer; }
.dsdrv-livepanel-diffbtn:hover { background:rgba(128,128,128,0.12); }
/* 删除态：文件已不在磁盘上，「打开文件」置灰不可点 */
.dsdrv-livepanel-diffbtn-off { opacity:0.4; cursor:default; }
.dsdrv-livepanel-diffbtn-off:hover { background:transparent; }
/* ── 审查列表的快捷筛选 / 搜索（2026-09-21） ─────────────────────────────────── */
/* 漏斗按钮上的生效条件数角标（关键词算 1 + 每枚选中 chip 各算 1） */
.dsdrv-livepanel-filter-badge { font-size:9.5px; line-height:12px; min-width:12px; padding:0 3px; border-radius:6px; font-weight:600; background:var(--dsw-alias-state-business-primary, #4493f8); color:#fff; }
/* 筛选区：标题栏下方就地展开（即「二级页面」），两行——搜索框 + 三组 chip */
.dsdrv-livepanel-filterbar { box-sizing:border-box; width:100%; padding:6px 10px 6px 4px; border-bottom:1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.2)); display:flex; flex-direction:column; gap:6px; }
.dsdrv-livepanel-fb-row { display:flex; align-items:center; gap:6px; min-width:0; }
.dsdrv-livepanel-fb-search { position:relative; flex:1 1 auto; min-width:0; display:flex; align-items:center; }
.dsdrv-livepanel-fb-input { box-sizing:border-box; width:100%; height:26px; padding:0 26px 0 8px; font-family:inherit; font-size:12px; color:inherit; background:rgba(128,128,128,0.12); border:1px solid rgba(128,128,128,0.3); border-radius:7px; outline:none; }
.dsdrv-livepanel-fb-input:focus { border-color:var(--dsw-alias-state-business-primary, #4493f8); }
.dsdrv-livepanel-fb-input::placeholder { color:var(--dsw-alias-label-tertiary, #8b949e); }
.dsdrv-livepanel-fb-clear { position:absolute; right:4px; width:18px; height:18px; padding:0; border:none; border-radius:50%; background:transparent; color:var(--dsw-alias-label-tertiary, #8b949e); font-size:13px; line-height:1; cursor:pointer; }
.dsdrv-livepanel-fb-clear:hover { background:rgba(128,128,128,0.2); color:inherit; }
/* 三组 chip 排一行，放不下时整行横滚（窄面板里这是唯一不挤坏的排法） */
.dsdrv-livepanel-fb-chips { overflow-x:auto; overflow-y:hidden; padding-bottom:2px; }
.dsdrv-livepanel-fb-group { flex:none; font-size:10.5px; opacity:0.6; }
.dsdrv-livepanel-fb-sep { flex:none; width:1px; height:14px; margin:0 3px; background:rgba(128,128,128,0.35); }
.dsdrv-livepanel-fb-chip { flex:none; font-size:11px; padding:2px 8px; opacity:0.75; }
.dsdrv-livepanel-fb-chip:hover { opacity:1; }
.dsdrv-livepanel-fb-chip-on { opacity:1; background:rgba(128,128,128,0.28); }
/* 空态里的「清空筛选」：只在关键词/chip 生效时出现 */
.dsdrv-livepanel-clear { margin-left:8px; padding:2px 8px; font-size:11px; color:inherit; background:transparent; border:1px solid rgba(128,128,128,0.4); border-radius:7px; cursor:pointer; }
.dsdrv-livepanel-clear:hover { background:rgba(128,128,128,0.12); }
.dsdrv-modal-mask { position:fixed; inset:0; z-index:40000; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.45); }
.dsdrv-modal { min-width:280px; max-width:420px; padding:16px; border:1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.4)); border-radius:12px; background:var(--dsw-alias-surface-2, #22272e); box-shadow:0 10px 30px rgba(0,0,0,0.4); }
.dsdrv-modal-text { font-size:13px; line-height:1.6; margin-bottom:14px; }
.dsdrv-modal-btns { display:flex; justify-content:flex-end; gap:8px; }
.dsdrv-modal-btns .drv-btn { padding:5px 14px; }
.drv-turn-chevron { opacity:0.6; }
.drv-turn-file-body { padding:2px 0 8px; }
.drv-turn-file-body .drv-section { margin-bottom:8px; }
.drv-tab-label { display:inline-flex; align-items:center; gap:6px; }
.drv-tab-badge { display:inline-block; border-radius:8px; padding:0 5px; font-size:10px; line-height:14px; font-weight:600; min-width:16px; text-align:center; }
.dsdrv-ctx { position:fixed; z-index:70000; min-width:150px; padding:4px; border:1px solid rgba(128,128,128,0.45); border-radius:8px; background:var(--dsw-alias-surface-2, #22272e); box-shadow:0 6px 18px rgba(0,0,0,0.35); }
.dsdrv-ctx-item { display:block; width:100%; border:none; background:transparent; color:inherit; text-align:left; padding:6px 10px; border-radius:6px; font-size:12px; font-family:inherit; cursor:pointer; }
.dsdrv-ctx-item:hover { background:rgba(80,120,255,0.28); }
.drv-editor { position:relative; display:inline-flex; }
.drv-editor-btn { display:inline-flex; align-items:center; gap:4px; height:32px; padding:0 10px; border:1px solid rgba(128,128,128,0.35); background:transparent; color:inherit; cursor:pointer; border-radius:18px; font-size:12px; font-family:inherit; }
.drv-editor-btn:hover { background:rgba(128,128,128,0.14); }
.drv-editor-label { max-width:110px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.drv-editor-caret { opacity:0.7; font-size:10px; flex:none; }
.drv-editor-menu { position:absolute; top:calc(100% + 4px); right:0; z-index:20000; min-width:170px; padding:4px; border:1px solid rgba(128,128,128,0.45); border-radius:8px; background:var(--dsw-alias-surface-2, #22272e); box-shadow:0 6px 18px rgba(0,0,0,0.35); max-height:260px; overflow:auto; }
.drv-editor-opt { display:block; width:100%; border:none; background:transparent; color:inherit; text-align:left; padding:6px 10px; border-radius:6px; font-size:12px; font-family:inherit; cursor:pointer; white-space:nowrap; }
.drv-editor-opt:hover { background:rgba(128,128,128,0.16); }
.drv-editor-opt.drv-editor-opt-active { background:rgba(80,120,255,0.28); }
.drv-editor-empty { padding:6px 10px; font-size:12px; opacity:0.6; }
`;
		function apply(ctx) {
			ctxRef = ctx;
			// ── 让 diff 颜色随 DSH 外观（浅色/深色）自动切换 ──────────────
			const themeApi = ctx && ctx.theme;
			const getScheme = () => {
				try {
					const snap = themeApi && themeApi.getTheme ? themeApi.getTheme() : null;
					if (snap && snap.active && snap.active.colorScheme) return snap.active.colorScheme;
				} catch (e) {}
				// DOM 兜底：桌面壳把深色标记写在 body 上
				if (document.body && document.body.hasAttribute("data-ds-dark-theme")) return "dark";
				if (document.documentElement && document.documentElement.style.colorScheme === "dark") return "dark";
				return "light";
			};
			// 初始化：没有持久化的自定义色时，默认按当前外观取对应的一套色板，
			// 避免深色外观下仍用浅色色板而出现“白色方块”。
			store.scheme = getScheme();
			if (!hasSavedColors) setColorsQuiet(Object.assign({}, paletteFor(store.scheme)));
			// 监听外观变化，随外观强制切换到对应色板
			if (typeof ctx.on === "function") {
				ctx.effect(() => {
					const off = ctx.on("theme/change", (snapshot) => {
						let s;
						try { s = snapshot && snapshot.active && snapshot.active.colorScheme; } catch (e) {}
						if (!s) s = getScheme();
						if (s && s !== store.scheme) {
							store.scheme = s;
							setColorsQuiet(Object.assign({}, paletteFor(s)));
						}
					});
					return () => { if (off) off(); };
				}, "diff-review: theme follow");
			}
			ctx.effect(() => {
				const el = document.createElement("style");
				el.textContent = CSS;
				document.head.appendChild(el);
				return () => el.remove();
			}, "diff-review: styles");
			loadEditors();
			refreshFromServer();
			ctx.effect(connectEvents, "diff-review: live events");
			// 轮询兜底：即使 SSE 偶发断连/未建立，也能近实时地把修改文件刷上界面
			ctx.effect(() => {
				const timer = setInterval(() => {
					if (store.currentSession) refreshFromServer();
				}, 2500);
				return () => clearInterval(timer);
			}, "diff-review: live poll");
			// 「审查」视图标签已禁用（不再注册 conversation.view 槽位）；
			// 变更追踪与实时变更面板（LivePanel）等功能不受影响。
			// 「本轮变更审查」卡片已移除（不再注册 conversation.chat.turnTail 槽位）。
			// 「编辑器」选择器（会话头部右上角）已禁用：不再注入本槽位，
			// 打开文件改走系统默认方式；需要恢复时取消下面三行注释。
			// ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register(
			// 	{ name: "conversation.session.header.utilities", id: "diff-review-editor", order: -1 },
			// 	(props) => React.createElement(EditorPicker, props)));
			ctx.slots.inject("conversation.input.dock", () => ctx.slots.register(
				{ name: "conversation.input.dock", id: "diff-review-live", order: 20, inject: (sessionId) => ({ sessionId }) },
				(props) => React.createElement(LivePanel, props)));
			ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register(
				{ name: "conversation.session.header.actions", id: "diff-review-session", order: 100 },
				(props) => React.createElement(SessionProbe, props)));
			ctx.slots.inject("settings.section", () => ctx.slots.register(
				{ name: "settings.section", id: "diff-review", order: 25, label: "实时审查" },
				(props) => React.createElement(SettingsPage, props)));
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register(
				{ name: "sidebar.footer.action", id: "diff-review" },
				() => null));
			// ── 右侧栏「审查 diff」tab 类型 + 正文 ────────────────────────────
			// 第三方插件注册侧栏 tab 的官方路径（与官方 ui-sidebar-documentpreview /
			// ui-sidebar-files 同一条）：sidebarRightTabs.register 声明一个**资源
			// 类型**（靠 patterns 认领我们自己的 dsh-resource://diff-review/** 地址，
			// 地址即去重键 contentId），正文注册到 sidebar.right.pane.tab 席位、
			// key 用类型 id；框架会把 tabInfo 钩子按 useTabInfo 注入正文 props。
			// 服务用 ctx.inject 等它到齐（可重入）而不是在 apply 里 ctx.get 一把：
			// 席位声明可能早于 sidebarRightTabs 出现，一次性读会永久注册不上。
			// 也不写进插件级 inject——避免该服务缺失时整个插件被挂起。
			try {
				const registerDiffType = (injected) => {
					let tabs = null;
					try {
						tabs = (injected && typeof injected.get === "function") ? injected.get("sidebarRightTabs") : null;
					} catch (e) { tabs = null; }
					if (!tabs && ctxRef) { try { tabs = ctxRef.get("sidebarRightTabs"); } catch (e) { tabs = null; } }
					if (!tabs || typeof tabs.register !== "function") return;
					try {
						tabs.register({
							id: DIFF_TAB_ID,
							kind: DIFF_TAB_KIND,
							patterns: [DIFF_ADDRESS_PREFIX + "**"],
							priority: "extension",
							canOpen: (address) => !!diffTargetOfAddress(address),
							title: (address) => diffTabTitle(address)
						});
					} catch (e) {
						console.warn("[diff-review] 侧栏 diff tab 类型注册失败", e);
					}
				};
				if (typeof ctx.inject === "function") { ctx.inject(["sidebarRightTabs"], registerDiffType); }
				else { registerDiffType(null); }
			} catch (e) {
				console.warn("[diff-review] 侧栏 diff tab 类型注册异常（功能降级为在侧栏打开文件）", e);
			}
			ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
				name: "sidebar.right.pane.tab",
				key: DIFF_TAB_ID,
				inject: (sessionId) => ({ sessionId })
			}, DiffPane)), "diff-review: sidebar diff tab body");
			// chip 标题：宿主 tab 定义只带 title 文本（没有 icon 字段），图标由这个
			// 席位补——席位内容就是 chip 内容。键同样是类型 id。
			ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab.title", () => ctx.slots.register({
				name: "sidebar.right.pane.tab.title",
				key: DIFF_TAB_ID
			}, DiffTabTitle)), "diff-review: sidebar diff tab title");
		}

		exports.inject = inject;
		exports.apply = apply;
		return module.exports;
	}
});