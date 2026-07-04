import {TextDecoder} from 'node:util';
import {redactSecrets, safeRedactionPrefixLength} from '@shipfox/redact';
import {type OutputSource, PIPES} from '#core/framing.js';
import {couldBeMarker, parseMarker} from '#core/markers.js';
import {buildSecretVariants, mergeSecretVariants} from '#core/secrets.js';

/** What the transform hands the framer: masked output text, or a swallowed group marker. */
export type TransformEvent =
  | {type: 'output'; src: OutputSource; data: string}
  | {type: 'group_start'; name: string}
  | {type: 'group_end'};

// A `::`-leading partial line is held until its newline so a real marker can be swallowed.
// A group name is capped far below this by the DTO, so a `::`-leading run this long with no
// newline is not a real marker and is released as output to keep the hold bounded.
const MARKER_CANDIDATE_LIMIT = 16 * 1024;

interface SourceState {
  decoder: TextDecoder;
  buffer: string;
}

/**
 * The transform stage between capture and the spool. Per pipe it decodes bytes, masks
 * secrets, and turns `::group::`/`::endgroup::` lines into control events. It streams output
 * continuously rather than buffering whole lines: complete lines flush immediately (a `\n` is
 * a safe secret boundary), and an unterminated line still streams its masked safe prefix with
 * a rolling lookbehind, so no-newline output (progress bars) reaches the spool live and frame
 * timestamps stay at capture time.
 *
 * Masking delegates to `@shipfox/redact`; the only streaming-specific logic here is the
 * lookbehind boundary (safeEmitLength), which guarantees a secret split across chunk or flush
 * boundaries is never emitted unmasked. Registered-secret masking is the hard guarantee;
 * redactSecrets' URL-credential scrubbing needs a whole line and so is best-effort across a
 * forced mid-line flush.
 */
export class LogTransformer {
  private variants: string[];
  private readonly sources: Record<OutputSource, SourceState>;

  constructor(secrets: string[]) {
    // The variant set is shared across pipes (secrets are global), but the per-pipe decoder and
    // line buffer are independent: stdout and stderr are separate byte streams that must never
    // complete each other's partial sequences or split secrets.
    this.variants = buildSecretVariants(secrets);
    this.sources = {
      stdout: {decoder: newDecoder(), buffer: ''},
      stderr: {decoder: newDecoder(), buffer: ''},
    };
  }

  addSecrets(secrets: string[]): void {
    if (secrets.length === 0) return;
    this.variants = mergeSecretVariants(this.variants, secrets);
  }

  setSecrets(secrets: string[]): void {
    this.variants = buildSecretVariants(secrets);
  }

  push(chunk: Buffer, source: OutputSource): TransformEvent[] {
    const state = this.sources[source];
    state.buffer += state.decoder.decode(chunk, {stream: true});
    return this.drain(source, false);
  }

  /** Flushes each pipe's held partial line and trailing decoder state at stream close. */
  flush(): TransformEvent[] {
    const events: TransformEvent[] = [];
    for (const source of PIPES) {
      const state = this.sources[source];
      state.buffer += state.decoder.decode(); // a trailing partial multi-byte becomes U+FFFD
      this.drainInto(source, true, events);
    }
    return events;
  }

  private drain(source: OutputSource, final: boolean): TransformEvent[] {
    const events: TransformEvent[] = [];
    this.drainInto(source, final, events);
    return events;
  }

  private drainInto(source: OutputSource, final: boolean, events: TransformEvent[]): void {
    const state = this.sources[source];

    // Complete lines flush immediately: '\n' is a safe secret boundary, so each line is masked
    // whole with no carry, and markers (whole lines) are detected here.
    let newline = state.buffer.indexOf('\n');
    while (newline !== -1) {
      const line = state.buffer.slice(0, newline);
      state.buffer = state.buffer.slice(newline + 1);
      this.emitLine(line, source, events, {newline: true});
      newline = state.buffer.indexOf('\n');
    }

    if (state.buffer.length === 0) return;

    if (final) {
      // Stream closed: emit the remaining partial line masked, with no trailing newline.
      this.emitLine(state.buffer, source, events, {newline: false});
      state.buffer = '';
      return;
    }

    // Hold a `::`-leading partial whole until its newline so a real marker can be swallowed,
    // unless it has grown too large to be one.
    if (couldBeMarker(state.buffer) && state.buffer.length <= MARKER_CANDIDATE_LIMIT) return;

    // Otherwise stream the masked safe prefix and keep only the lookbehind carry.
    const cut = safeRedactionPrefixLength(state.buffer, this.variants);
    if (cut > 0) {
      events.push({
        type: 'output',
        src: source,
        data: redactSecrets(state.buffer.slice(0, cut), this.variants),
      });
      state.buffer = state.buffer.slice(cut);
    }
  }

  // Masks one complete line and routes it. A ::group::/::endgroup:: line becomes a control
  // event and is swallowed; everything else is an output event. Markers are matched on the raw
  // line (masking cannot create or destroy a `::` marker); only the extracted group name is
  // masked, so a secret in a name never reaches the record.
  private emitLine(
    line: string,
    source: OutputSource,
    events: TransformEvent[],
    opts: {newline: boolean},
  ): void {
    const marker = parseMarker(line);
    if (marker) {
      if (marker.kind === 'group_start') {
        events.push({type: 'group_start', name: redactSecrets(marker.name, this.variants)});
      } else {
        events.push({type: 'group_end'});
      }
      return;
    }
    const text = opts.newline ? `${line}\n` : line;
    if (text.length === 0) return;
    events.push({type: 'output', src: source, data: redactSecrets(text, this.variants)});
  }
}

function newDecoder(): TextDecoder {
  // ignoreBOM keeps a leading BOM as data (a default decoder strips it), and fatal:false turns
  // invalid sequences into U+FFFD instead of throwing inside the child-output handler, where it
  // would crash the runner.
  return new TextDecoder('utf-8', {ignoreBOM: true, fatal: false});
}
