// Fails when the product stylesheet uses a colour or text size outside DESIGN.md's tokens.
// The document preview block is exempt: its typography belongs to the generated Word document.
import { readFileSync } from 'node:fs';

const file = 'src/app/globals.css';
const css = readFileSync(file, 'utf8');
const exemptStart = css.indexOf('/* Document preview: same resolved model as the Word renderer */');
const exemptEnd = css.indexOf('/* Generated documents */');
const rootEnd = css.indexOf('}', css.indexOf(':root {'));

// Sizes allowed outside the type roles: the rail brand (19/16px) and the phone action title.
const allowedSizes = new Set(['19px', '16px', 'calc(16px * var(--scale))', 'inherit']);
const problems = [];
// A named token is not necessarily usable: CSS invalidates cycles, including self-references.
const dependencies = new Map();
for (const declaration of css.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) {
  const [, name, value] = declaration;
  const refs = dependencies.get(name) ?? new Set();
  for (const reference of value.matchAll(/var\(\s*(--[\w-]+)/g)) refs.add(reference[1]);
  dependencies.set(name, refs);
}
const visited = new Set();
function visit(name, path = []) {
  if (path.includes(name)) {
    problems.push(`${file} cyclic token: ${[...path.slice(path.indexOf(name)), name].join(' → ')}`);
    return;
  }
  if (visited.has(name)) return;
  for (const dependency of dependencies.get(name) ?? []) visit(dependency, [...path, name]);
  visited.add(name);
}
for (const name of dependencies.keys()) visit(name);

let offset = 0;
for (const [index, line] of css.split('\n').entries()) {
  const lineOffset = offset;
  offset += line.length + 1;
  if (lineOffset <= rootEnd || (lineOffset >= exemptStart && lineOffset < exemptEnd)) continue;
  for (const hex of line.match(/#[0-9a-f]{3,8}\b/gi) ?? [])
    problems.push(`${file}:${index + 1} raw colour ${hex}; add or use a token in :root`);
  const size = line.match(/font-size:\s*([^;]+);/)?.[1].trim();
  if (size && !size.startsWith('var(--text-') && !size.endsWith('em') && !allowedSizes.has(size))
    problems.push(`${file}:${index + 1} font-size ${size}; use a --text-* role`);
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} design token problem(s). See DESIGN.md.`);
  process.exit(1);
}
console.log('Design tokens: colours and text sizes all come from DESIGN.md roles.');
