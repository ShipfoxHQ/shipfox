export interface ServerSentMessage {
  event: string;
  data: string;
}

const LINE_BREAK_RE = /\r\n|\n|\r/;
const BYTE_ORDER_MARK = '﻿';

/** Builds messages from lines. A blank line ends one. */
class MessageBuilder {
  private eventType = '';
  private dataLines: string[] = [];

  /** Returns the message a blank line completes. */
  push(line: string): ServerSentMessage | undefined {
    if (line === '') return this.flush();
    if (line.startsWith(':')) return undefined;

    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    const rawValue = separator === -1 ? '' : line.slice(separator + 1);
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;
    if (field === 'event') this.eventType = value;
    else if (field === 'data') this.dataLines.push(value);
    return undefined;
  }

  private flush(): ServerSentMessage | undefined {
    const message =
      this.dataLines.length > 0
        ? {event: this.eventType || 'message', data: this.dataLines.join('\n')}
        : undefined;
    this.eventType = '';
    this.dataLines = [];
    return message;
  }
}

/** Splits decoded text into whole lines. The last, unfinished line stays in `rest`. */
class LineSplitter {
  private rest = '';
  private atStart = true;
  private endedWithCarriageReturn = false;

  push(chunk: string): string[] {
    let text = chunk;
    // A break of CR then LF can fall between two chunks, and its LF is not a blank line.
    const continuesBreak = this.endedWithCarriageReturn && text.startsWith('\n');
    if (continuesBreak) text = text.slice(1);
    if (text !== '' || continuesBreak) this.endedWithCarriageReturn = text.endsWith('\r');

    this.rest += text;
    if (this.atStart && this.rest !== '') {
      if (this.rest.startsWith(BYTE_ORDER_MARK)) this.rest = this.rest.slice(1);
      this.atStart = false;
    }
    const lines = this.rest.split(LINE_BREAK_RE);
    this.rest = lines.pop() ?? '';
    return lines;
  }
}

/**
 * Parses a `text/event-stream` body into messages, following the HTML living standard. Comments
 * and the `id` and `retry` fields are ignored, because the stream owns its own resume cursor.
 * A message cut off by the end of the stream is dropped, as a browser's `EventSource` does.
 */
export async function* parseServerSentEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ServerSentMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const splitter = new LineSplitter();
  const builder = new MessageBuilder();

  try {
    let chunk = await reader.read();
    while (!chunk.done) {
      for (const line of splitter.push(decoder.decode(chunk.value, {stream: true}))) {
        const message = builder.push(line);
        if (message) yield message;
      }
      chunk = await reader.read();
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
