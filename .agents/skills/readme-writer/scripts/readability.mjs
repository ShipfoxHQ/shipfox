#!/usr/bin/env node
/**
 * Readability audit for Shipfox package READMEs.
 *
 * Ported from Nate Berkopec's `readability` skill (Ruby) to ESM JavaScript so
 * it runs anywhere `node` is on the path. No external dependencies.
 *
 * Reports two numbers:
 *
 *  1. Flesch-Kincaid grade level:
 *       0.39 * (words / sentence) + 11.8 * (syllables / word) - 15.59
 *     Target <= 9 for ESL-friendly docs. Lower is easier to read.
 *
 *  2. Top-1000 coverage: percentage of running words that appear in the most
 *     common 1000 English words (sourced from `scripts/top1000.txt`). Target
 *     >= 60% in narrative prose (the script strips code blocks before
 *     scoring, but API identifiers in inline `code` still count as words).
 *
 * Usage:
 *   node scripts/readability.mjs <path-to-README.md>
 *   cat README.md | node scripts/readability.mjs
 */

import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {dirname, resolve} from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOP1000_PATH = resolve(HERE, "top1000.txt");

const FK_TARGET_GRADE = 9;
const COVERAGE_TARGET = 0.6;

/** Remove fenced code blocks and inline code spans. */
function stripCode(text) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ");
}

/** Split into alphabetic word tokens, lowercase. */
function wordsIn(text) {
  return text
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z]/g, "").toLowerCase())
    .filter((w) => w.length > 0);
}

/** Count sentence-ending punctuation runs, minimum of 1. */
function sentenceCount(text) {
  const matches = text.match(/[.!?]+/g);
  return Math.max(matches ? matches.length : 0, 1);
}

/**
 * Count syllables in a single token using the same naive heuristic as the
 * Ruby reference: drop trailing silent `e` (unless the word ends in `le`),
 * then count vowel groups. Minimum of 1 per word.
 */
function syllablesIn(word) {
  let token = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!token) return 0;
  if (!(token.endsWith("le") && token.length > 2)) {
    token = token.replace(/e$/, "");
  }
  const groups = token.match(/[aeiouy]+/g);
  return Math.max(groups ? groups.length : 0, 1);
}

function fleschKincaidGrade(text) {
  const prose = stripCode(text);
  const words = wordsIn(prose);
  if (words.length === 0) return 0;
  const wps = words.length / sentenceCount(prose);
  const spw = words.reduce((sum, w) => sum + syllablesIn(w), 0) / words.length;
  return 0.39 * wps + 11.8 * spw - 15.59;
}

async function loadTop1000() {
  const raw = await readFile(TOP1000_PATH, "utf8");
  return new Set(
    raw
      .split(/\r?\n/)
      .map((w) => w.trim().toLowerCase())
      .filter((w) => w.length > 0),
  );
}

function vocabularyCoverage(text, top1000) {
  const words = wordsIn(stripCode(text));
  if (words.length === 0) return {coverage: 0, common: 0, total: 0, uncommon: []};
  const uncommon = new Map();
  let common = 0;
  for (const w of words) {
    if (top1000.has(w)) {
      common++;
    } else {
      uncommon.set(w, (uncommon.get(w) ?? 0) + 1);
    }
  }
  const ranked = [...uncommon.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
  return {
    coverage: common / words.length,
    common,
    total: words.length,
    uncommon: ranked,
  };
}

async function readSource(arg) {
  if (arg) return readFile(arg, "utf8");
  return new Promise((res, rej) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (buf += chunk));
    process.stdin.on("end", () => res(buf));
    process.stdin.on("error", rej);
  });
}

async function main() {
  const [, , file] = process.argv;
  const text = await readSource(file);

  const grade = fleschKincaidGrade(text);
  const top1000 = await loadTop1000();
  const {coverage, common, total, uncommon} = vocabularyCoverage(text, top1000);

  const gradeOk = grade <= FK_TARGET_GRADE;
  const covOk = coverage >= COVERAGE_TARGET;

  const label = file ?? "<stdin>";
  console.log(`README readability: ${label}`);
  console.log("");
  console.log(
    `  Flesch-Kincaid grade : ${grade.toFixed(1)}  ` +
      `(target <= ${FK_TARGET_GRADE})  ${gradeOk ? "OK" : "HIGH"}`,
  );
  console.log(
    `  Top-1000 coverage    : ${(coverage * 100).toFixed(1)}%  ` +
      `(${common}/${total} words, target >= ${(COVERAGE_TARGET * 100).toFixed(0)}%)  ${covOk ? "OK" : "LOW"}`,
  );

  if (uncommon.length > 0) {
    console.log("");
    console.log("  Most common words outside the top-1000 list:");
    for (const [word, count] of uncommon) {
      console.log(`    ${count.toString().padStart(3)}  ${word}`);
    }
    console.log(
      "  Project identifiers (Shipfox, Drizzle, Fastify, etc.) are expected.",
    );
    console.log(
      "  Plain prose around them should still read like everyday English.",
    );
  }

  if (!gradeOk || !covOk) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
