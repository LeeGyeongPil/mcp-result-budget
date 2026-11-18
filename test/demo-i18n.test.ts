import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { format, messages as rawMessages, resolveLang } from "../examples/i18n.mjs";

const messages = rawMessages as Record<string, Record<string, string>>;

describe("demo i18n", () => {
  it("en and ko message keys match", () => {
    expect(Object.keys(messages.ko).sort()).toEqual(Object.keys(messages.en).sort());
    for (const lang of ["en", "ko"]) {
      for (const v of Object.values(messages[lang]) as string[]) expect(v.length).toBeGreaterThan(0);
    }
    // same placeholders in both languages
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of Object.keys(messages.en)) expect(ph(messages.ko[k])).toBe(ph(messages.en[k]));
  });

  it("language resolution order is flag, tool env, then locale env", () => {
    expect(resolveLang(["--lang", "ko"], { MCP_RESULT_BUDGET_LANG: "en" })).toBe("ko");
    expect(resolveLang([], { MCP_RESULT_BUDGET_LANG: "ko", LANG: "en_US.UTF-8" })).toBe("ko");
    expect(resolveLang([], { LC_ALL: "ko_KR.UTF-8", LANG: "en_US.UTF-8" })).toBe("ko");
    expect(resolveLang([], { LANG: "ko_KR.UTF-8" })).toBe("ko");
    expect(resolveLang([], { LANG: "fr_FR.UTF-8" })).toBe("en");
    expect(resolveLang([], {})).toBe("en");
    expect(resolveLang(["--lang", "xx"], {})).toBeUndefined();
    expect(format("a {x} b", { x: 1 })).toBe("a 1 b");
  });

  const built = existsSync(new URL("../dist/index.js", import.meta.url));
  it.skipIf(!built)("the demo switches language and passes every round trip", () => {
    const run = (args: string[], env: Record<string, string> = {}) =>
      execFileSync("node", ["examples/demo.mjs", ...args], { encoding: "utf8", env: { ...process.env, ...env } });
    const en = run(["--lang", "en"]);
    expect(en).toContain("pages");
    expect(en).toContain("round-trip");
    expect(en).toContain("Output validation error");
    expect(en.split("\n").filter((l) => /^(logs|rows|shot)\s/.test(l)).every((l) => l.trimEnd().endsWith("ok"))).toBe(true);
    expect(run(["--lang", "ko"])).toContain("페이지");
    expect(run([], { MCP_RESULT_BUDGET_LANG: "ko", LC_ALL: "", LANG: "" })).toContain("페이지");
  });
});
