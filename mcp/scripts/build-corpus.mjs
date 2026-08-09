#!/usr/bin/env node
/**
 * Bundle the documentation corpus into mcp/corpus/ so the published npm package is
 * self-contained, and vendor the stack detector alongside it.
 *
 * Run automatically on `npm pack` / `npm publish` via the prepack script.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(PKG_ROOT, '..');

const CORPUS = path.join(PKG_ROOT, 'corpus');
const VENDOR = path.join(PKG_ROOT, 'src', 'vendor');

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function copyMarkdown(srcDir, destDir) {
  let count = 0;
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      count += copyMarkdown(src, dest);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      count++;
    }
  }
  return count;
}

rmrf(CORPUS);
fs.mkdirSync(CORPUS, { recursive: true });

let total = 0;

const skills = path.join(REPO_ROOT, 'skills');
if (fs.existsSync(skills)) total += copyMarkdown(skills, CORPUS);

const docs = path.join(REPO_ROOT, 'docs');
if (fs.existsSync(docs)) total += copyMarkdown(docs, path.join(CORPUS, 'docs'));

// vendor the detector so fivemDetectStack works from the published package
const detector = path.join(REPO_ROOT, 'scripts', 'detect-stack.mjs');
if (fs.existsSync(detector)) {
  fs.mkdirSync(VENDOR, { recursive: true });
  fs.copyFileSync(detector, path.join(VENDOR, 'detect-stack.mjs'));
  console.log('vendored detect-stack.mjs');
}

console.log(`corpus built: ${total} markdown files -> ${path.relative(REPO_ROOT, CORPUS)}`);

if (total === 0) {
  console.error('ERROR: no documentation found. Are you running this from the repo?');
  process.exit(1);
}
