import {detectSupportedImageMimeType} from '#core/pi-image-mime.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngChunk(type: string, data = Buffer.alloc(0)): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]);
}

function png(...chunkTypes: string[]): Buffer {
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', Buffer.alloc(13)),
    ...chunkTypes.map((type) => pngChunk(type)),
  ]);
}

function bmp(): Buffer {
  const file = Buffer.alloc(60);
  file.write('BM', 0, 'ascii');
  file.writeUInt32LE(file.length, 2);
  file.writeUInt32LE(54, 10);
  file.writeUInt32LE(40, 14);
  file.writeUInt16LE(1, 26);
  file.writeUInt16LE(24, 28);
  return file;
}

describe('detectSupportedImageMimeType', () => {
  it.each([
    ['a JPEG', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]), 'image/jpeg'],
    ['a PNG', png('IDAT'), 'image/png'],
    ['a GIF', Buffer.from('GIF89a'), 'image/gif'],
    ['a WebP', Buffer.from('RIFF\0\0\0\0WEBPVP8 '), 'image/webp'],
    ['a BMP', bmp(), 'image/bmp'],
  ])('recognizes %s', (_name, file, mimeType) => {
    expect(detectSupportedImageMimeType(file)).toBe(mimeType);
  });

  it('rejects an animated PNG', () => {
    expect(detectSupportedImageMimeType(png('acTL', 'IDAT'))).toBeNull();
  });

  it('rejects a PNG without a header chunk', () => {
    expect(
      detectSupportedImageMimeType(Buffer.concat([PNG_SIGNATURE, Buffer.alloc(20)])),
    ).toBeNull();
  });

  it('rejects a text file that only starts like a BMP', () => {
    expect(
      detectSupportedImageMimeType(Buffer.from('BM25 ranking is a retrieval function.')),
    ).toBeNull();
  });

  it('rejects a file that is not an image', () => {
    expect(detectSupportedImageMimeType(Buffer.from('# Readme\n'))).toBeNull();
  });
});
