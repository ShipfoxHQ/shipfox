import {cn} from '@shipfox/react-ui/utils';
import {useSyncExternalStore} from 'react';
import type {ShippyState} from '#runtime/shippy-status.js';

// One row of 72x64 cells, drawn at one image pixel per CSS pixel and scaled without smoothing.
// Frames: 0 stands, 1 and 2 flick the tail, 3 hides the cursor, 4 and 5 lower the head with the
// cursor on and off, and 6 to 8 wave.
const SPRITE = new URL('../../assets/shippy/sprite.png', import.meta.url).href;
const CELL_WIDTH = 72;
const CELL_HEIGHT = 64;
const FRAMES = 9;

const frame = (index: number) => `background-position: ${-index * CELL_WIDTH}px 0;`;

// Every animation holds each frame with `steps(1, end)`, so motion is a cut between drawn frames,
// never an eased slide.
const css = `
@keyframes shippy-idle {
  0% { ${frame(0)} }
  96.875% { ${frame(1)} }
  97.917% { ${frame(2)} }
  98.958% { ${frame(1)} }
  100% { ${frame(0)} }
}
@keyframes shippy-working {
  0% { ${frame(0)} }
  25% { ${frame(3)} }
  50% { ${frame(4)} }
  75% { ${frame(5)} }
  100% { ${frame(0)} }
}
@keyframes shippy-wave {
  0% { ${frame(6)} }
  16.667% { ${frame(7)} }
  33.333% { ${frame(8)} }
  50% { ${frame(7)} }
  66.667% { ${frame(8)} }
  83.333% { ${frame(6)} }
  100% { ${frame(0)} }
}
[data-slot='shippy-sprite'][data-state='idle'] {
  animation: shippy-idle 12s steps(1, end) infinite;
}
[data-slot='shippy-sprite'][data-state='working'] {
  animation: shippy-working 1.6s steps(1, end) infinite;
}
[data-slot='shippy-sprite'][data-state='reply_ready'],
[data-slot='shippy-sprite'][data-state='greeting'] {
  animation: shippy-wave 1s steps(1, end) forwards;
}
[data-slot='shippy-sprite'][data-paused] {
  animation-play-state: paused;
}
@media (prefers-reduced-motion: reduce) {
  [data-slot='shippy-sprite'] {
    animation: none !important;
  }
}
`;

function subscribeToVisibility(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

/** A hidden tab pauses the motion, so a wave that starts there plays when the user returns. */
function useDocumentHidden(): boolean {
  return useSyncExternalStore(
    subscribeToVisibility,
    () => document.visibilityState === 'hidden',
    () => false,
  );
}

export type ShippySpriteState = ShippyState | 'greeting';

/** Floating Shippy. `failed` shows the still first frame, so a failure looks like an idle page. */
export function ShippySprite({
  state,
  className,
}: {
  state: ShippySpriteState;
  className?: string | undefined;
}) {
  const hidden = useDocumentHidden();
  return (
    <>
      <style href="shipfox-shippy-sprite" precedence="default">
        {css}
      </style>
      <span
        aria-hidden="true"
        data-slot="shippy-sprite"
        data-state={state}
        data-paused={hidden ? '' : undefined}
        className={cn('block h-64 w-72 bg-no-repeat [image-rendering:pixelated]', className)}
        style={{
          backgroundImage: `url(${SPRITE})`,
          backgroundSize: `${CELL_WIDTH * FRAMES}px ${CELL_HEIGHT}px`,
          backgroundPosition: '0 0',
        }}
      />
    </>
  );
}
