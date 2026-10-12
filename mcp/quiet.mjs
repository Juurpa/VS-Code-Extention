// stdout belongs to the MCP protocol. All library messages (console.log/info/warn) go to stderr.
for (const k of ['log', 'info', 'warn', 'debug']) console[k] = (...a) => console.error(...a);
