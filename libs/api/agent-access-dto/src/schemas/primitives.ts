import {z} from 'zod';

export const idSchema = z.string().uuid();
export const dateTimeSchema = z.string().datetime();

const utf8Encoder = new TextEncoder();

export const utf8CappedString = (maxBytes: number) =>
  z
    .string()
    .max(maxBytes)
    .refine((value) => utf8Encoder.encode(value).byteLength <= maxBytes, {
      message: `String must contain at most ${maxBytes} UTF-8 bytes`,
    });

/** Rejects control characters, including C1 controls and the Unicode line separators. */
export function isSafeRefInput(value: string): boolean {
  return [...value].every((character) => {
    const code = character.codePointAt(0) ?? 0;
    return !(code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029);
  });
}
