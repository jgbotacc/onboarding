// Unified look-and-feel checks (design C): one shared Header, one theme.css,
// no per-page copies of the base rules, readable type and 44px targets.
// Run: npm test
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const src = join(root, "src");

const theme = readFileSync(join(src, "theme.css"), "utf8");
const main = readFileSync(join(src, "main.tsx"), "utf8");
const app = readFileSync(join(src, "App.tsx"), "utf8");
const staffPage = readFileSync(join(src, "staff", "StaffPage.tsx"), "utf8");
const designerPage = readFileSync(join(src, "staff", "DesignerPage.tsx"), "utf8");
const staffCss = readFileSync(join(src, "staff", "staff.css"), "utf8");
const clientCss = readFileSync(join(src, "styles.css"), "utf8");

let n = 0;
const pass = (name, cond) => (n++, assert.ok(cond, name));

// Bare base-rule selectors: ".btn" or ".header" as a full class (not
// ".btn-send", ".staff-btn-inline", ".header-avatar", ".header-right").
const bare = (css, cls) => new RegExp(`(^|[\\s,{}])\\.${cls}(?![-\\w])`).test(css);
const rootBlock = (css) => /:root\s*\{[^}]*\}/.exec(css)?.[0] || "";

// --- One shared Header used by all three pages and the sign-in screen.
for (const [name, body] of [["App", app], ["StaffPage", staffPage], ["DesignerPage", designerPage]]) {
  pass(`${name} imports the shared Header`, /from ["']\.\.?\/?Header["']/.test(body));
  pass(`${name} renders the shared Header`, /<Header[\s>]/.test(body));
  pass(`${name} keeps no local header markup`, !/<header className="header">/.test(body));
}
// The sign-in gate renders under the page header, never its own copy.
pass("sign-in gate lives on a Header page", staffPage.includes("PasscodeGate") && /<Header[\s>]/.test(staffPage));
pass("sign-in copy unchanged", /Staff sign-in/.test(staffPage) && /staff or designer passcode/.test(staffPage));

// --- One shared stylesheet, imported once in main.tsx.
pass("theme.css imported once in main.tsx", (main.match(/theme\.css/g) || []).length === 1);
pass("theme import is a side-effect import", /import ["']\.\/theme\.css["']/.test(main));

// --- Theme carries the design C palette and tokens.
const vars = Object.fromEntries(
  [...rootBlock(theme).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((x) => [x[1], x[2].trim()]),
);
for (const [k, v] of [
  ["--accent", "#b8336a"], ["--ground", "#fbf7f8"], ["--surface", "#ffffff"],
  ["--text", "#111827"], ["--muted", "#5f6672"], ["--accent-soft", "#fdf2f7"],
  ["--accent-ink", "#6b1d3e"], ["--accent-track", "#f8dbe8"],
  ["--positive", "#247b50"], ["--negative", "#c4242a"],
]) {
  pass(`theme token ${k} is design C (${v})`, vars[k] === v);
}

// --- Readable type and targets in theme.css.
const rootPx = /font-size\s*:\s*(\d+)px/.exec(rootBlock(theme))?.[1];
pass("base font-size >= 16px in theme.css", Number(rootPx) >= 16);
const btnBlock = /\.btn\s*\{[^}]*\}/.exec(theme)?.[0] || "";
const btnMin = /min-height\s*:\s*(\d+)px/.exec(btnBlock)?.[1];
pass("button min-height >= 44px in theme.css", Number(btnMin) >= 44);
pass("theme styles the shared header", /\.header\s*\{/.test(theme));
pass("theme styles pills, cards, tables and inputs",
  /\.pill\s*\{/.test(theme) && /\.card\s*\{/.test(theme) && /\.table\s*\{/.test(theme) &&
  /input[^{]*\{[^}]*min-height\s*:\s*44px/.test(theme));

// --- Good contrast on the pairs the pages actually render.
const lum = (hex) => {
  const c = hex.replace("#", "").padEnd(6, "0").slice(0, 6);
  const f = (i) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(0) + 0.7152 * f(2) + 0.0722 * f(4);
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const val = (k) => {
  let v = (vars[k] || "").toLowerCase();
  const m = /var\((--[\w-]+)\)/.exec(v);
  if (m && vars[m[1]]) v = vars[m[1]].toLowerCase();
  return v;
};
for (const [name, fg, bg] of [
  ["body text", val("--text"), val("--surface")],
  ["secondary text", val("--muted"), val("--surface")],
  ["button text", "#ffffff", val("--accent")],
  ["page label", val("--accent-ink"), val("--accent-soft")],
  ["warning text", val("--warn"), val("--warn-soft")],
  ["danger text", val("--danger"), val("--surface")],
]) {
  pass(`contrast ${name} >= 4.5:1`, ratio(fg, bg) >= 4.5);
}

// --- No per-page copies of the base rules.
for (const [name, css] of [["staff.css", staffCss], ["styles.css", clientCss]]) {
  pass(`${name} has no :root palette`, !/:root/.test(css));
  pass(`${name} has no .btn base rules`, !bare(css, "btn"));
  pass(`${name} has no .header base rules`, !bare(css, "header"));
}
// Designer page styling: either no designer CSS file (uses staff.css + theme)
// or, if one exists, it follows the same no-copy rule.
const designerCssFiles = readdirSync(join(src, "staff")).filter((f) => /designer.*\.css$/i.test(f));
if (designerCssFiles.length === 0) {
  pass("designer page reuses staff.css + theme", designerPage.includes("./staff.css"));
} else {
  for (const f of designerCssFiles) {
    const css = readFileSync(join(src, "staff", f), "utf8");
    pass(`${f} has no :root palette`, !/:root/.test(css));
    pass(`${f} has no .btn base rules`, !bare(css, "btn"));
    pass(`${f} has no .header base rules`, !bare(css, "header"));
  }
}

// --- Client flow untouched: every control, text, id and test hook stays.
for (const id of ["statusPill", "langSelect", "demoBadge", "choiceUpload", "choiceForm",
  "composer", "textInput", "sendBtn", "attachBtn", "micBtn", "fileInput", "missingCard",
  "missingList", "chips", "lightbox"]) {
  pass(`client keeps id ${id}`, app.includes(`id="${id}"`));
}
pass("client keeps refill bar", app.includes("refill-bar"));
const formModal = readFileSync(join(src, "FormModal.tsx"), "utf8");
for (const id of ["formModal", "formModalTitle", "formSubmit", "refAddBtn"]) {
  pass(`client form keeps id ${id}`, formModal.includes(`id="${id}"`));
}
pass("staff keeps the Designer link", />Designer<\/a>/.test(staffPage) && /#\/designer/.test(staffPage));
pass("designer keeps the staff-only link", /role === "staff" &&/.test(designerPage));
pass("no model names on any page",
  [app, staffPage, designerPage].every((b) =>
    !/\b(gpt-?\d|claude|gemini|llama|mistral|mixtral|grok|deepseek|palm|falcon)\b/i.test(b)));

// --- Wired in: the check runs in npm test.
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
pass("npm test runs unified-theme checks", String(pkg.scripts?.test || "").includes("test-unified-theme"));

console.log(`unified-theme: ${n} checks passed`);
