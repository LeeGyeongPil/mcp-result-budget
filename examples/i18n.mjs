// Message table for the demo (English / Korean). Every key must exist in both languages.
export const messages = {
  en: {
    title: "mcp-result-budget demo",
    mock: "practice mode: a real SDK server and client linked in memory, scripted client instead of a model",
    sdk: "SDK",
    budgetLine: "budget",
    colTool: "tool",
    colPages: "pages",
    colMax: "max page chars",
    colBudget: "budget",
    colRound: "round-trip",
    ok: "ok",
    fail: "FAIL",
    naiveTitle: "Naive splitting for comparison (what the library avoids):",
    naiveOver: "page 1 is {size} chars, over the {budget} budget (note and _meta were added after measuring)",
    naiveSchema: "outputSchema tool split as text only: {message}",
    toolsList: "tools/list declares _meta[\"anthropic/maxResultSizeChars\"]:",
    pageHeader: "Page {n} of {tool} as the model receives it (long text shortened for display):",
    badArgs: "Unknown option or value: {arg}. Usage: demo.mjs [--lang en|ko] [--sdk v1|v2] [--show-page <tool> <n>]",
    badTool: "No tool named {tool}. Tools: {tools}",
    badPage: "Page {n} does not exist for {tool} (it has {pages} pages).",
    allOk: "All budgeted tools passed the round trip.",
    someFail: "Some round trips failed.",
  },
  ko: {
    title: "mcp-result-budget 데모",
    mock: "연습용 목(mock) 모드: 실제 SDK 서버·클라이언트를 메모리로 이었고, 모델 대신 정해진 순서로 읽는 클라이언트를 씁니다",
    sdk: "SDK",
    budgetLine: "예산",
    colTool: "도구",
    colPages: "페이지",
    colMax: "최대 페이지 글자",
    colBudget: "예산",
    colRound: "왕복 검증(round-trip)",
    ok: "ok",
    fail: "실패",
    naiveTitle: "비교용 단순 분할(라이브러리가 피하는 방식):",
    naiveOver: "1페이지가 {size}자로 예산 {budget}자를 넘음(안내문과 _meta 를 측정한 뒤에 붙였기 때문)",
    naiveSchema: "outputSchema 도구를 텍스트로만 나눔: {message}",
    toolsList: "tools/list 가 선언한 _meta[\"anthropic/maxResultSizeChars\"]:",
    pageHeader: "{tool} 의 {n}페이지, 모델이 받는 모습(긴 텍스트는 화면용으로 줄임):",
    badArgs: "알 수 없는 옵션 또는 값: {arg}. 사용법: demo.mjs [--lang en|ko] [--sdk v1|v2] [--show-page <도구> <번호>]",
    badTool: "{tool} 도구가 없습니다. 도구: {tools}",
    badPage: "{tool} 에 {n}페이지가 없습니다(총 {pages}페이지).",
    allOk: "예산을 지킨 모든 도구가 왕복 검증을 통과했습니다.",
    someFail: "일부 왕복 검증이 실패했습니다.",
  },
};

/** --lang > MCP_RESULT_BUDGET_LANG > LC_ALL > LC_MESSAGES > LANG; anything not Korean is English. */
export function resolveLang(argv, env) {
  const i = argv.indexOf("--lang");
  if (i >= 0) {
    const v = argv[i + 1];
    if (v !== "en" && v !== "ko") return undefined;
    return v;
  }
  for (const value of [env.MCP_RESULT_BUDGET_LANG, env.LC_ALL, env.LC_MESSAGES, env.LANG]) {
    if (value) return value.toLowerCase().startsWith("ko") ? "ko" : "en";
  }
  return "en";
}

export function format(template, vars = {}) {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}
