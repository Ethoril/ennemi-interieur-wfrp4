// Lecture partagée des règles CSS pour les tests apple-design.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { URL, fileURLToPath } from 'node:url';

export const CSS_DIR = fileURLToPath(new URL('../css/', import.meta.url));

export function readCss(file) {
  return readFileSync(join(CSS_DIR, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

// Règles { selector, body, media, file } ; les @keyframes sont rendus avec selector "@keyframes nom".
export function cssRules(file) {
  const src = readCss(file);
  const out = [];
  const stack = [];
  let buf = '';
  for (const c of src) {
    if (c === '{') { stack.push(buf.trim()); buf = ''; }
    else if (c === '}') {
      const head = stack.pop() ?? '';
      if (!head.startsWith('@')) {
        const parentKf = stack.find((s) => s.startsWith('@keyframes'));
        out.push({ selector: parentKf ? `${parentKf} ${head}` : head, body: buf, media: stack.filter((s) => s.startsWith('@media')), file });
      }
      buf = '';
    } else if (c === ';' && !(stack.length && !stack[stack.length - 1].startsWith('@'))) { buf = ''; }
    else buf += c;
  }
  return out;
}

export function allRules() {
  return readdirSync(CSS_DIR).filter((f) => f.endsWith('.css')).flatMap(cssRules);
}

export function decl(body, prop) {
  const m = new RegExp(String.raw`(?:^|;|\s)${prop}\s*:\s*([^;]+)`).exec(body);
  return m ? m[1].trim() : null;
}
