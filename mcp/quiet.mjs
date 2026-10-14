// stdout belongs to the MCP protocol. All library messages (console.log/info/warn) go to stderr.
// pdf.js complains on every start that it runs without its "legacy" build. Harmless here, so it is not logged.
const HARMLESS = /Please use the `legacy` build in Node\.js environments/;
for (const k of ['log', 'info', 'warn', 'debug']) console[k] = (...a) => { if (!HARMLESS.test(String(a[0]))) console.error(...a); };
