// stdout gehört dem MCP-Protokoll. Alle Bibliotheksmeldungen (console.log/info/warn) gehen nach stderr.
for (const k of ['log', 'info', 'warn', 'debug']) console[k] = (...a) => console.error(...a);
