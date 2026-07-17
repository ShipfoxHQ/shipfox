import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {selectVideoMedia} from './docs-video';

describe('selectVideoMedia', () => {
  const light = {src: '/light.mp4', poster: '/light.jpg'};
  const dark = {src: '/dark.mp4', poster: '/dark.jpg'};

  it('keeps the server and initial client render on the same media', () => {
    const serverMedia = selectVideoMedia({mounted: false, resolvedTheme: undefined, light, dark});
    const initialClientMedia = selectVideoMedia({
      mounted: false,
      resolvedTheme: 'dark',
      light,
      dark,
    });

    assert.deepEqual(initialClientMedia, serverMedia);
    assert.deepEqual(initialClientMedia, light);
  });

  it('uses the resolved dark theme after the client mounts', () => {
    const media = selectVideoMedia({mounted: true, resolvedTheme: 'dark', light, dark});

    assert.deepEqual(media, dark);
  });

  it('uses the resolved light theme after the client mounts', () => {
    const media = selectVideoMedia({mounted: true, resolvedTheme: 'light', light, dark});

    assert.deepEqual(media, light);
  });
});
