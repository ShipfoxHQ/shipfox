import {cn} from '@shipfox/react-ui/utils';

// `new URL(..., import.meta.url)` keeps each file a static asset reference the
// bundler can fingerprint, and it resolves the same from `src` and from `dist`.
const poses = {
  welcome: {
    width: 230,
    height: 240,
    src: new URL('../../assets/shippy/welcome.webp', import.meta.url).href,
  },
  bench: {
    width: 295,
    height: 240,
    src: new URL('../../assets/shippy/bench.webp', import.meta.url).href,
  },
  nameplate: {
    width: 259,
    height: 240,
    src: new URL('../../assets/shippy/nameplate.webp', import.meta.url).href,
  },
  lost: {
    width: 318,
    height: 320,
    src: new URL('../../assets/shippy/lost.webp', import.meta.url).href,
  },
  extinguisher: {
    width: 332,
    height: 320,
    src: new URL('../../assets/shippy/extinguisher.webp', import.meta.url).href,
  },
  lot: {
    width: 272,
    height: 240,
    src: new URL('../../assets/shippy/lot.webp', import.meta.url).href,
  },
  button: {
    width: 640,
    height: 240,
    src: new URL('../../assets/shippy/button.webp', import.meta.url).href,
  },
  switchboard: {
    width: 360,
    height: 240,
    src: new URL('../../assets/shippy/switchboard.webp', import.meta.url).href,
  },
  cartridge: {
    width: 269,
    height: 240,
    src: new URL('../../assets/shippy/cartridge.webp', import.meta.url).href,
  },
  party: {
    width: 297,
    height: 240,
    src: new URL('../../assets/shippy/party.webp', import.meta.url).href,
  },
} as const;

export type ShippyPose = keyof typeof poses;

export interface ShippyProps {
  pose: ShippyPose;
  /** Sets the rendered height, such as `h-96`. The width follows the pose. */
  className?: string | undefined;
}

// Decorative: every pose sits beside copy that already says the same thing, so
// it is hidden from assistive technology.
export function Shippy({pose, className}: ShippyProps) {
  const {src, width, height} = poses[pose];
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      width={width}
      height={height}
      draggable={false}
      data-slot="shippy"
      data-pose={pose}
      className={cn('pointer-events-none w-auto max-w-full shrink-0 select-none', className)}
    />
  );
}
