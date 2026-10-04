#!/usr/bin/env node
/**
 * Encoding sanity check for FeiControl.
 * Scans .ts/.tsx/.js/.json/.md files for suspicious non-ASCII characters
 * that are likely corruption artifacts (mojibake).
 *
 * Usage:
 *   node scripts/check-encoding.js            # walk the whole working tree
 *   node scripts/check-encoding.js --staged   # read a NUL-separated file list from stdin
 *   node scripts/check-encoding.js --fix      # strip known bad chars
 *
 * `--staged` is what the pre-commit hook uses. A pre-commit hook must only
 * judge what is actually being committed: scanning the whole working tree
 * caused false failures on git-ignored runtime artifacts (for example
 * public/memory-graph-data.json, which legitimately contains whatever text the
 * local notes contain) and on files that were being deleted.
 *
 * The hook feeds the list in via stdin rather than this script shelling out to
 * git, so it works even where spawning a child process is restricted:
 *
 *   git diff --cached --name-only --diff-filter=ACM -z | node scripts/check-encoding.js --staged
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.css'];

// Use codepoints to avoid storing literal bad chars in source
// NOTE: 0x8DEF (「路」) was removed on 2026-07-30 — it is a legitimate
// Chinese character (路径/主要路径 etc.) and was a false positive here.
const BAD_CODEPOINTS = new Set([
  0x9983, 0x923F, 0x9225, 0x715D, 0x6319, 0x6315, 0x6537, 0x6533,
  0x6451, 0x5E00, 0x7B0D, 0x72C5, 0x6435, 0x6465, 0x6466,
  0x041A, 0x041E,
]);

const FIX_MAP = {
  '\u9983': '',
  '\u923F': '',
  '\u9225': '',
  '\u715D': '',
  '\u6319': '',
  '\u6315': '',
  '\u6537': '',
  '\u6533': '',
  '\u6451': '',
  '\u5E00': '',
  '\u7B0D': '',
  '\u72C5': '',
  '\u6435': '',
  '\u6465': '',
  '\u6466': '',
  '\u041A': 'A',
  '\u041E': 'O',
};

const shouldCheck = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSIONS.includes(ext);
};

const scanFile = (filePath, fix = false) => {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return { file: filePath, error: e.message };
  }

  const lines = content.split(/\r?\n/);
  const issues = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) {
      const code = ch.charCodeAt(0);
      if (code > 127 && BAD_CODEPOINTS.has(code)) {
        issues.push({
          line: i + 1,
          char: ch,
          code: 'U+' + code.toString(16).toUpperCase().padStart(4, '0'),
        });
      }
    }
  }

  if (fix && issues.length > 0) {
    let fixed = content;
    for (const [bad, good] of Object.entries(FIX_MAP)) {
      fixed = fixed.split(bad).join(good);
    }
    fixed = fixed.replace(/\u9983./g, '');
    fs.writeFileSync(filePath, fixed, 'utf8');
    return { file: filePath, fixed: true, count: issues.length };
  }

  return { file: filePath, issues };
};

const walk = (dir) => {
  let results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'out') continue;
      if (entry.isDirectory()) {
        results = results.concat(walk(full));
      } else if (entry.isFile() && shouldCheck(full)) {
        results.push(full);
      }
    }
  } catch (e) {
    // skip unreadable dirs
  }
  return results;
};

/**
 * Read a NUL-separated path list from stdin (as produced by
 * `git diff --cached --name-only --diff-filter=ACM -z`).
 *
 * Deletions never appear because of --diff-filter=ACM, and git-ignored files
 * are never staged, so both classes are naturally excluded.
 */
const filesFromStdin = () => {
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8'); // fd 0 = stdin
  } catch {
    return [];
  }
  return raw
    .split('\0')
    .map((s) => s.replace(/\r?\n$/, ''))
    .filter(Boolean)
    .map((rel) => path.join(ROOT, rel))
    .filter((abs) => {
      try {
        // Skip anything that no longer exists (e.g. staged then deleted on disk)
        return fs.statSync(abs).isFile() && shouldCheck(abs);
      } catch {
        return false;
      }
    });
};

const args = process.argv.slice(2);
const fix = args.includes('--fix');
const stagedOnly = args.includes('--staged');

const files = stagedOnly ? filesFromStdin() : walk(ROOT);

if (stagedOnly) {
  console.log(
    files.length === 0
      ? 'Encoding check: no staged files to check.'
      : 'Encoding check: ' + files.length + ' staged file(s).'
  );
}

let totalIssues = 0;
let fixedFiles = 0;
let badFiles = 0;

for (const file of files) {
  const result = scanFile(file, fix);
  if (result.error) {
    console.error('ERROR reading ' + path.relative(ROOT, result.file) + ': ' + result.error);
    continue;
  }
  if (result.fixed) {
    console.log('FIXED ' + path.relative(ROOT, result.file) + ' (' + result.count + ' chars)');
    fixedFiles++;
  } else if (result.issues && result.issues.length > 0) {
    console.log(
      'BAD ' +
        path.relative(ROOT, result.file) +
        ': ' +
        result.issues.map((i) => 'L' + i.line + ' ' + i.char + ' ' + i.code).join(', ')
    );
    totalIssues += result.issues.length;
    badFiles++;
  }
}

if (fix) {
  console.log('\nFixed ' + fixedFiles + ' files.');
} else if (totalIssues > 0) {
  console.log('\nFound ' + totalIssues + ' suspicious characters in ' + badFiles + ' files.');
  console.log('Run with --fix to strip known bad characters.');
  process.exit(1);
} else {
  console.log('Encoding check passed - no suspicious characters found.');
}
