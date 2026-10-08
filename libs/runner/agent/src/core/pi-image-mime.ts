/** How much of a file's start `detectSupportedImageMimeType` looks at. */
export const SNIFF_BYTES = 4100;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const BMP_BITS_PER_PIXEL = [1, 4, 8, 16, 24, 32];

/**
 * Mirrors the image detection of pi's default `read` operations, which its package does not
 * export. Pi only treats a file as an image when this accepts it, so a looser check would send
 * text files that start with `BM` to the model as images. A GIF needs its full signature, which
 * is stricter than pi, for the same reason.
 */
export function detectSupportedImageMimeType(file: Uint8Array): string | null {
  const buffer = Buffer.from(file.buffer, file.byteOffset, Math.min(file.length, SNIFF_BYTES));
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return buffer[3] === 0xf7 ? null : 'image/jpeg';
  if (startsWith(buffer, PNG_SIGNATURE)) {
    return isPng(buffer) && !isAnimatedPng(buffer) ? 'image/png' : null;
  }
  if (startsWithAscii(buffer, 0, 'GIF87a') || startsWithAscii(buffer, 0, 'GIF89a')) {
    return 'image/gif';
  }
  if (startsWithAscii(buffer, 0, 'RIFF') && startsWithAscii(buffer, 8, 'WEBP')) return 'image/webp';
  if (startsWithAscii(buffer, 0, 'BM') && isBmp(buffer)) return 'image/bmp';
  return null;
}

function isPng(buffer: Buffer): boolean {
  return (
    buffer.length >= 16 &&
    buffer.readUInt32BE(PNG_SIGNATURE.length) === 13 &&
    startsWithAscii(buffer, 12, 'IHDR')
  );
}

function isAnimatedPng(buffer: Buffer): boolean {
  let offset = PNG_SIGNATURE.length;
  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32BE(offset);
    if (startsWithAscii(buffer, offset + 4, 'acTL')) return true;
    if (startsWithAscii(buffer, offset + 4, 'IDAT')) return false;
    const nextOffset = offset + 8 + chunkLength + 4;
    if (nextOffset > buffer.length) return false;
    offset = nextOffset;
  }
  return false;
}

function isBmp(buffer: Buffer): boolean {
  if (buffer.length < 26) return false;
  const declaredFileSize = buffer.readUInt32LE(2);
  const pixelDataOffset = buffer.readUInt32LE(10);
  const dibHeaderSize = buffer.readUInt32LE(14);
  if (declaredFileSize !== 0 && declaredFileSize < 26) return false;
  if (pixelDataOffset < 14 + dibHeaderSize) return false;
  if (declaredFileSize !== 0 && pixelDataOffset >= declaredFileSize) return false;

  let colorPlanes: number;
  let bitsPerPixel: number;
  if (dibHeaderSize === 12) {
    colorPlanes = buffer.readUInt16LE(22);
    bitsPerPixel = buffer.readUInt16LE(24);
  } else if (dibHeaderSize >= 40 && dibHeaderSize <= 124) {
    if (buffer.length < 30) return false;
    colorPlanes = buffer.readUInt16LE(26);
    bitsPerPixel = buffer.readUInt16LE(28);
  } else {
    return false;
  }
  return colorPlanes === 1 && BMP_BITS_PER_PIXEL.includes(bitsPerPixel);
}

function startsWith(buffer: Buffer, bytes: readonly number[]): boolean {
  return buffer.length >= bytes.length && bytes.every((byte, index) => buffer[index] === byte);
}

function startsWithAscii(buffer: Buffer, offset: number, text: string): boolean {
  if (buffer.length < offset + text.length) return false;
  for (let index = 0; index < text.length; index++) {
    if (buffer[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}
