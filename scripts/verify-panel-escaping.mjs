// Proves, rather than assumes, that no panel template can interpolate an
// unescaped value into markup.
//
// The panel builds some of its DOM from template literals assigned to
// innerHTML. Every value that reaches one of those templates originates
// outside the panel — layer names, commit messages, branch names, author
// names, helper errors — so each interpolation has to be neutralised. Review
// caught this reliably; a build check catches it permanently.
//
// This walks a real TypeScript AST rather than matching text, and classifies
// every `${...}` in every innerHTML template as safe only when it is:
//
//   * a call to escapeHtml(...),
//   * a literal, or an expression built only from literals (a ternary of
//     string literals, a concatenation of them),
//   * a call to a function declared in the same file whose every return is
//     itself safe by these rules, or
//   * an identifier bound by a const in an enclosing scope whose initialiser
//     is safe by these rules.
//
// Nothing here is an allowlist of names, so it cannot rot: change a helper to
// interpolate a layer name and the call sites that use it start failing.
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
// The directory is overridable so the check can be pointed at a fixture and
// proven to actually fail; a gate nobody has seen fail is a gate on trust.
const panel = process.argv[2] || "apps/photoshop-plugin";
const ESCAPER = "escapeHtml";

// Treating a call named escapeHtml as safe is only sound if the function that
// name resolves to really escapes. Any file that relies on it must declare it,
// and that declaration must handle all five characters.
const REQUIRED = [["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ['"', "&quot;"], ["'", "&#39;"]];
function escaperIsSound(text) {
  const declaration = text.split("\n").find((line) => line.includes(`function ${ESCAPER}(`));
  if (!declaration) return "does not declare it";
  for (const [character, entity] of REQUIRED) {
    if (!declaration.includes(entity)) return `declares it without escaping ${character} to ${entity}`;
  }
  return null;
}

const entries = await readdir(join(root, panel));
const scripts = entries.filter((name) => name.endsWith(".js") && !name.endsWith(".test.js")).sort();
if (!scripts.length) { console.error("No panel scripts found to check."); process.exit(1); }

const findings = [];
let templates = 0;
let interpolations = 0;

for (const name of scripts) {
  const text = await readFile(join(root, panel, name), "utf8");
  const source = ts.createSourceFile(`${panel}/${name}`, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);

  // Function declarations in this file, so a call can be resolved to its body.
  const functions = new Map();
  const collect = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      functions.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, collect);
  };
  collect(source);

  const literal = (node) =>
    ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isNumericLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword;

  // Walks outward from a use to find the const that binds an identifier.
  function bindingFor(name, from) {
    for (let scope = from; scope; scope = scope.parent) {
      let found = null;
      const scan = (node) => {
        if (found) return;
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name &&
          node.parent && node.parent.flags & ts.NodeFlags.Const) { found = node; return; }
        // Do not descend into nested functions; their bindings are not ours.
        if (node !== scope && (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node))) return;
        ts.forEachChild(node, scan);
      };
      ts.forEachChild(scope, scan);
      if (found) return found;
    }
    return null;
  }

  function returnsOf(fn) {
    const results = [];
    const scan = (node) => {
      if (node !== fn && (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node))) return;
      if (ts.isReturnStatement(node) && node.expression) results.push(node.expression);
      ts.forEachChild(node, scan);
    };
    ts.forEachChild(fn, scan);
    if (ts.isArrowFunction(fn) && fn.body && !ts.isBlock(fn.body)) results.push(fn.body);
    return results;
  }

  function safe(node, seen = new Set(), depth = 0) {
    if (!node || depth > 12) return false;
    if (literal(node)) return true;
    if (ts.isParenthesizedExpression(node)) return safe(node.expression, seen, depth + 1);
    if (ts.isConditionalExpression(node)) return safe(node.whenTrue, seen, depth + 1) && safe(node.whenFalse, seen, depth + 1);
    if (ts.isBinaryExpression(node)) {
      const operator = node.operatorToken.kind;
      if (operator === ts.SyntaxKind.PlusToken || operator === ts.SyntaxKind.BarBarToken || operator === ts.SyntaxKind.QuestionQuestionToken) {
        return safe(node.left, seen, depth + 1) && safe(node.right, seen, depth + 1);
      }
      return false;
    }
    if (ts.isTemplateExpression(node)) return node.templateSpans.every((span) => safe(span.expression, seen, depth + 1));
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression)) {
        const callee = node.expression.text;
        if (callee === ESCAPER) { usesEscaper = true; return true; }
        const declaration = functions.get(callee);
        if (declaration && !seen.has(callee)) {
          seen.add(callee);
          const returns = returnsOf(declaration);
          return returns.length > 0 && returns.every((value) => safe(value, seen, depth + 1));
        }
      }
      return false;
    }
    if (ts.isIdentifier(node)) {
      if (seen.has(`id:${node.text}`)) return false;
      seen.add(`id:${node.text}`);
      const binding = bindingFor(node.text, node.parent);
      return binding ? safe(binding.initializer, seen, depth + 1) : false;
    }
    return false;
  }

  let usesEscaper = false;
  const check = (node) => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) && /^(?:inner|outer)HTML$/.test(node.left.name.text)) {
      const value = node.right;
      if (ts.isTemplateExpression(value)) {
        templates++;
        for (const span of value.templateSpans) {
          interpolations++;
          if (safe(span.expression)) continue;
          const line = source.getLineAndCharacterOfPosition(span.expression.getStart(source)).line + 1;
          findings.push(`${panel}/${name}:${line}: unescaped interpolation \`${span.expression.getText(source).trim()}\``);
        }
      } else if (!safe(value)) {
        const line = source.getLineAndCharacterOfPosition(value.getStart(source)).line + 1;
        findings.push(`${panel}/${name}:${line}: markup assigned from \`${value.getText(source).trim().slice(0, 60)}\``);
      }
    }
    ts.forEachChild(node, check);
  };
  check(source);

  if (usesEscaper) {
    const problem = escaperIsSound(text);
    if (problem) findings.push(`${panel}/${name}: relies on ${ESCAPER}() but ${problem}`);
  }
}

if (findings.length) {
  console.error(`Every value interpolated into panel markup must pass through ${ESCAPER}() or be provably constant:`);
  for (const finding of findings) console.error(`  ${finding}`);
  process.exit(1);
}
console.log(`Panel escaping verified: ${scripts.length} scripts, ${templates} markup templates, ${interpolations} interpolations, every one escaped or provably constant.`);
