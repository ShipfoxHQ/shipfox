export type ShellFrame =
  | 'single'
  | 'double'
  | 'dollar-single'
  | 'dollar-double'
  | 'paren-sub'
  | 'arith'
  | 'backtick'
  | 'param-brace'
  | 'heredoc'
  | 'line-comment';

export type ShellUnsafeRegion = ShellFrame | 'escape';
interface ArithSquareFrame {
  readonly kind: 'arith-square';
  bracketDepth: number;
}
type ShellScanFrame = ShellFrame | ArithSquareFrame;

export type ShellSiteContext =
  | {readonly kind: 'unquoted' | 'single' | 'double'}
  | {readonly kind: 'unsafe'; readonly region: ShellUnsafeRegion};

export interface ShellScanState {
  readonly frames: readonly ShellScanFrame[];
  readonly pendingEscape?: boolean;
}

export const initialShellScanState: ShellScanState = {frames: []};

const shellCommentStarterPrefixPattern = /\s|[;&|()<>]/;

export function scanShellLiteral(text: string, state: ShellScanState): ShellScanState {
  const frames = [...state.frames];
  let pendingEscape = state.pendingEscape ?? false;
  let index = 0;

  while (index < text.length) {
    if (pendingEscape) {
      pendingEscape = false;
      index += 1;
      continue;
    }

    const frame = topFrame(frames);

    if (frame === 'single') {
      if (text[index] === "'") frames.pop();
      index += 1;
      continue;
    }

    if (frame === 'dollar-single') {
      if (text[index] === '\\') {
        ({index, pendingEscape} = skipShellEscape(text, index));
        continue;
      }

      if (text[index] === "'") frames.pop();
      index += 1;
      continue;
    }

    if (frame === 'backtick') {
      if (text[index] === '\\') {
        ({index, pendingEscape} = skipShellEscape(text, index));
        continue;
      }

      if (text[index] === '`') {
        frames.pop();
        index += 1;
        continue;
      }

      index = scanShellControlStart(text, index, frames);
      continue;
    }

    if (frame === 'double' || frame === 'dollar-double') {
      if (text[index] === '\\') {
        ({index, pendingEscape} = skipShellEscape(text, index));
        continue;
      }

      if (text[index] === '"') {
        frames.pop();
        index += 1;
        continue;
      }

      if (text[index] === '`') {
        frames.push('backtick');
        index += 1;
        continue;
      }

      index = scanShellControlStart(text, index, frames);
      continue;
    }

    if (frame === 'param-brace') {
      if (text[index] === '\\') {
        ({index, pendingEscape} = skipShellEscape(text, index));
        continue;
      }

      if (text[index] === '}') {
        frames.pop();
        index += 1;
        continue;
      }

      if (text[index] === '`') {
        frames.push('backtick');
        index += 1;
        continue;
      }

      index = scanShellControlStart(text, index, frames);
      continue;
    }

    if (frame === 'paren-sub') {
      if (text[index] === '\\') {
        ({index, pendingEscape} = skipShellEscape(text, index));
        continue;
      }

      if (text[index] === ')') {
        frames.pop();
        index += 1;
        continue;
      }

      index = scanShellPlainStart(text, index, frames);
      continue;
    }

    if (frame === 'arith') {
      if (text.startsWith('))', index)) {
        frames.pop();
        index += 2;
        continue;
      }

      if (text[index] === '\\') {
        ({index, pendingEscape} = skipShellEscape(text, index));
        continue;
      }

      index = scanShellPlainStart(text, index, frames);
      continue;
    }

    if (frame === 'heredoc') {
      index += 1;
      continue;
    }

    if (frame === 'line-comment') {
      if (text[index] === '\n') frames.pop();
      index += 1;
      continue;
    }

    if (isArithSquareFrame(frame)) {
      if (text[index] === '[') {
        frame.bracketDepth += 1;
        index += 1;
        continue;
      }

      if (text[index] === ']') {
        if (frame.bracketDepth === 0) {
          frames.pop();
        } else {
          frame.bracketDepth -= 1;
        }
        index += 1;
        continue;
      }

      if (text[index] === '\\') {
        ({index, pendingEscape} = skipShellEscape(text, index));
        continue;
      }

      index = scanShellPlainStart(text, index, frames);
      continue;
    }

    if (text[index] === '\\') {
      ({index, pendingEscape} = skipShellEscape(text, index));
      continue;
    }

    index = scanShellPlainStart(text, index, frames);
  }

  return pendingEscape ? {frames, pendingEscape} : {frames};
}

export function classifyShellSite(state: ShellScanState): ShellSiteContext {
  if (state.pendingEscape === true) return {kind: 'unsafe', region: 'escape'};
  if (state.frames.length === 0) return {kind: 'unquoted'};
  if (state.frames.length === 1 && state.frames[0] === 'single') return {kind: 'single'};
  if (state.frames.length === 1 && state.frames[0] === 'double') return {kind: 'double'};

  return {kind: 'unsafe', region: findUnsafeRegion(state.frames)};
}

function scanShellPlainStart(text: string, index: number, frames: ShellScanFrame[]): number {
  if (startsShellLineComment(text, index)) {
    frames.push('line-comment');
    return index + 1;
  }

  if (text.startsWith('<<', index)) {
    frames.push('heredoc');
    return text.startsWith('<<-', index) ? index + 3 : index + 2;
  }

  if (text.startsWith('$((', index)) {
    frames.push('arith');
    return index + 3;
  }

  if (text.startsWith('$[', index)) {
    frames.push({kind: 'arith-square', bracketDepth: 0});
    return index + 2;
  }

  if (text.startsWith('$(', index)) {
    frames.push('paren-sub');
    return index + 2;
  }

  if (text.startsWith('${', index)) {
    frames.push('param-brace');
    return index + 2;
  }

  if (text.startsWith("$'", index)) {
    frames.push('dollar-single');
    return index + 2;
  }

  if (text.startsWith('$"', index)) {
    frames.push('dollar-double');
    return index + 2;
  }

  if (text.startsWith('((', index)) {
    frames.push('arith');
    return index + 2;
  }

  if (text[index] === "'") {
    frames.push('single');
    return index + 1;
  }

  if (text[index] === '"') {
    frames.push('double');
    return index + 1;
  }

  if (text[index] === '`') {
    frames.push('backtick');
    return index + 1;
  }

  return index + 1;
}

function scanShellControlStart(text: string, index: number, frames: ShellScanFrame[]): number {
  if (text.startsWith('$((', index)) {
    frames.push('arith');
    return index + 3;
  }

  if (text.startsWith('$[', index)) {
    frames.push({kind: 'arith-square', bracketDepth: 0});
    return index + 2;
  }

  if (text.startsWith('$(', index)) {
    frames.push('paren-sub');
    return index + 2;
  }

  if (text.startsWith('${', index)) {
    frames.push('param-brace');
    return index + 2;
  }

  if (text.startsWith("$'", index)) {
    frames.push('dollar-single');
    return index + 2;
  }

  if (text.startsWith('$"', index)) {
    frames.push('dollar-double');
    return index + 2;
  }

  return index + 1;
}

function skipShellEscape(
  text: string,
  index: number,
): {readonly index: number; readonly pendingEscape: boolean} {
  if (index + 1 >= text.length) return {index: text.length, pendingEscape: true};
  return {index: index + 2, pendingEscape: false};
}

function topFrame(frames: readonly ShellScanFrame[]): ShellScanFrame | undefined {
  return frames.at(-1);
}

function findUnsafeRegion(frames: readonly ShellScanFrame[]): ShellFrame {
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const frame = frames[index];
    if (frame === undefined) continue;
    if (isArithSquareFrame(frame)) return 'arith';
    if (frame !== 'single' && frame !== 'double') return frame;
  }

  return 'heredoc';
}

function isArithSquareFrame(frame: ShellScanFrame | undefined): frame is ArithSquareFrame {
  return typeof frame === 'object' && frame.kind === 'arith-square';
}

function startsShellLineComment(text: string, index: number): boolean {
  if (text[index] !== '#') return false;
  if (index === 0) return true;

  const previous = text[index - 1];
  return previous === undefined || shellCommentStarterPrefixPattern.test(previous);
}
