#!/usr/bin/env node

import { serveRunDocketMcp } from "./mcp.js";

const handle = serveRunDocketMcp();
let closing = false;

const shutdown = async (): Promise<void> => {
  if (closing) {
    return;
  }
  closing = true;
  await handle.close().catch(() => undefined);
};

process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});
