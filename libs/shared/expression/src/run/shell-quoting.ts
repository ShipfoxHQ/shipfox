export type ShellFrame =
  | 'single'
  | 'double'
  | 'dollar-single'
  | 'dollar-double'
  | 'paren-sub'
  | 'arith'
  | 'backtick'
  | 'param-brace'
  | 'heredoc';

export type ShellSiteContext =
  | {readonly kind: 'unquoted' | 'single' | 'double'}
  | {readonly kind: 'unsafe'; readonly region: ShellFrame};

export interface ShellScanState {
  readonly frames: readonly ShellFrame[];
}

export const initialShellScanState: ShellScanState = {frames: []};

export function scanShellLiteral(text: string, state: ShellScanState): ShellScanState {
  const frames = [...state.frames];
  let index = 0;

  while (index < text.length) {
    const frame = topFrame(frames);

    if (frame === 'single') {
      if (text[index] === "'") frames.pop();
      index += 1;
      continue;
    }

    if (frame === 'dollar-single') {
      if (text[index] === '\\') {
        index += 2;
        continue;
      }

      if (text[index] === "'") frames.pop();
      index += 1;
      continue;
    }

    if (frame === 'backtick') {
      if (text[index] === '\\') {
        index += 2;
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
        index += 2;
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
        index += 2;
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
        index += 2;
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
        index += 2;
        continue;
      }

      index = scanShellPlainStart(text, index, frames);
      continue;
    }

    if (frame === 'heredoc') {
      index += 1;
      continue;
    }

    index = scanShellPlainStart(text, index, frames);
  }

  return {frames};
}

export function classifyShellSite(state: ShellScanState): ShellSiteContext {
  if (state.frames.length === 0) return {kind: 'unquoted'};
  if (state.frames.length === 1 && state.frames[0] === 'single') return {kind: 'single'};
  if (state.frames.length === 1 && state.frames[0] === 'double') return {kind: 'double'};

  return {kind: 'unsafe', region: findUnsafeRegion(state.frames)};
}

function scanShellPlainStart(text: string, index: number, frames: ShellFrame[]): number {
  if (text[index] === '\\') return index + 2;

  if (text.startsWith('<<', index)) {
    frames.push('heredoc');
    return text.startsWith('<<-', index) ? index + 3 : index + 2;
  }

  if (text.startsWith('$((', index)) {
    frames.push('arith');
    return index + 3;
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

function scanShellControlStart(text: string, index: number, frames: ShellFrame[]): number {
  if (text.startsWith('$((', index)) {
    frames.push('arith');
    return index + 3;
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

function topFrame(frames: readonly ShellFrame[]): ShellFrame | undefined {
  return frames.at(-1);
}

function findUnsafeRegion(frames: readonly ShellFrame[]): ShellFrame {
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const frame = frames[index];
    if (frame === undefined) continue;
    if (frame !== 'single' && frame !== 'double') return frame;
  }

  return 'heredoc';
}
