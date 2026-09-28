// atob and btoa instead of node:buffer, so the package stays browser-safe.

const CHUNK_SIZE = 0x8000;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  // Chunked: spreading a large array into fromCharCode overflows the call stack.
  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK_SIZE));
  }
  return btoa(binary);
}

/** Standard padded base64 only. Returns `undefined` on anything else. */
export function decodeBase64(value: string): Uint8Array<ArrayBuffer> | undefined {
  if (!BASE64_PATTERN.test(value)) return undefined;
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
