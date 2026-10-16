import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)));
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const failures = [];
for (const file of files) {
  let bytes;
  try { bytes = readFileSync(resolve(root, file)); }
  catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  if (bytes.includes(0)) continue;
  bytes.toString('utf8').split(/\r?\n/).forEach((line, index) => {
    if (/^(?:<{7}(?: .*)?|={7}|>{7}(?: .*)?|\|{7}(?: .*)?)$/.test(line.trim())) failures.push(`${file}:${index + 1}`);
  });
}
if (failures.length) {
  console.error(`Unresolved merge markers in tracked files:\n${failures.join('\n')}`);
  process.exitCode = 1;
}
