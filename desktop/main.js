const { app, BrowserWindow, Tray, Menu, nativeImage, shell } = require("electron");
const path = require("path");

const SITE = process.env.MB_URL || require("./config.json").url;
const ORIGIN = new URL(SITE).origin;
const OFFLINE = "data:text/html;charset=utf-8," + encodeURIComponent(
  `<body style="font:15px -apple-system;display:grid;place-items:center;height:100vh;margin:0;color:#444"><div style="text-align:center"><h2>You are offline</h2><p>ModeBuddy needs the internet.</p><p><a href="${SITE}">Try again</a></p></div></body>`
);

let win = null;
let tray = null;
let pending = null;
let quitting = false;

if (!app.requestSingleInstanceLock()) app.exit(0);

app.on("second-instance", () => show());
app.on("open-url", (e, link) => { e.preventDefault(); handleLink(link); });
app.on("before-quit", () => { quitting = true; });
app.on("activate", () => show());
app.on("window-all-closed", () => {});

app.whenReady().then(() => {
  if (!app.isDefaultProtocolClient("modebuddy")) app.setAsDefaultProtocolClient("modebuddy");
  createWindow();
  createTray();
});

function show() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
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

// The green dot, drawn in code so no image file is needed
function dot(r, g, b) {
  const S = 36, rad = 8.5, c = S / 2, buf = Buffer.alloc(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const a = Math.max(0, Math.min(1, rad + 0.5 - Math.hypot(x + 0.5 - c, y + 0.5 - c)));
    const i = (y * S + x) * 4;
    buf[i] = b * a; buf[i + 1] = g * a; buf[i + 2] = r * a; buf[i + 3] = 255 * a;
  }
  return nativeImage.createFromBitmap(buf, { width: S, height: S, scaleFactor: 2 });
}

function createTray() {
  tray = new Tray(dot(34, 197, 94));
  tray.setToolTip("ModeBuddy");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open ModeBuddy", click: show },
    { label: "Live mode (coming soon)", enabled: false },
    { type: "separator" },
    { label: "Open at Login", type: "checkbox", checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }) },
    { type: "separator" },
    { label: "Quit ModeBuddy", click: () => app.quit() },
  ]));
}
