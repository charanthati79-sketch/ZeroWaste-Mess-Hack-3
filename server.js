"use strict";
const { loadConfig } = require("./server/config");
const { createApp } = require("./server/app");

const cfg = loadConfig();
const { app } = createApp(cfg);
app.listen(cfg.port, () => console.log(`MessMeter running on http://localhost:${cfg.port}`));
