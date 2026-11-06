const { contextBridge } = require("electron");
contextBridge.exposeInMainWorld("modebuddy", { desktop: true, platform: process.platform });
