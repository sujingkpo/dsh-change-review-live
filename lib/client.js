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
		// 面板拖拽/自适应高度的持久化键：刷新或重启后恢复上次生效的面板高度
		const PANEL_H_LS_KEY = "dsh.diff-review.panelHeight";
		// 面板展开/折叠状态（按会话记忆）：**只由用户点击写入**。放在组件外是因为
		// 面板会在新轮次/会话重建时被 React 重新挂载，组件内 state 会被重置回默认值
		// 而表现为「自动折叠」——已经打开的面板必须保持打开。Host 端另有一份持久化
		// （见 LivePanel 的 setCollapsed），两者一起保证跨重挂载、跨刷新都不折叠。
		const livePanelCollapsed = {};
		const LIGHT = { addBg: "#e6ffec", addFg: "#1a7f37", delBg: "#ffebe9", delFg: "#cf222e", ctxBg: "#f6f8fa", gutter: "#57606a", badgeBg: "#0969da", badgeFg: "#ffffff", turnAdd: "#1a7f37", turnDel: "#cf222e", turnBg: "rgba(255, 183, 77, 0.1)", turnBorder: "#ffb74d", latestName: "#0969da", qText: "#8250df" };
		const DARK = { addBg: "#10251c", addFg: "#7ee787", delBg: "#2d1415", delFg: "#ffa198", ctxBg: "#161b22", gutter: "#8b949e", badgeBg: "#4493f8", badgeFg: "#0d1117", turnAdd: "#7ee787", turnDel: "#ffa198", turnBg: "rgba(255, 183, 77, 0.1)", turnBorder: "#ffb74d", latestName: "#4493f8", qText: "#d2a8ff" };
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
			if (savedColors) { store.colors = savedColors; hasSavedColors = true; }
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
		function apiFile(session, path) { return fetch("/diff-review/file?session=" + encodeURIComponent(session) + "&path=" + encodeURIComponent(path)).then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }); }
		function apiAgainst(session, path, mode) { return fetch("/diff-review/against?session=" + encodeURIComponent(session) + "&path=" + encodeURIComponent(path) + "&mode=" + encodeURIComponent(mode)).then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }); }
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
			return [f.path, f.status, f.lastTime, f.ops, f.added, f.removed, (f.turns || []).join(","), f.repoPath].join("|");
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

		// ── diff line rendering ────────────────────────────────────────────
		function Line({ h, onCtx }) {
			const colors = useStore((s) => s.colors);
			// 折叠省略行：全文件 diff 中被压缩的无变化上下文段
			if (h.type === "skip") {
				return React.createElement("div", { className: "drv-line drv-skip" },
					React.createElement("span", { className: "drv-text" }, "⋯ 省略 " + h.count + " 行（无修改）"));
			}
			let bg;
			let fg;
			let cls;
			if (h.type === "add") { bg = colors.addBg; fg = colors.addFg; cls = "drv-add"; }
			else if (h.type === "del") { bg = colors.delBg; fg = colors.delFg; cls = "drv-del"; }
			else { bg = colors.ctxBg; cls = "drv-ctx-line"; }
			return React.createElement("div", { className: "drv-line " + cls, style: { background: bg, color: fg }, "data-fn-line": lineNumOf(h) == null ? "" : String(lineNumOf(h)), onContextMenu: onCtx ? (e) => onCtx(e, h) : undefined },
				React.createElement("span", { className: "drv-gutter", style: { color: colors.gutter } }, h.a != null ? String(h.a) : ""),
				React.createElement("span", { className: "drv-gutter drv-gutter-sign", style: { color: colors.gutter } }, h.type === "add" ? "+" : h.type === "del" ? "−" : " "),
				React.createElement("span", { className: "drv-gutter", style: { color: colors.gutter } }, h.b != null ? String(h.b) : ""),
				React.createElement("span", { className: "drv-text" }, h.text));
		}

		function Section({ section, onRevert, busy, onLineCtx }) {
			const kindLabel = section.kind === "edit" ? "编辑" : "写入";
			const cls = section.kind === "edit" ? "drv-badge-edit" : "drv-badge-new";
			return React.createElement("div", { className: "drv-section" },
				React.createElement("div", { className: "drv-section-head" },
					React.createElement("span", { className: "drv-badge " + cls }, kindLabel),
					React.createElement("span", { className: "drv-section-label" }, section.kind === "edit" ? "修改对比" : "文件内容（完整写入）"),
					React.createElement("span", { className: "drv-section-time" }, fmtTime(section.at)),
					section.question ? React.createElement("span", { className: "drv-section-question", title: section.question }, section.question) : null,
					section.turn > 0 ? React.createElement("span", { className: "drv-section-turn" }, "第" + section.turn + "轮") : null,
					section.truncated ? React.createElement("span", { className: "drv-section-time" }, "（内容过长已截断）") : null,
					React.createElement("span", { className: "drv-header-spacer" }),
					section.canUndo ? React.createElement("button", {
						className: "drv-btn drv-btn-revert",
						title: "撤回该项修改：文件恢复到该项修改之前的内容，其后无冲突的修改保留",
						disabled: busy,
						onClick: () => onRevert(section.opIndex)
					}, "撤回此项") : null),
				React.createElement("div", { className: "drv-section-body" },
					section.hunks.map((h, i) => React.createElement(Line, { key: i, h, onCtx: onLineCtx ? (e) => onLineCtx(e, h) : null }))));
		}

		const COLOR_ROWS = [
			["addBg", "新增行背景"], ["addFg", "新增行文字"],
			["delBg", "删除行背景"], ["delFg", "删除行文字"],
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
				detail.sections.map((sec, i) => React.createElement(Section, { key: i, section: sec, onRevert: onRevert, busy: busy, onLineCtx: (e, h) => openLineMenu(e, detail.path, h, setMenu) })),
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
		const DIFF_VIEWS = [["ops", "会话记录"], ["initial", "初始版本"], ["git", "Git 版本"]];
		// 脚本类工具：改动由「命令前后快照做差」发现，与内置 write/edit 区分显示
		const SHELL_TOOL_LABELS = ["pwsh", "bash", "run_code"];
		function DiffPane(props) {
			const colors = useStore((s) => s.colors);
			const tick = useStore((s) => s.reviewTick);
			// 框架按席位声明 inject.hooks.tabInfo 注入 tabInfo 钩子（props.useTabInfo）
			const info = (typeof props.useTabInfo === "function") ? props.useTabInfo() : null;
			const tab = info && info.tab;
			const target = diffTargetOfAddress(tab && tab.contentId);
			const session = target ? target.sessionId : "";
			const rawPath = target ? target.path : "";
			const [view, setView] = React.useState("ops");
			const [data, setData] = React.useState(null);
			const [busy, setBusy] = React.useState(false);
			// 手动「刷新」时的忙碌标记（自动刷新不显示，避免每 15s 闪一下）
			const [refreshing, setRefreshing] = React.useState(false);
			const [menu, setMenu] = React.useState(null);
			// 拉取当前对比模式的数据（会话修改记录 / 会话最初版本 / Git HEAD 版本）；
			// showBusy=true 只在用户点「刷新」时传，用于按钮文案反馈
			const load = React.useCallback((showBusy) => {
				if (!session || !rawPath) return;
				if (showBusy) { setRefreshing(true); }
				const p = view === "ops" ? apiFile(session, rawPath) : apiAgainst(session, rawPath, view);
				p.then((v) => setData(v))
					.catch((e) => setData({ error: "加载失败：" + String((e && e.message) || e) }))
					.then(() => { if (showBusy) { setRefreshing(false); } });
			}, [session, rawPath, view]);
			React.useEffect(() => { setData(null); load(); }, [load]);
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
			if (!session || !rawPath) {
				return React.createElement("div", { className: "drv-empty" }, "无法解析该 tab 的文件地址");
			}
			const sections = (data && data.sections) || [];
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
			return React.createElement("div", { className: "dsdrv-pane" },
				// 顶部固定两行：第一行只放状态 + 路径（路径可收缩省略），
				// 第二行放操作按钮（复制路径 / 打开文件 / 对比模式 / 撤回全部）
				React.createElement("div", { className: "dsdrv-pane-head" },
					React.createElement("div", { className: "drv-detail-toolbar dsdrv-pane-row" },
						React.createElement(StatusChip, { status: data && data.status, colors: colors }),
						React.createElement("span", { className: "drv-detail-path dsdrv-pane-path", title: (data && data.absPath) || rawPath }, display)),
					React.createElement("div", { className: "drv-detail-toolbar dsdrv-pane-row dsdrv-pane-actions" },
						React.createElement("button", { className: "drv-btn", title: "复制仓库地址（相对仓库根，无仓库时复制完整路径）", onClick: () => copyText(display) }, "复制路径"),
						React.createElement("button", { className: "drv-btn", title: "在侧栏打开该文件的当前内容", onClick: () => openFileDefault({ path: rawPath, cwd: data && data.cwd, absPath: data && data.absPath }, session) }, "打开文件"),
						// 手动刷新：会话记录模式本就会随改动（SSE）自动刷新，
						// 但「初始版本 / Git 版本」对比不自动刷新，靠这颗按钮重取
						React.createElement("button", {
							className: "drv-btn",
							title: "立即重新拉取（会话记录模式会随改动自动刷新；初始版本 / Git 版本对比需手动刷新）",
							disabled: refreshing,
							onClick: () => load(true)
						}, refreshing ? "刷新中…" : "刷新"),
						React.createElement("span", { className: "drv-header-spacer" }),
						React.createElement("div", { className: "drv-mode", role: "group" },
							DIFF_VIEWS.map(([m, label]) => React.createElement("button", {
								key: m,
								className: "drv-mode-btn" + (view === m ? " drv-mode-active" : ""),
								onClick: () => setView(m)
							}, label))),
						view === "ops" ? React.createElement("button", { className: "drv-btn drv-btn-revert drv-btn-danger", disabled: busy || !revertible, onClick: () => doRevert(null) }, "撤回全部") : null)),
				!data
					? React.createElement("div", { className: "drv-empty" }, "加载中…")
					: data.error
						? React.createElement("div", { className: "drv-empty" }, data.error)
						: (sections.length > 0
							? React.createElement("div", null,
								data.baseLabel ? React.createElement("div", { className: "drv-against-note" }, data.baseLabel) : null,
								sections.map((sec, i) => (sec && Array.isArray(sec.hunks))
									? React.createElement(Section, {
										key: i,
										section: sec,
										busy: busy,
										onRevert: (view === "ops" && revertible) ? (opIndex) => doRevert(opIndex) : undefined,
										onLineCtx: (e, h) => openLineMenu(e, (data && data.path) || rawPath, h, setMenu, data && data.repoPath)
									})
									: null))
							: React.createElement("div", { className: "drv-empty" }, "该文件没有可展示的修改")),
				React.createElement(CtxMenu, { menu, onClose: () => setMenu(null) }));
		}


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
			// 置空重拉，不再沿用上一轮的旧列表（旧实现逐轮回退到「最近有改动的轮次」，
			// 于是新一轮开始后列表一直显示上一轮的内容）。旧记录没有轮次信息（currentTurn
			// 与 latestTurn 皆为 0）时列表为空，范围自动按「全部」处理。
			const [latestFiles, setLatestFiles] = React.useState(null);
			React.useEffect(() => {
				// 轮次/会话一变先把列表置空（显示「加载当前轮次…」），避免新一轮开始时短暂
				// 继续显示上一轮的旧列表
				setLatestFiles(null);
				if (!session || !scopeTurn) { return; }
				let alive = true;
				(async () => {
					try {
						const v = await apiTurn(session, scopeTurn);
						if (!alive) { return; }
						setLatestFiles((v && v.files) || []);
					} catch (e) {
						if (alive) { setLatestFiles([]); }
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
			// 范围按钮上的数量 = 该范围里「默认会列出多少」：**不含**删除态与工作区外
			// （这两类默认被降噪开关藏起来，计进去会与实际列出的条数对不上）；无轮次
			// 信息时「最新」实际走全量，数字也跟着走
			const latestCount = (scopeTurn > 0 ? latestList : allList).filter((f) => f.status !== "deleted" && f.outside !== true).length;
			const allCount = allList.filter((f) => f.status !== "deleted" && f.outside !== true).length;
			// 列表 = 范围筛选结果（默认已藏起删除态/工作区外）＋ 开关打开时从「全量」补
			// 进来的该类文件。开关刻意**不受范围约束**：否则当前轮次里没有这类文件时，
			// 按钮点了毫无变化（2026-09-17 被反馈成「点击没反应」）。
			const baseList = scopeList.filter((f) => f.status !== "deleted" && f.outside !== true);
			const extraList = (showDeleted || showOutside)
				? allList.filter((f) => (showDeleted && f.status === "deleted") || (showOutside && f.outside === true))
				: [];
			// 合并去重（同一文件可能同时命中两个开关），再按最近修改时间倒序
			const seenPaths = new Set();
			const visibleList = [];
			for (const f of baseList.concat(extraList)) {
				const pathKey = String(f.path);
				if (seenPaths.has(pathKey)) continue;
				seenPaths.add(pathKey);
				visibleList.push(f);
			}
			visibleList.sort((a, b) => (b.lastTime || 0) - (a.lastTime || 0));
			// 空列表提示：区分「还在加载」「这一轮确实没有」「范围全取消且没开降噪」
			// 「这类文件被开关藏起来了」四种情况
			const emptyHint = (latestLoading && scope === "latest")
				? "加载当前轮次…"
				: (scope === "latest" && latestList.length === 0 && !showDeleted && !showOutside)
					? "本轮暂无变更"
					: (scope === "none" && !showDeleted && !showOutside)
						? "未选择范围：点上方图标选「最新轮次」或「全部轮次」，或打开「已删除 / 工作区外」只看该类文件"
						: "当前范围的文件都被降噪开关藏起来了（点上方图标可查看）";
			// 标题行摘要数据 = **当前列表里实际列出的文件**（visibleList）：范围或降噪开关一变，
			// 摘要立刻跟着变——最新轮次 = 本轮文件、全部轮次 = 全量改动、只查看模式 = 该类文件
			// （旧实现恒取 latestList（当前轮次），于是「全部轮次」与「只查看删除」下摘要与列表对不上）
			const titleList = visibleList;
			// 该轮问题：sections 已倒序，sections[0] 即该文件该轮最近一次修改
			const qOf = (f) => (f && f.sections && f.sections.length > 0 && f.sections[0].question) || '';
			// 摘要前缀 = 当前视图标签：范围（最近变动 / 全部轮次）与已打开的降噪开关（已删除 /
			// 工作区外）组合；范围全取消（none）时前缀只由开关决定，两个都开则为「已删除 / 工作区外」
			const scopeLabel = scope === "all" ? "全部轮次" : (scope === "latest" ? "最近变动" : "");
			const noiseLabel = [showDeleted ? "已删除" : "", showOutside ? "工作区外" : ""].filter((x) => x).join(" / ");
			const sumLabel = scope === "none" ? (noiseLabel || "未选择范围") : (noiseLabel ? scopeLabel + " + " + noiseLabel : scopeLabel);
			// 摘要正文：文件最多显示 2 个（以「 | 」连接，超长部分由 CSS 单行省略（.dsdrv-livepanel-summary
			// 的 ellipsis）隐藏尾部、悬停显示全文）；问题只出现一次——取列表顺序（按修改时间倒序）
			// 里第一个带问题的文件的 sections[0].question；删除态/工作区外文件也是有记录的改动，
			// 同样可能带问题——全都没问题时就只显示前缀 + 文件名
			const sumNames = titleList.slice(0, 2).map((f) => String(f.path || "").split(/[\/\\]/).pop() || f.name || "").join(" | ");
			const sumQ = titleList.map(qOf).find((x) => x) || "";
			const summaryText = sumLabel + " - " + sumNames + (sumQ ? "：" + sumQ : "");
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
			return React.createElement(React.Fragment, null,
				React.createElement("div", { className: "dsdrv-livepanel" },
				React.createElement("div", { ref: cardRef, className: "dsdrv-livepanel-card", style: (!collapsed && panelH) ? { height: panelH + "px", maxHeight: "none" } : undefined },
				React.createElement("div", { className: "dsdrv-livepanel-head" + (collapsed ? "" : " dsdrv-livepanel-head-open"), title: collapsed ? "展开审查列表" : "折叠审查列表", onClick: () => setCollapsed(!collapsed) },
					React.createElement("span", { className: "dsdrv-livepanel-icon" },
						React.createElement("svg", { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" },
							React.createElement("circle", { cx: 12, cy: 12, r: 9 }),
							React.createElement("path", { d: "M12 6.5v5.5l3.5 2" }))),
					React.createElement("span", { className: "dsdrv-livepanel-title" }, "审查列表"),
					React.createElement("span", { className: "dsdrv-livepanel-count" }, visibleList.length + " 个文件"),
					// 摘要拆分 span：前缀 + 文件名取当前视图标签（随范围/降噪开关变化），
					// 问题段用独立标记色（colors.qText）与文件名/前缀区分
					titleList.length > 0 ? React.createElement("span", { className: "dsdrv-livepanel-summary", title: summaryText },
						sumLabel + " - " + sumNames + (sumQ ? "：" : ""),
						sumQ ? React.createElement("span", { style: { color: colors.qText } }, sumQ) : null) : null,
					React.createElement("span", { className: "drv-header-spacer" }),
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
						title: showDeleted
							? (scope === "none" ? "取消「已删除」筛选（当前列表只显示删除态 / 工作区外）" : "隐藏已删除的文件（diff 记录仍保留）")
							: "显示已删除的 " + deletedCount + " 个文件（含其它轮次）",
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
						title: showOutside
							? (scope === "none" ? "取消「工作区外」筛选（当前列表只显示删除态 / 工作区外）" : "隐藏工作区外的文件")
							: "显示出工作区外的 " + outsideCount + " 个文件（含其它轮次）",
						"aria-label": "显示或隐藏工作区外的文件",
						onClick: (e) => { e.stopPropagation(); setShowOutside(!showOutside); }
					},
						React.createElement("svg", { width: 12, height: 12, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" },
							React.createElement("path", { d: "M14 4h6v6" }),
							React.createElement("path", { d: "M20 4l-8 8" }),
							React.createElement("path", { d: "M18 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" })),
						React.createElement("span", { className: "dsdrv-livepanel-filter-n" }, outsideBadge)) : null,
					React.createElement("button", { type: "button", className: "dsdrv-livepanel-collapse", title: collapsed ? "展开" : "折叠", onClick: (e) => { e.stopPropagation(); setCollapsed(!collapsed); } },
						React.createElement("svg", { width: 13, height: 13, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round" },
							collapsed ? React.createElement("polyline", { points: "18 15 12 9 6 15" }) : React.createElement("polyline", { points: "6 9 12 15 18 9" })))),
				collapsed
					? null
					: React.createElement(React.Fragment, null,
						// 拖拽手柄：展开时出现在标题栏下方，按住上下拖动调整列表高度
						// 拖拽手柄：悬浮在卡片上边框（absolute），按住上下拖动调整高度；
// onClick 阻断冒泡，避免拖拽结束的 click 落到标题栏误触折叠
						React.createElement("div", { className: "dsdrv-livepanel-resize", title: "拖拽调整高度", onMouseDown: onResizeStart, onClick: (e) => { e.preventDefault(); e.stopPropagation(); } }),
						React.createElement("div", { className: "dsdrv-livepanel-list" + (visibleList.length > 5 && !panelH ? " dsdrv-livepanel-list-scroll" : "") },
						visibleList.length === 0
							? React.createElement("div", { className: "drv-empty" }, emptyHint)
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
									// 行内问题文本：独立标记色（colors.qText 随浅/深主题切换），与文件名蓝色区分
									q ? React.createElement("span", { className: "dsdrv-livepanel-rowq", title: q, style: { color: colors.qText } }, q) : null,
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
									key: i, section: sec,
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
.drv-btn { border:none; background:rgba(128,128,128,0.12); color:inherit; cursor:pointer; border-radius:6px; padding:4px 8px; font-size:12px; }
.drv-btn:hover { background:rgba(128,128,128,0.25); }
.drv-view-body { flex:1; display:flex; min-height:0; margin-top:10px; border:1px solid rgba(128,128,128,0.3); border-radius:8px; overflow:hidden; }
.drv-filelist { width:250px; border-right:1px solid rgba(128,128,128,0.3); overflow:auto; overscroll-behavior:contain; flex-shrink:0; padding:6px 0; }
.drv-file { display:flex; align-items:center; gap:6px; width:100%; padding:6px 10px; cursor:pointer; border:none; background:transparent; color:inherit; text-align:left; font-family:inherit; font-size:12.5px; }
.drv-file:hover { background:rgba(128,128,128,0.12); }
.drv-file.drv-selected { background:rgba(80,120,255,0.18); }
.drv-file-name { font-weight:500; word-break:break-all; }
.drv-file-meta { font-size:11px; opacity:0.75; white-space:nowrap; }
.drv-detail { flex:1; overflow:auto; overscroll-behavior:contain; padding:10px; }
.drv-section { margin-bottom:12px; border:1px solid rgba(128,128,128,0.35); border-radius:6px; overflow:hidden; }
.drv-section-head { padding:6px 10px; font-weight:600; background:rgba(128,128,128,0.1); display:flex; gap:8px; align-items:center; }
/* 段落头部说明文字（「修改对比」/「文件内容（完整写入）」）：比头部默认字号小一号 */
.drv-section-label { font-size:12px; }
.drv-section-time { font-weight:400; opacity:0.7; font-size:11px; }
.drv-section-turn { flex:none; font-size:11px; opacity:0.8; border:1px solid rgba(128,128,128,0.35); border-radius:8px; padding:0 6px; line-height:16px; white-space:nowrap; }
.drv-section-question { flex:none; max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11px; opacity:0.72; }
.drv-badge { display:inline-block; padding:0 6px; border-radius:8px; font-size:10px; font-weight:600; }
.drv-badge-new { background:rgba(46,160,67,0.22); color:#1a7f37; }
.drv-badge-edit { background:rgba(9,105,218,0.16); color:#0969da; }
.drv-line { display:flex; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:12px; line-height:1.55; }
.drv-skip { justify-content:center; background:transparent; color:var(--dsw-alias-label-tertiary, #8b949e); font-size:11px; opacity:0.75; }
.drv-gutter { flex:0 0 42px; text-align:right; padding:0 6px; user-select:none; opacity:0.9; }
.drv-gutter-sign { flex:0 0 18px; text-align:center; padding:0 2px; }
.drv-text { flex:1; padding:0 6px; white-space:pre-wrap; word-break:break-word; }
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
.drv-mode { display:flex; gap:4px; }
.drv-mode-btn { border:1px solid rgba(128,128,128,0.4); background:transparent; color:inherit; cursor:pointer; border-radius:6px; padding:2px 8px; font-size:11px; }
.drv-mode-btn:hover { background:rgba(128,128,128,0.12); }
.drv-mode-btn.drv-mode-active { background:rgba(80,120,255,0.25); border-color:rgba(80,120,255,0.6); }
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
.dsdrv-livepanel-head { box-sizing:border-box; width:100%; display:flex; align-items:center; gap:10px; height:36px; padding:0 6px 0 12px; background:var(--dsw-specific-tip, transparent); flex:none; cursor:pointer; user-select:none; }
.dsdrv-livepanel-head-open { border-bottom:1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.2)); }
/* 拖拽手柄：悬浮在卡片上边框的窄条（像拖窗口边缘一样调整高度），hover 顶边高亮 */
.dsdrv-livepanel-resize { position:absolute; top:0; left:0; right:0; height:6px; cursor:row-resize; z-index:3; user-select:none; touch-action:none; }
.dsdrv-livepanel-resize::before { content:''; position:absolute; left:0; right:0; top:0; height:2px; background:transparent; transition:background .15s; }
.dsdrv-livepanel-resize:hover::before { background:var(--dsw-alias-state-business-primary, #4493f8); }
.dsdrv-livepanel-icon { flex:none; display:inline-flex; color:var(--dsw-alias-label-tertiary, #8b949e); }
.dsdrv-livepanel-title { flex:none; font-size:13px; font-weight:500; }
.dsdrv-livepanel-summary { flex:1 1 auto; min-width:40px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11px; opacity:0.82; }
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
.dsdrv-livepanel-list { box-sizing:border-box; width:100%; padding:4px; flex:1 1 auto; min-height:0; overflow-y:auto; overscroll-behavior:contain; }
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
.dsdrv-pane { box-sizing:border-box; height:100%; min-height:0; overflow-y:auto; overscroll-behavior:contain; padding:0 12px 24px; }
.dsdrv-pane-head { position:sticky; top:0; z-index:2; background:var(--dsw-alias-bg-base, #1c2128); padding:10px 0 12px; box-sizing:border-box; }
/* 两行之间留出呼吸空间（文件名行 ↔ 工具按钮行）；底部再多留一点，
   避免第一段 diff 紧贴按钮 */
.dsdrv-pane-row { margin-bottom:10px; min-width:0; }
.dsdrv-pane-row:last-child { margin-bottom:0; }
/* 第二行按钮区：窄栏时允许换行，避免按钮被裁切 */
.dsdrv-pane-actions { flex-wrap:wrap; row-gap:6px; }
/* 第一行的路径：单行省略（悬停看完整绝对路径），不参与换行 */
.dsdrv-pane-path { flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
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