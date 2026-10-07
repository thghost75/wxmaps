import {readFile, readdir, stat} from 'node:fs/promises';
import {resolve, relative, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = resolve(root, 'dist');
const files = await readdir(dist);
for (const file of [...files.filter(name => name.endsWith('.js')).map(name => 'dist/' + name), 'server.mjs', 'scripts/check.mjs']) {
  execFileSync(process.execPath, ['--check', resolve(root, file)], {stdio: 'inherit'});
}
async function checkReference(reference, from) {
  if (/^(?:[a-z]+:|#)/i.test(reference)) return;
  assert(!reference.startsWith('/'), 'Root-relative path breaks project Pages: ' + reference);
  const target = resolve(dirname(from), reference.split(/[?#]/)[0]);
  assert(!relative(dist, target).startsWith('..'), 'Asset escapes dist: ' + reference);
  await stat(target);
  const pageUrl = new URL(reference, 'https://example.github.io/WxMaps/' + relative(dist, from).replaceAll('\\', '/'));
  assert(pageUrl.pathname.startsWith('/WxMaps/'), 'Asset escapes project URL: ' + reference);
}
const html = await readFile(resolve(dist, 'index.html'), 'utf8');
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) await checkReference(match[1], resolve(dist, 'index.html'));
for (const file of files.filter(name => name.endsWith('.js'))) {
  const source = await readFile(resolve(dist, file), 'utf8');
  for (const match of source.matchAll(/(?:from\s*|import\s*|fetch\s*\()(['"])(\.\.?\/[^'"]+)\1/g)) {
    await checkReference(match[2], resolve(dist, file));
  }
}
const geography = JSON.parse(await readFile(resolve(dist, 'region.json'), 'utf8'));
assert(geography.features.some(feature => feature.properties.name === 'Romania'), 'Romania map data missing');
console.log('Passed: JavaScript syntax, local asset references, project URL paths and Romania map data.');
