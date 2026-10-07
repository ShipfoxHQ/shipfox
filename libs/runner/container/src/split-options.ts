const WHITESPACE = /\s/u;
const DOUBLE_QUOTE_ESCAPABLE = new Set(['"', '\\', '$', '`']);

/**
 * Splits the `options` string of a job container into `docker create` arguments the way a POSIX
 * shell would, without expanding anything. Rejects an unterminated quote, so a typo fails setup
 * instead of reaching Docker as a mangled flag.
 */
export function splitOptions(options: string): string[] {
  const args: string[] = [];
  let index = 0;
  while (index < options.length) {
    if (WHITESPACE.test(options.charAt(index))) {
      index++;
      continue;
    }
    const word = readWord(options, index);
    args.push(word.value);
    index = word.end;
  }
  return args;
}

function readWord(options: string, start: number): {value: string; end: number} {
  let value = '';
  let index = start;
  while (index < options.length && !WHITESPACE.test(options.charAt(index))) {
    const char = options.charAt(index);
    if (char === "'" || char === '"') {
      const quoted = readQuoted(options, index);
      value += quoted.value;
      index = quoted.end;
    } else if (char === '\\' && index + 1 < options.length) {
      value += options.charAt(index + 1);
      index += 2;
    } else {
      value += char;
      index++;
    }
  }
  return {value, end: index};
}

// `start` is the opening quote. Single quotes keep everything; double quotes only unescape the
// characters a shell does.
function readQuoted(options: string, start: number): {value: string; end: number} {
  const quote = options.charAt(start);
  let value = '';
  let index = start + 1;
  while (index < options.length) {
    const char = options.charAt(index);
    if (char === quote) return {value, end: index + 1};
    const next = options.charAt(index + 1);
    if (quote === '"' && char === '\\' && DOUBLE_QUOTE_ESCAPABLE.has(next)) {
      value += next;
      index += 2;
    } else {
      value += char;
      index++;
    }
  }
  throw new Error(`The container options have an unterminated ${quote} quote.`);
}
