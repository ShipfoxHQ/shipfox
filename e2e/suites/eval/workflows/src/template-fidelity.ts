const HEADER_LINE = /^\s*#\s*(shipfox-template|yaml-language-server):/u;
// A slot, or an option line the guide has the agent settle, such as `draft: true # option:pr_mode`.
const FILLED_MARKER = /#\s*(?:slot|option):[A-Za-z0-9_-]+\s*$/u;
const BIND_LINE =
  /^(.*\b(?:source|connection):\s*)[A-Za-z0-9_-]+(\s+#\s*bind:[A-Za-z0-9_-]+)?\s*$/u;
const BIND_MARKER = /#\s*bind:[A-Za-z0-9_-]+\s*$/u;
const MODEL_LINE = /^\s*model\s*:\s*\S/u;
const MODEL_MARKER = /#\s*model:[A-Za-z0-9_-]+\s*$/u;
const MODEL_COMPANION_LINE = /^\s*(provider|thinking|harness)\s*:\s*\S/u;
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/gu;

/**
 * One line of the expected workflow. `slot` lines are filled by the agent with any number of
 * lines, `bind` lines take the slug of the workspace's connection, and `model` lines take the
 * model it chose. Every other line must appear as it is.
 */
type ExpectedLine =
  | {kind: 'exact'; text: string}
  | {kind: 'bind'; pattern: RegExp; text: string}
  | {kind: 'model'; text: string}
  | {kind: 'slot'; text: string};

export interface FidelityDifference {
  /** `missing` is a template line the agent dropped or changed; `added` is a line it introduced. */
  kind: 'missing' | 'added';
  line: string;
}

function escapeRegExp(text: string): string {
  return text.replace(REGEX_SPECIALS, '\\$&');
}

function significantLines(yaml: string): string[] {
  return yaml
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '' && !HEADER_LINE.test(line));
}

function classify(line: string): ExpectedLine {
  if (FILLED_MARKER.test(line)) return {kind: 'slot', text: line};
  const bind = BIND_MARKER.test(line) ? BIND_LINE.exec(line) : null;
  if (bind?.[1] !== undefined) {
    return {
      kind: 'bind',
      pattern: new RegExp(
        `^${escapeRegExp(bind[1])}[A-Za-z0-9_-]+(\\s+#\\s*bind:[A-Za-z0-9_-]+)?\\s*$`,
        'u',
      ),
      text: line,
    };
  }
  if (MODEL_LINE.test(line) && MODEL_MARKER.test(line)) return {kind: 'model', text: line};
  return {kind: 'exact', text: line};
}

function matches(expected: ExpectedLine, written: string): boolean {
  switch (expected.kind) {
    case 'exact':
      return expected.text === written;
    case 'bind':
      return expected.pattern.test(written);
    case 'model':
      return MODEL_LINE.test(written);
    case 'slot':
      return false;
  }
}

/** The pairs of the longest common subsequence, as `[expected index, written index]`. */
function align(expected: ExpectedLine[], written: string[]): Array<[number, number]> {
  const width = written.length + 1;
  const table = new Array<number>((expected.length + 1) * width).fill(0);
  const at = (row: number, column: number): number => table[row * width + column] ?? 0;
  for (let row = expected.length - 1; row >= 0; row -= 1) {
    for (let column = written.length - 1; column >= 0; column -= 1) {
      const line = expected[row];
      const candidate = written[column];
      const common = line !== undefined && candidate !== undefined && matches(line, candidate);
      table[row * width + column] = common
        ? at(row + 1, column + 1) + 1
        : Math.max(at(row + 1, column), at(row, column + 1));
    }
  }
  const pairs: Array<[number, number]> = [];
  let row = 0;
  let column = 0;
  while (row < expected.length && column < written.length) {
    const line = expected[row];
    const candidate = written[column];
    if (line !== undefined && candidate !== undefined && matches(line, candidate)) {
      pairs.push([row, column]);
      row += 1;
      column += 1;
    } else if (at(row + 1, column) >= at(row, column + 1)) {
      row += 1;
    } else {
      column += 1;
    }
  }
  return pairs;
}

/** The lines between two matched pairs. The agent's own lines are fine where a slot or model line was. */
function gapDifferences({
  expected,
  written,
}: {
  expected: ExpectedLine[];
  written: string[];
}): FidelityDifference[] {
  const hasSlot = expected.some((line) => line.kind === 'slot');
  const hasModel = expected.some((line) => line.kind === 'model');
  const missing = expected
    .filter((line) => line.kind !== 'slot')
    .map((line): FidelityDifference => ({kind: 'missing', line: line.text}));
  const added = written
    .filter((line) => !(hasSlot || (hasModel && MODEL_COMPANION_LINE.test(line))))
    .map((line): FidelityDifference => ({kind: 'added', line}));
  return [...missing, ...added];
}

/**
 * Compares the workflow the agent wrote with the variant the case expects. The header lines are
 * left out, because the header check reads them. Slot lines, connection slugs after a
 * `# bind:` marker, and model lines may differ, since the agent fills them in. Any other
 * difference means the agent edited the template body.
 */
export function diffAgainstTemplate({
  expectedYaml,
  writtenYaml,
}: {
  expectedYaml: string;
  writtenYaml: string;
}): FidelityDifference[] {
  const expected = significantLines(expectedYaml).map(classify);
  const written = significantLines(writtenYaml);
  const pairs = align(expected, written);

  const differences: FidelityDifference[] = [];
  let expectedStart = 0;
  let writtenStart = 0;
  for (const [expectedIndex, writtenIndex] of [
    ...pairs,
    [expected.length, written.length] as const,
  ]) {
    differences.push(
      ...gapDifferences({
        expected: expected.slice(expectedStart, expectedIndex),
        written: written.slice(writtenStart, writtenIndex),
      }),
    );
    expectedStart = expectedIndex + 1;
    writtenStart = writtenIndex + 1;
  }
  return differences;
}
