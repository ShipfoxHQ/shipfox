import {existsSync} from 'node:fs';
import {join} from 'node:path';

export function qemuImagePath(rootDir: string): string {
  const image = process.env.SHIPFOX_QEMU_SOURCE_IMAGE;
  if (!image) {
    throw new Error('SHIPFOX_QEMU_SOURCE_IMAGE is required for a QEMU image build.');
  }
  return image.startsWith('/') ? image : join(rootDir, image);
}

export function qemuBootImagePath(rootDir: string): string {
  const image = join(rootDir, 'output', 'machine.raw');
  if (!existsSync(image))
    throw new Error(`QEMU image not found at ${image}. Build the image first.`);
  return image;
}
