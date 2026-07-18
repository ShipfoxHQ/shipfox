import {join} from 'node:path';

export function qemuSourceImageArgs(rootDir: string, env = process.env): string[] {
  const image = env.SHIPFOX_QEMU_SOURCE_IMAGE;
  if (!image) return [];

  const checksum = env.SHIPFOX_QEMU_SOURCE_CHECKSUM;
  if (!checksum) {
    throw new Error(
      'SHIPFOX_QEMU_SOURCE_CHECKSUM is required when SHIPFOX_QEMU_SOURCE_IMAGE is set.',
    );
  }
  const source = image.startsWith('/') ? image : join(rootDir, image);
  return ['-var', `qemu_source_image=${source}`, '-var', `qemu_source_checksum=${checksum}`];
}
