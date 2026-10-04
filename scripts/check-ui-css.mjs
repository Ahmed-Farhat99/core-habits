import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

const root = resolve(import.meta.dirname, "..");

// Feature layout remains allowed. Paint, interaction and control sizing have
// one owner; responsive files change sizing inputs on the component's root.
const componentOwners = new Map([
  ["dh-collapse-btn", "habit-row.css"],
  ["dh-habit-color-scope", "habit-row.css"],
  ["dh-compact-status-btn", "day-cell.css"],
  ["dh-nav-arrow-btn", "button.css"],
  ["dh-header-text-btn", "button.css"],
  ["dh-icon-btn", "button.css"],
  ["dh-tab", "base.css"],
  ["dh-tabs", "base.css"],
  ["dh-diary-audio", "diary-view.css"],
]);
const rowClasses = ["habit-row", "habit-row-child", "dh-habit-row", "dh-habit-row-child", "dh-compact-row"];
const genericClasses = ["dh-empty-title", "dh-empty-desc", "dh-empty-icon", "dh-search-icon"];
const colorProperties = new Set(["--dh-row-color", "--dh-row-color-alpha", "--dh-row-color-bg"]);
const paint = /^(?:background(?:-.+)?|border(?:-.+)?|color|outline(?:-.+)?|box-shadow|opacity|cursor|transform|filter|transition(?:-.+)?|appearance)$/;
const controlSize = /^(?:(?:min-|max-)?(?:width|height|inline-size|block-size)|font-size)$/;
const hasClass = (selector, name) => new RegExp(`\\.${name}(?=[^\\w-]|$)`).test(selector);
const normalize = value => value.trim().replace(/\s+/g, " ").replace(/\s*([>+~])\s*/g, "$1");

function contextFor(rule) {
  const context = [];
  for (let node = rule.parent; node; node = node.parent) {
    if (node.type === "atrule") context.unshift(`@${node.name} ${normalize(node.params)}`);
  }
  return context.join(" / ");
}

// Combinators within :is(), :not() and attributes do not change the target.
// A descendant sticky cell can have a layout surface without owning row paint.
function finalCompound(selector) {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    const char = selector[i];
    if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (depth === 0 && /[\s>+~]/.test(char)) start = i + 1;
  }
  return selector.slice(start);
}

/** Pure ownership/duplication check, exported for regression fixtures. */
export function checkMigrationOwnership(sheets) {
  const errors = [];
  const declarations = new Map();
  for (const { file, sheet } of sheets) {
    sheet.walkDecls(decl => {
      if (colorProperties.has(decl.prop) && file !== "habit-row.css") {
        errors.push(`${file}:${decl.source.start.line}: ${decl.prop} belongs to the shared habit color scope in habit-row.css`);
      }
    });
    sheet.walkRules(rule => {
      const selectors = [...new Set(postcss.list.comma(rule.selector).map(normalize))];
      const context = contextFor(rule);
      for (const selector of selectors) {
        const components = [...componentOwners].filter(([name]) => hasClass(selector, name));
        const target = finalCompound(selector);
        const positiveTarget = target.replace(/:not\([^)]*\)/g, "");
        const isRow = rowClasses.some(name => hasClass(positiveTarget, name));
        const isLayoutRow = isRow || hasClass(target, "dh-grid-row");
        // The list header is a separate component; :not(header) is still a row.
        const isHeader = hasClass(positiveTarget, "dh-list-header");
        const relevant = components.length || isLayoutRow || genericClasses.some(name => hasClass(selector, name));
        if (!relevant) continue;
        rule.walkDecls(decl => {
          const location = `${file}:${decl.source.start.line}`;
          if (decl.important) errors.push(`${location}: !important on migrated component ${selector}`);
          for (const [name, owner] of components) {
            if (file !== owner && (paint.test(decl.prop) || controlSize.test(decl.prop) || colorProperties.has(decl.prop))) {
              errors.push(`${location}: ${name} ${decl.prop} belongs to ${owner}, not ${file}`);
            }
          }
          if (isLayoutRow && !isHeader && decl.prop === "display" && decl.value !== "none" && !target.includes(":not([hidden])")) {
            errors.push(`${location}: row layout display must use :not([hidden]) so native disclosure visibility wins (${selector})`);
          }
          if (isRow && !isHeader && paint.test(decl.prop) && file !== "habit-row.css") {
            errors.push(`${location}: row ${decl.prop} belongs to habit-row.css (${selector})`);
          }
          const key = `${context}\n${selector}\n${decl.prop}`;
          const previous = declarations.get(key);
          if (previous && previous.rule !== rule) {
            errors.push(`${location}: duplicate ${selector} / ${decl.prop}${context ? ` in ${context}` : ""}; first defined at ${previous.location}`);
          } else declarations.set(key, { location, rule });
        });
      }
    });
  }
  return [...new Set(errors)];
}

function main() {
  const stylesDir = join(root, "src", "styles");
  const entry = readFileSync(join(root, "src", "main.js"), "utf8");
  const files = readdirSync(stylesDir).filter(name => name.endsWith(".css"));
  const definitions = new Set();
  const references = new Set();
  const errors = [];
  const sheets = [];
  for (const file of files) {
    const importStatement = `import './styles/${file}';`;
    if (entry.split(importStatement).length !== 2) errors.push(`${file}: expected exactly one import in src/main.js`);
    let sheet;
    try { sheet = postcss.parse(readFileSync(join(stylesDir, file), "utf8"), { from: file }); }
    catch (error) { errors.push(`${file}: ${error.message}`); continue; }
    sheets.push({ file, sheet });
    sheet.walkDecls(decl => {
      if (decl.prop.startsWith("--dh-")) definitions.add(decl.prop);
      for (const match of decl.value.matchAll(/var\((--dh-[\w-]+)/g)) references.add(match[1]);
    });
  }
  for (const token of references) if (!definitions.has(token)) errors.push(`${token}: no CSS definition`);
  errors.push(...checkMigrationOwnership(sheets));
  if (errors.length) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
  } else {
    console.log(`UI CSS check passed: ${files.length} files, ${definitions.size} custom properties; migrated ownership and duplicate declarations checked.`);
  }
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) main();
