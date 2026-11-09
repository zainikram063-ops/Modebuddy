const { contextBridge, ipcRenderer } = require("electron");

const call = (ch, ...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld("modebuddy", {
  desktop: true,
  platform: process.platform,
  version: 2,
  live: {
    get: () => call("live:get"),
    set: (on) => call("live:set", !!on),
    request: (kind) => call("live:request", String(kind)),
    hide: () => call("live:hide"),
    interactive: (on) => call("live:interactive", !!on),
    insert: (text) => call("live:insert", String(text)),
    copy: (text) => call("live:copy", String(text)),
    speak: (text) => call("live:speak", String(text)),
    stopSpeaking: () => call("live:stopSpeaking"),
    open: () => call("live:open"),
    restart: () => call("app:restart"),
    onEvent: (cb) => {
      const h = (_e, d) => cb(d);
      ipcRenderer.on("live", h);
      return () => ipcRenderer.removeListener("live", h);
    },
  },
});

// ---------- Do it: let the panel ask the app to use the Mac ----------
const { contextBridge: mbBridge, ipcRenderer: mbIpc } = require("electron");
mbBridge.exposeInMainWorld("modebuddyAct", {
  act: (step) => mbIpc.invoke("live:act", step),
  shot: () => mbIpc.invoke("live:shot"),
});
