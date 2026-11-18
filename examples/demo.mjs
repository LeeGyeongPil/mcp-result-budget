// Demo: a real MCP SDK server and client linked in memory (no model, no network).
// Run: npm run demo -- [--lang en|ko] [--sdk v1|v2] [--show-page <tool> <n>]
import { z } from "zod";
import { withResultBudget, DECLARE_META } from "../dist/index.js";
import { expectRoundTrip, readAllPages } from "../dist/testing.js";
import { format, messages, resolveLang } from "./i18n.mjs";

const argv = process.argv.slice(2);
const lang = resolveLang(argv, process.env);
if (!lang) {
  console.error(format(messages.en.badArgs, { arg: "--lang" }));
  process.exit(2);
}
const t = (key, vars) => format(messages[lang][key], vars);
const sdkIdx = argv.indexOf("--sdk");
const flavor = sdkIdx >= 0 ? argv[sdkIdx + 1] : "v1";
const showIdx = argv.indexOf("--show-page");
const known = new Set(["--lang", "--sdk", "--show-page", "en", "ko", "v1", "v2"]);
const bad = argv.find((a, i) => !known.has(a) && !(showIdx >= 0 && i > showIdx && i <= showIdx + 2));
if ((flavor !== "v1" && flavor !== "v2") || bad) {
  console.error(t("badArgs", { arg: bad ?? flavor }));
  process.exit(2);
}

const BUDGET = 8000;
// Display width: Hangul and other wide characters take two columns.
const width = (s) => [...s].reduce((n, c) => n + (/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\uff00-\uff60]/.test(c) ? 2 : 1), 0);
const padEndW = (s, w) => s + " ".repeat(Math.max(0, w - width(s)));
const num = (n) => n.toLocaleString("en-US");

// 1) Sample data, all generated in code ---------------------------------------------------
const logText =
  Array.from({ length: 400 }, (_, i) => `line ${i} 한글과 emoji 😀 ` + "x".repeat(60)).join("\n") +
  "\n" + "y".repeat(20000);
const rows = Array.from({ length: 300 }, (_, i) => ({ id: i, name: `item-${i}`, note: "z".repeat(40) }));
const image = { type: "image", data: Buffer.alloc(3000, 7).toString("base64"), mimeType: "image/png" };
const Out = z.object({ total: z.number(), rows: z.array(z.object({ id: z.number(), name: z.string(), note: z.string() })) });
const results = {
  logs: { content: [{ type: "text", text: logText }] },
  rows: { content: [{ type: "text", text: JSON.stringify({ total: 300, rows }) }], structuredContent: { total: 300, rows } },
  shot: { content: [{ type: "text", text: logText.slice(0, 12000) }, image, { type: "text", text: "caption" }] },
};

// 2) Real SDK server + client (v1 or v2), linked in memory --------------------------------
async function connect(setup) {
  let McpServer, Client, InMemoryTransport;
  if (flavor === "v1") {
    ({ McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js"));
    ({ Client } = await import("@modelcontextprotocol/sdk/client/index.js"));
    ({ InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js"));
  } else {
    ({ McpServer, InMemoryTransport } = await import("@modelcontextprotocol/server"));
    ({ Client } = await import("@modelcontextprotocol/client"));
  }
  const server = new McpServer({ name: "demo", version: "0.0.0" });
  setup(server);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "scripted-client", version: "0.0.0" });
  await client.connect(ct);
  return client;
}

function registerTools(server) {
  const noInput = z.object({});
  server.registerTool("logs", { description: "big text", inputSchema: noInput }, async () => results.logs);
  server.registerTool("rows", { description: "rows with outputSchema", inputSchema: noInput, outputSchema: Out }, async () => results.rows);
  server.registerTool("shot", { description: "text, image, text", inputSchema: noInput }, async () => results.shot);
}

// 3) The two lines a server author adds ---------------------------------------------------
const client = await connect((server) => {
  withResultBudget(server, { maxChars: BUDGET }); // <- line 1: wrap registerTool, add read_more
  registerTools(server); //                           <- line 2: your tools, unchanged
});

// Naive comparison: split the text first, decorate afterwards, ignore structuredContent.
const naiveClient = await connect((server) => {
  const orig = server.registerTool.bind(server);
  server.registerTool = (name, config, cb) =>
    orig(name, config, async (...a) => {
      const r = await cb(...a);
      const text = r.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      if (JSON.stringify(r).length <= BUDGET) return r;
      const note = `\n[page 1/9] call read_more {"cursor":"${"c".repeat(24)}"}`;
      return { content: [{ type: "text", text: text.slice(0, BUDGET - 200) + note }], _meta: { "naive/page": { index: 0, total: 9 } } };
    });
  registerTools(server);
});

// --show-page: print one page as the model receives it
if (showIdx >= 0) {
  const tool = argv[showIdx + 1];
  const n = Number(argv[showIdx + 2]);
  if (!(tool in results)) {
    console.error(t("badTool", { tool, tools: Object.keys(results).join(", ") }));
    process.exit(2);
  }
  const all = await readAllPages(client, { name: tool });
  if (!Number.isInteger(n) || n < 1 || n > all.pages.length) {
    console.error(t("badPage", { n: argv[showIdx + 2], tool, pages: all.pages.length }));
    process.exit(2);
  }
  const shorten = (v) => JSON.parse(JSON.stringify(v, (k, x) =>
    typeof x === "string" && x.length > 120 && k !== "nextCursor" ? `${x.slice(0, 80)}…(+${x.length - 80} chars)` : x));
  console.log(t("pageHeader", { tool, n }));
  console.log(JSON.stringify(shorten(all.pages[n - 1]), null, 2));
  await client.close();
  await naiveClient.close();
  process.exit(0);
}

// 4) Table: pages, largest page, budget, round-trip ---------------------------------------
console.log(`${t("title")} (${t("sdk")} ${flavor})`);
console.log(t("mock"));
console.log(`${t("budgetLine")}: ${num(BUDGET)}`);
console.log("");
const header = [t("colTool"), t("colPages"), t("colMax"), t("colBudget"), t("colRound")];
const lines = [];
let allOk = true;
for (const tool of Object.keys(results)) {
  const all = await readAllPages(client, { name: tool });
  const max = Math.max(...all.pages.map((p) => JSON.stringify(p).length));
  let status = t("ok");
  try {
    await expectRoundTrip(client, { name: tool }, { maxChars: BUDGET, original: results[tool], ...(tool === "rows" ? { outputSchema: Out } : {}) });
  } catch (e) {
    status = `${t("fail")}: ${e.message}`;
    allOk = false;
  }
  lines.push([tool, String(all.pages.length), num(max), num(BUDGET), status]);
}
const widths = header.map((h, i) => Math.max(width(h), ...lines.map((l) => width(l[i]))));
const row = (cells) => cells.map((c, i) => padEndW(c, widths[i])).join("  ").trimEnd();
console.log(row(header));
console.log(widths.map((w) => "-".repeat(w)).join("  "));
for (const l of lines) console.log(row(l));

console.log("");
const { tools } = await client.listTools();
console.log(t("toolsList"));
for (const tool of tools) console.log(`  ${tool.name}: ${tool._meta?.[DECLARE_META]}`);

console.log("");
console.log(t("naiveTitle"));
const naiveText = await naiveClient.callTool({ name: "logs", arguments: {} });
console.log("  logs: " + t("naiveOver", { size: num(JSON.stringify(naiveText).length), budget: num(BUDGET) }));
let message;
try {
  const r = await naiveClient.callTool({ name: "rows", arguments: {} });
  message = r.isError ? r.content.map((b) => b.text).join(" ") : "(no error)";
} catch (e) {
  message = e.message;
}
console.log("  rows: " + t("naiveSchema", { message }));

console.log("");
console.log(allOk ? t("allOk") : t("someFail"));
await client.close();
await naiveClient.close();
process.exit(allOk ? 0 : 1);
