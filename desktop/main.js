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

function beginListen() { mbSpeechSend("start");
  holdTimer = null;
  if (!meta || !alt || dirty || listening || !settings.live) return;
  listening = true;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  stopSpeaking();
  showPanel(display);
  panel.webContents.send("live", { type: "start" });
  shot = capture(display);
  pointStart(display);
  sendContext();
  pulse(true);
  clearTimeout(watchdog);
  watchdog = setTimeout(() => { if (listening) endListen(); }, 60000);
}

async function endListen() { mbSpeechSend("stop");
  if (!listening) return;
  listening = false;
  clearTimeout(watchdog);
  pulse(false);
  const rect = await pointEnd();
  const image = crop(await shot, rect);
  if (panel && !panel.isDestroyed()) panel.webContents.send("live", { type: "stop", image });
}

function cancelListen() {
  if (!listening) return;
  listening = false;
  clearTimeout(watchdog);
  pulse(false);
  pointEnd();
  if (panel && !panel.isDestroyed()) panel.webContents.send("live", { type: "cancel" });
}

async function capture(display) {
  try {
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 2880, height: 2880 } });
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

// ---------- Point at it: hold ⌘⌥ and drag a box ----------
let pointer = null, pointDisplay = null;
const POINTER_HTML = "data:text/html;charset=utf-8," + encodeURIComponent(`<html><body style="margin:0;height:100vh;cursor:crosshair;background:rgba(0,0,0,0.002)"><div id="b" style="position:fixed;display:none;border:2px solid #c4ff2e;border-radius:10px;background:rgba(196,255,46,.08);box-shadow:0 0 0 9999px rgba(0,0,0,.28)"></div><script>let s=null;window.__rect=null;const b=document.getElementById("b");addEventListener("mousedown",e=>{s=[e.clientX,e.clientY];window.__rect=null;});addEventListener("mousemove",e=>{if(!s)return;const x=Math.min(s[0],e.clientX),y=Math.min(s[1],e.clientY),w=Math.abs(e.clientX-s[0]),h=Math.abs(e.clientY-s[1]);Object.assign(b.style,{display:"block",left:x+"px",top:y+"px",width:w+"px",height:h+"px"});window.__rect=w>12&&h>12?{x,y,w,h}:null;});addEventListener("mouseup",()=>{s=null;});</script></body></html>`);

function pointStart(display) {
  pointDisplay = display;
  if (!pointer || pointer.isDestroyed()) {
    pointer = new BrowserWindow({ show: false, frame: false, transparent: true, backgroundColor: "#00000000", hasShadow: false, skipTaskbar: true, resizable: false, movable: false, focusable: false, acceptFirstMouse: true, enableLargerThanScreen: true, type: "panel" });
    pointer.setAlwaysOnTop(true, "screen-saver");
    pointer.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    pointer.setContentProtection(true);
  }
  pointer.setBounds(display.bounds);
  pointer.loadURL(POINTER_HTML);
  pointer.showInactive();
  if (panel && !panel.isDestroyed()) panel.moveTop();
}

async function pointEnd() {
  if (!pointer || pointer.isDestroyed() || !pointer.isVisible()) return null;
  const rect = await pointer.webContents.executeJavaScript("window.__rect").catch(() => null);
  pointer.hide();
  return rect;
}

function crop(b64, rect) {
  if (!b64 || !rect || !pointDisplay) return b64;
  try {
    const img = nativeImage.createFromBuffer(Buffer.from(b64, "base64"));
    const k = img.getSize().width / pointDisplay.bounds.width;
    return img.crop({ x: Math.round(rect.x * k), y: Math.round(rect.y * k), width: Math.round(rect.w * k), height: Math.round(rect.h * k) }).toJPEG(85).toString("base64");
  } catch { return b64; }
}

// ---------- Which app is open (for instant modes) ----------
function sendContext() {
  require("child_process").execFile("/bin/sh", ["-c", "lsappinfo info -only name \"$(lsappinfo front)\""], { timeout: 1500 }, (_err, out) => {
    const m = /"LSDisplayName"="([^"]+)"/.exec(String(out || ""));
    if (m && panel && !panel.isDestroyed()) panel.webContents.send("live", { type: "context", app: m[1], apps: mbInstalled() });
  });
}

// ---------- Do it: ModeBuddy uses your Mac ----------
const mbCp = require("child_process");
const mbSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mbSh = (cmd, args, timeout = 8000) => new Promise((res) => mbCp.execFile(cmd, args, { timeout }, (err, out) => res({ err, out: String(out || "") })));
const mbOk = (e) => { try { return /^https:\/\/modebuddy\.vercel\.app$|^http:\/\/localhost(:\d+)?$/.test(new URL(e.senderFrame.url).origin); } catch { return false; } };
let mbApps = null;
function mbInstalled() {
  if (mbApps) return mbApps;
  const fs = require("fs"), path = require("path");
  const dirs = ["/Applications", "/System/Applications", "/System/Applications/Utilities", path.join(app.getPath("home"), "Applications")];
  mbApps = [...new Set(dirs.flatMap((d) => { try { return fs.readdirSync(d).filter((n) => n.endsWith(".app")).map((n) => n.slice(0, -4)); } catch { return []; } }))].slice(0, 300);
  return mbApps;
}
async function mbFront() {
  const r = await mbSh("/bin/sh", ["-c", "lsappinfo info -only name \"$(lsappinfo front)\""], 1500);
  return ((/"LSDisplayName"="([^"]+)"/.exec(r.out) || [])[1] || "").toLowerCase();
}
// Phase 2: faster steps (no waiting for the ghost cursor, shorter pauses)
async function mbWaitFront(name, ms = 7000) {
  const want = String(name).toLowerCase().replace(/\.app$/, "");
  for (const t = Date.now(); Date.now() - t < ms; await mbSleep(80)) {
    const f = await mbFront();
    if (f && (f.includes(want) || want.includes(f))) { await mbSleep(150); return true; }
  }
  return false;
}
const MB_KEYS = { enter: 36, return: 36, tab: 48, space: 49, esc: 53, escape: 53, delete: 51, backspace: 51, up: 126, down: 125, left: 123, right: 124 };
const MB_MODS = { cmd: "command down", command: "command down", shift: "shift down", alt: "option down", option: "option down", opt: "option down", ctrl: "control down", control: "control down" };
function mbKeys(combo) {
  const parts = String(combo).toLowerCase().split("+").map((s) => s.trim()).filter(Boolean);
  const key = parts.pop() || "";
  const mods = parts.map((m) => MB_MODS[m]).filter(Boolean);
  const act = MB_KEYS[key] != null ? "key code " + MB_KEYS[key] : 'keystroke "' + key.replace(/["\\]/g, "") + '"';
  return mbSh("osascript", ["-e", 'tell application "System Events" to ' + act + (mods.length ? " using {" + mods.join(", ") + "}" : "")]);
}
async function mbType(text) {
  const clip = require("electron").clipboard;
  for (const c of String(text).match(/[\s\S]{1,400}/g) || []) { clip.writeText(c); await mbSleep(40); await mbKeys("cmd+v"); await mbSleep(110); }
}
function mbClick(x, y) {
  const js = 'ObjC.import("CoreGraphics");var p=$.CGEventGetLocation($.CGEventCreate(null));var t={x:' + x + ',y:' + y + '};function e(k){$.CGEventPost(0,$.CGEventCreateMouseEvent(null,k,t,0));}e(5);delay(0.03);e(1);delay(0.04);e(2);delay(0.05);$.CGWarpMouseCursorPosition(p);';
  return mbSh("osascript", ["-l", "JavaScript", "-e", js]);
}

// The ghost that flies around and does the clicking
let mbGhost = null, mbGhostD = null;
const MB_GHOST = "data:text/html;charset=utf-8," + encodeURIComponent('<html><head><style>html,body{margin:0;background:transparent;overflow:hidden}#g{position:fixed;left:0;top:0;width:46px;height:46px;margin:-8px 0 0 -8px;transform:translate(50vw,14px);transition:transform .55s cubic-bezier(.2,.9,.25,1.04);filter:drop-shadow(0 8px 14px rgba(0,0,0,.35));will-change:transform}#g svg{width:46px;height:46px;transform-origin:50% 90%;transition:transform .15s}#g.tap svg{transform:scale(.8)}#g.type svg{animation:b .3s ease-in-out infinite alternate}@keyframes b{to{transform:translateY(-3px) rotate(-5deg)}}#r{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:2px solid #c4ff2e;opacity:0;pointer-events:none}#r.go{animation:r .45s ease-out}@keyframes r{from{transform:scale(.3);opacity:1}to{transform:scale(1.6);opacity:0}}#g.bye{opacity:0;transition:transform .3s,opacity .3s}</style></head><body><div id="r"></div><div id="g"><svg viewBox="0 0 100 100"><path d="M23.75 43A26.25 26.25 0 0 1 76.25 43V76Q69.69 84 63.13 76Q56.56 84 50 76Q43.44 84 36.88 76Q30.31 84 23.75 76Z" fill="#fbfeea" stroke="#4c5038" stroke-width="4" stroke-linejoin="round"/><ellipse cx="41.25" cy="46" rx="3" ry="5.4" fill="#2a2c20"/><ellipse cx="58.75" cy="46" rx="3" ry="5.4" fill="#2a2c20"/></svg></div><script>var g=document.getElementById("g"),r=document.getElementById("r");function go(x,y,m){g.className="";g.style.transform="translate("+x+"px,"+y+"px)";setTimeout(function(){if(m==="click"){g.className="tap";r.style.left=x+"px";r.style.top=y+"px";r.className="";void r.offsetWidth;r.className="go";setTimeout(function(){g.className=""},160)}else if(m==="type"){g.className="type"}},560)}function bye(){g.className="bye"}</script></body></html>');
function mbGhostOn(d) {
  if (!mbGhost || mbGhost.isDestroyed()) {
    mbGhost = new BrowserWindow({ show: false, frame: false, transparent: true, backgroundColor: "#00000000", hasShadow: false, skipTaskbar: true, focusable: false, resizable: false, movable: false, enableLargerThanScreen: true, type: "panel" });
    mbGhost.setIgnoreMouseEvents(true);
    mbGhost.setAlwaysOnTop(true, "screen-saver");
    mbGhost.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    mbGhost.setContentProtection(true);
    mbGhostD = null;
  }
  if (mbGhostD !== d.id) { mbGhost.setBounds(d.bounds); mbGhostD = d.id; return mbGhost.loadURL(MB_GHOST).then(() => mbGhost.showInactive()); }
  if (!mbGhost.isVisible()) mbGhost.showInactive();
  return Promise.resolve();
}
async function mbGhostTo(x, y, mode) {
  const d = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) });
  await mbGhostOn(d);
  await mbGhost.webContents.executeJavaScript("go(" + Math.round(x - d.bounds.x) + "," + Math.round(y - d.bounds.y) + "," + JSON.stringify(mode || "") + ")").catch(() => {});
  await mbSleep(mode === "click" ? 720 : 600);
}
function mbGhostOff() {
  if (!mbGhost || mbGhost.isDestroyed()) return;
  mbGhost.webContents.executeJavaScript("bye()").catch(() => {});
  setTimeout(() => { if (mbGhost && !mbGhost.isDestroyed()) { mbGhost.hide(); mbGhostD = null; } }, 350);
}

async function mbAct(s) {
  const b = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds;
  switch (s.do) {
    case "open_app": mbGhostTo(b.x + b.width / 2, b.y + b.height - 36, "click").catch(() => {}); await mbSh("open", ["-a", String(s.app)]); return { ok: await mbWaitFront(s.app) };
    case "open_url": mbGhostTo(b.x + b.width / 2, b.y + 70, "click").catch(() => {}); await mbSh("open", s.app ? ["-a", String(s.app), String(s.url)] : [String(s.url)]); if (s.app) await mbWaitFront(s.app); await mbSleep(600); return { ok: true };
    case "type": mbGhostTo(b.x + b.width / 2, b.y + b.height * 0.6, "type").catch(() => {}); await mbType(s.text || ""); return { ok: true };
    case "key": await mbKeys(s.keys || ""); await mbSleep(120); return { ok: true };
    case "click": { const x = b.x + Number(s.x) * b.width, y = b.y + Number(s.y) * b.height; await mbGhostTo(x, y, "click"); await mbClick(Math.round(x), Math.round(y)); await mbSleep(250); return { ok: true }; }
    case "find": return await mbFind(s);
    case "open_path": { const p = String(s.path || "").replace(/^~(?=\/|$)/, app.getPath("home")); mbGhostTo(b.x + b.width / 2, b.y + b.height - 36, "click").catch(() => {}); const r = await mbSh("open", s.app ? ["-a", String(s.app), p] : [p]); await mbSleep(500); return { ok: !r.err, error: r.err ? "could not open it" : undefined }; }
    case "wait": await mbSleep(Math.min(8000, Number(s.ms) || 800)); return { ok: true };
    case "done": mbGhostOff(); return { ok: true };
  }
  return { ok: false, error: "unknown step" };
}
ipcMain.handle("live:act", async (e, s) => { if (!mbOk(e)) return { ok: false }; try { return await mbAct(s || {}); } catch (x) { return { ok: false, error: String(x) }; } });
ipcMain.handle("live:shot", async (e) => { if (!mbOk(e)) return null; return capture(screen.getDisplayNearestPoint(screen.getCursorScreenPoint())).catch(() => null); });

// ---------- Find real files and folders by name (Spotlight) ----------
async function mbFind(q) {
  const name = String(q.name || "").replace(/["\\*]/g, "").trim();
  if (!name) return { ok: false, items: [] };
  const home = app.getPath("home");
  const kind = q.kind === "folder" ? ' && kMDItemContentType == "public.folder"' : q.kind === "file" ? ' && kMDItemContentType != "public.folder"' : "";
  const r = await mbSh("mdfind", ["-onlyin", home, "-attr", "kMDItemContentType", 'kMDItemFSName == "*' + name + '*"cd' + kind], 6000);
  const n = name.toLowerCase();
  const items = r.out.split("\n").map((line) => {
    const m = /^(.*?)\s+kMDItemContentType = (.*)$/.exec(line);
    if (m) return { path: m[1], folder: m[2].trim() === "public.folder" };
    return line.trim() ? { path: line.trim(), folder: q.kind === "folder" } : null;
  }).filter((it) => it && !/\/(Library|node_modules|\.git|\.Trash)(\/|$)/.test(it.path)).map((it) => ({ ...it, path: it.path.replace(home, "~") }));
  const score = (it) => {
    const base = it.path.split("/").pop().toLowerCase().replace(/\.[^.]+$/, "");
    const top = /^~\/(Desktop|Documents|Downloads)\//.test(it.path) ? 8 : 0;
    return (base === n ? 100 : base.startsWith(n) ? 60 : 30) - it.path.split("/").length * 3 + top;
  };
  items.sort((a, b) => score(b) - score(a));
  return { ok: items.length > 0, items: items.slice(0, 8).map(({ path, folder }) => ({ path, folder })) };
}

// Phase 3: Apple speech-to-text on the Mac, so your words are ready the moment you let go.
// A tiny helper (native/mbspeech) listens only while you hold ⌘⌥ and sends the words to Live.
let mbSp = null, mbSpBuf = "";
function mbSpeech() {
  if (mbSp) return mbSp;
  const bin = app.isPackaged ? require("path").join(process.resourcesPath, "mbspeech") : require("path").join(__dirname, "native", "mbspeech");
  if (!require("fs").existsSync(bin)) return null;
  try { mbSp = require("child_process").spawn(bin, [], { stdio: ["pipe", "pipe", "ignore"] }); } catch { mbSp = null; return null; }
  mbSp.on("exit", () => { mbSp = null; });
  mbSp.stdout.on("data", (d) => {
    mbSpBuf += d.toString();
    const lines = mbSpBuf.split("\n");
    mbSpBuf = lines.pop() || "";
    for (const l of lines) if (l.trim()) for (const w of BrowserWindow.getAllWindows()) w.webContents.executeJavaScript("window.__mbWords && window.__mbWords(" + JSON.stringify(l) + ")").catch(() => {});
  });
  Promise.resolve(typeof mbInstalled === "function" ? mbInstalled() : []).then((list) => mbSpeechSend("hints " + JSON.stringify(["ModeBuddy", "Kodra", "Edura", "Claude", ...(Array.isArray(list) ? list : [])].slice(0, 100)))).catch(() => {});
  return mbSp;
}
function mbSpeechSend(cmd) { const p = mbSpeech(); if (p && p.stdin.writable) p.stdin.write(cmd + "\n"); }
app.whenReady().then(() => mbSpeech());
