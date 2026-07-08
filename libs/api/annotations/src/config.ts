import {createConfig, num} from '@shipfox/config';

export const config = createConfig({
  ANNOTATIONS_MAX_BODY_BYTES: num({
    desc: 'Maximum UTF-8 byte size of one annotation body. Writes that would make an annotation body larger than this are rejected.',
    default: 1048576,
  }),
  ANNOTATIONS_MAX_PER_EXECUTION: num({
    desc: 'Maximum number of distinct annotation contexts one job execution may store.',
    default: 50,
  }),
  ANNOTATIONS_MAX_TOTAL_BYTES: num({
    desc: 'Maximum total UTF-8 bytes of annotation bodies one job execution may store.',
    default: 4194304,
  }),
});

for (const name of [
  'ANNOTATIONS_MAX_BODY_BYTES',
  'ANNOTATIONS_MAX_PER_EXECUTION',
  'ANNOTATIONS_MAX_TOTAL_BYTES',
] as const) {
  if (!Number.isInteger(config[name]) || config[name] < 1) {
    throw new Error(`${name} (${config[name]}) must be a whole number greater than 0.`);
  }
}
