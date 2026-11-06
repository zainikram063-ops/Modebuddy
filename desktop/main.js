const {
  app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain, screen,
  desktopCapturer, systemPreferences, clipboard, session,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const SITE = process.env.MB_URL || require("./config.json").url;
const ORIGIN = new URL(SITE).origin;
const OFFLINE = "data:text/html;charset=utf-8," + encodeURIComponent(
  `<body style="font:15px -apple-system;display:grid;place-items:center;height:100vh;margin:0;color:#444"><div style="text-align:center"><h2>You are offline</h2><p>ModeBuddy needs the internet.</p><p><a href="${SITE}">Try again</a></p></div></body>`
);

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

let win = null;
let tray = null;
let panel = null;
let panelLoadedAt = 0;
let pending = null;
let quitting = false;
const DOT = {};

// ---------- settings ----------
const SETTINGS = path.join(app.getPath("userData"), "settings.json");
let settings = { live: false };
try { settings = { ...settings, ...JSON.parse(fs.readFileSync(SETTINGS, "utf8")) }; } catch {}
function saveSettings() {
  try { fs.mkdirSync(path.dirname(SETTINGS), { recursive: true }); fs.writeFileSync(SETTINGS, JSON.stringify(settings)); } catch {}
}

const isOurs = (u) => { try { return new URL(u).origin === ORIGIN; } catch { return false; } };

// ---------- app lifecycle ----------
if (!app.requestSingleInstanceLock()) app.exit(0);

app.on("second-instance", () => show());
app.on("open-url", (e, link) => { e.preventDefault(); handleLink(link); });
app.on("before-quit", () => { quitting = true; stopHook(); stopSpeaking(); });
app.on("activate", () => show());
app.on("window-all-closed", () => {});

app.whenReady().then(() => {
  if (!app.isDefaultProtocolClient("modebuddy")) app.setAsDefaultProtocolClient("modebuddy");
  session.defaultSession.setPermissionRequestHandler((wc, _perm, cb) => cb(isOurs(wc.getURL())));
  session.defaultSession.setPermissionCheckHandler((wc) => !!wc && isOurs(wc.getURL()));
  createWindow();
  createTray();
  if (settings.live) startLiveMode();
});

function show() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function openLiveSettings() {
  if (!win) return;
  win.loadURL(ORIGIN + "/live");
  show();
}

// modebuddy://auth?to=...&code=...  finishes Google sign-in inside the app
function handleLink(link) {
  try {
    const u = new URL(link);
    if (u.host !== "auth") return;
    const to = new URL(u.searchParams.get("to") || ORIGIN + "/auth/callback");
    if (to.origin !== ORIGIN) return;
    u.searchParams.forEach((v, k) => { if (k !== "to") to.searchParams.set(k, v); });
    if (win) { win.loadURL(to.toString()); show(); } else pending = to.toString();
  } catch {}
}

// Keep ModeBuddy inside the app, open everything else in the normal browser
function guard(e, url) {
  if (e.isMainFrame === false) return;
  let u;
  try { u = new URL(url || e.url); } catch { return; }
  if (u.origin === ORIGIN || u.protocol === "data:") return;
  if (u.hostname.endsWith(".supabase.co") && u.pathname.includes("/auth/v1/authorize")) {
    e.preventDefault();
    const back = u.searchParams.get("redirect_to") || ORIGIN + "/auth/callback";
    u.searchParams.set("redirect_to", ORIGIN + "/auth/desktop?to=" + encodeURIComponent(back));
    shell.openExternal(u.toString());
    return;
  }
  if (u.hostname.endsWith(".supabase.co")) return;
  e.preventDefault();
  if (/^(https?|mailto):$/.test(u.protocol)) shell.openExternal(u.toString());
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 420, minHeight: 520, show: false, title: "ModeBuddy",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true },
  });
  const wc = win.webContents;
  wc.setUserAgent(wc.getUserAgent() + " ModeBuddyDesktop/" + app.getVersion());
  wc.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  wc.on("will-navigate", guard);
  wc.on("will-redirect", guard);
  wc.on("did-fail-load", (_e, code, _d, _u, isMain) => { if (isMain && code !== -3) win.loadURL(OFFLINE); });
  win.once("ready-to-show", () => win.show());
  win.on("close", (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
  win.loadURL(pending || SITE);
  pending = null;
}

// ---------- green dot ----------
function dot(r, g, b, rad) {
  const S = 36, c = S / 2, buf = Buffer.alloc(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const a = Math.max(0, Math.min(1, rad + 0.5 - Math.hypot(x + 0.5 - c, y + 0.5 - c)));
    const i = (y * S + x) * 4;
    buf[i] = b * a; buf[i + 1] = g * a; buf[i + 2] = r * a; buf[i + 3] = 255 * a;
  }
  return nativeImage.createFromBitmap(buf, { width: S, height: S, scaleFactor: 2 });
}

function createTray() {
  DOT.on = dot(34, 197, 94, 8.5);
  DOT.small = dot(34, 197, 94, 5.5);
  tray = new Tray(DOT.on);
  tray.setToolTip("ModeBuddy");
  buildTrayMenu();
}

function buildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open ModeBuddy", click: show },
    { type: "separator" },
    { label: "Live mode", type: "checkbox", checked: !!settings.live, click: (item) => { setLive(item.checked); if (item.checked && !liveReady()) openLiveSettings(); } },
    { label: "Hold ⌘ ⌥ anywhere to talk", enabled: false, visible: !!settings.live },
    { label: "Live settings…", click: openLiveSettings },
    { type: "separator" },
    { label: "Open at Login", type: "checkbox", checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }) },
    { type: "separator" },
    { label: "Quit ModeBuddy", click: () => app.quit() },
  ]));
}

let pulseTimer = null;
function pulse(on) {
  clearInterval(pulseTimer);
  pulseTimer = null;
  if (!tray) return;
  tray.setImage(DOT.on);
  if (!on) return;
  let small = false;
  pulseTimer = setInterval(() => { small = !small; tray.setImage(small ? DOT.small : DOT.on); }, 380);
}

// ---------- Live: settings + permissions ----------
function liveState() {
  return {
    enabled: !!settings.live,
    hookOn: !!hook,
    perms: {
      mic: systemPreferences.getMediaAccessStatus("microphone"),
      screen: systemPreferences.getMediaAccessStatus("screen"),
      access: systemPreferences.isTrustedAccessibilityClient(false),
    },
  };
}

function liveReady() {
  const s = liveState();
  return s.hookOn && s.perms.mic === "granted" && s.perms.screen === "granted";
}

async function requestPerm(kind) {
  if (kind === "mic") await systemPreferences.askForMediaAccess("microphone");
  if (kind === "screen") {
    await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 1, height: 1 } }).catch(() => {});
    shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture");
  }
  if (kind === "access") {
    systemPreferences.isTrustedAccessibilityClient(true);
    shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility");
  }
  if (settings.live) startHook();
  return liveState();
}

function setLive(on) {
  settings.live = !!on;
  saveSettings();
  if (settings.live) startLiveMode(); else stopLiveMode();
  buildTrayMenu();
  return liveState();
}

function startLiveMode() { ensurePanel(); startHook(); }
function stopLiveMode() { stopHook(); hidePanel(); }

// ---------- Live: the island window ----------
const PW = 600, PH = 640;

function ensurePanel() {
  if (panel && !panel.isDestroyed()) return panel;
  panel = new BrowserWindow({
    width: PW, height: PH, show: false, frame: false, transparent: true, backgroundColor: "#00000000",
    resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, hasShadow: false, focusable: false, type: "panel",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  panel.setAlwaysOnTop(true, "screen-saver");
  panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  panel.setContentProtection(true);
  panel.setIgnoreMouseEvents(true, { forward: true });
  panel.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: "deny" }; });
  panel.webContents.on("will-navigate", (e, url) => { if (!isOurs(url)) { e.preventDefault(); shell.openExternal(url); } });
  panel.on("closed", () => { panel = null; });
  panel.loadURL(ORIGIN + "/live/panel");
  panelLoadedAt = Date.now();
  return panel;
}

function showPanel(display) {
  const p = ensurePanel();
  const wa = display.workArea;
  p.setBounds({ x: Math.round(wa.x + (wa.width - PW) / 2), y: wa.y + 4, width: PW, height: PH });
  p.setIgnoreMouseEvents(true, { forward: true });
  p.showInactive();
}

function hidePanel() {
  stopSpeaking();
  if (!panel || panel.isDestroyed()) return;
  panel.setIgnoreMouseEvents(true, { forward: true });
  panel.hide();
  panel.webContents.send("live", { type: "hide" });
  if (Date.now() - panelLoadedAt > 30 * 60 * 1000) { panel.webContents.reload(); panelLoadedAt = Date.now(); }
}

// ---------- Live: hold Command + Option ----------
let hook = null;
let meta = false, alt = false, dirty = false, listening = false;
let holdTimer = null, watchdog = null, shot = null;

function startHook() {
  if (hook) return true;
  if (!systemPreferences.isTrustedAccessibilityClient(false)) return false;
  try {
    const { uIOhook, UiohookKey: K } = require("uiohook-napi");
    const isMeta = (k) => k === K.Meta || k === K.MetaRight;
    const isAlt = (k) => k === K.Alt || k === K.AltRight;
    uIOhook.on("keydown", (e) => {
      const k = e.keycode;
      if (isMeta(k) || isAlt(k)) {
        if (!meta && !alt) dirty = false;
        if (isMeta(k)) meta = true; else alt = true;
        if (meta && alt && !dirty && !holdTimer && !listening) holdTimer = setTimeout(beginListen, 280);
        return;
      }
      if (k === K.Escape && panel && !panel.isDestroyed() && panel.isVisible()) hidePanel();
      meta = !!e.metaKey;
      alt = !!e.altKey;
      if (meta || alt) {
        dirty = true;
        clearTimeout(holdTimer);
        holdTimer = null;
        if (listening) cancelListen();
      }
    });
    uIOhook.on("keyup", (e) => {
      const k = e.keycode;
      if (!isMeta(k) && !isAlt(k)) return;
      if (isMeta(k)) meta = false; else alt = false;
      clearTimeout(holdTimer);
      holdTimer = null;
      if (listening) endListen();
    });
    uIOhook.start();
    hook = uIOhook;
    return true;
  } catch (err) {
    console.error("Live shortcut failed to start:", err);
    return false;
  }
}

function stopHook() {
  if (!hook) return;
  try { hook.removeAllListeners(); hook.stop(); } catch {}
  hook = null;
  meta = alt = false;
}

function beginListen() {
  holdTimer = null;
  if (!meta || !alt || dirty || listening || !settings.live) return;
  listening = true;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  stopSpeaking();
  showPanel(display);
  panel.webContents.send("live", { type: "start" });
  shot = capture(display);
  pulse(true);
  clearTimeout(watchdog);
  watchdog = setTimeout(() => { if (listening) endListen(); }, 60000);
}

async function endListen() {
  if (!listening) return;
  listening = false;
  clearTimeout(watchdog);
  pulse(false);
  const image = await shot;
  if (panel && !panel.isDestroyed()) panel.webContents.send("live", { type: "stop", image });
}

function cancelListen() {
  if (!listening) return;
  listening = false;
  clearTimeout(watchdog);
  pulse(false);
  if (panel && !panel.isDestroyed()) panel.webContents.send("live", { type: "cancel" });
}

async function capture(display) {
  try {
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 1600, height: 1600 } });
    const src = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
    return src && !src.thumbnail.isEmpty() ? src.thumbnail.toJPEG(72).toString("base64") : null;
  } catch {
    return null;
  }
}

// ---------- Live: voice + insert ----------
let sayProc = null;
function speak(text) {
  stopSpeaking();
  const t = String(text || "").trim().slice(0, 800);
  if (!t) return;
  const p = spawn("say", ["-r", "195"]);
  sayProc = p;
  p.on("error", () => {});
  p.on("exit", () => {
    if (sayProc === p) sayProc = null;
    if (panel && !panel.isDestroyed()) panel.webContents.send("live", { type: "spoke" });
  });
  p.stdin.end(t);
}

function stopSpeaking() {
  if (sayProc) { try { sayProc.kill(); } catch {} sayProc = null; }
}

function paste() {
  try {
    const { uIOhook, UiohookKey: K } = require("uiohook-napi");
    uIOhook.keyTap(K.V, [K.Meta]);
  } catch {
    spawn("osascript", ["-e", 'tell application "System Events" to keystroke "v" using command down']);
  }
}

// ---------- messages from the website ----------
const fromUs = (e) => isOurs((e.senderFrame && e.senderFrame.url) || "");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

ipcMain.handle("live:get", (e) => (fromUs(e) ? liveState() : null));
ipcMain.handle("live:set", (e, on) => (fromUs(e) ? setLive(on) : null));
ipcMain.handle("live:request", (e, kind) => (fromUs(e) ? requestPerm(kind) : null));
ipcMain.handle("live:hide", (e) => { if (fromUs(e)) hidePanel(); });
ipcMain.handle("live:interactive", (e, on) => { if (fromUs(e) && panel && !panel.isDestroyed()) panel.setIgnoreMouseEvents(!on, { forward: true }); });
ipcMain.handle("live:insert", async (e, text) => { if (!fromUs(e)) return; clipboard.writeText(String(text || "")); hidePanel(); await wait(180); paste(); });
ipcMain.handle("live:copy", (e, text) => { if (fromUs(e)) clipboard.writeText(String(text || "")); });
ipcMain.handle("live:speak", (e, text) => { if (fromUs(e)) speak(text); });
ipcMain.handle("live:stopSpeaking", (e) => { if (fromUs(e)) stopSpeaking(); });
ipcMain.handle("live:open", (e) => { if (fromUs(e)) openLiveSettings(); });
ipcMain.handle("app:restart", (e) => { if (fromUs(e)) { app.relaunch(); app.exit(0); } });
