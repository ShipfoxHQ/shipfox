import {basePath} from '@/url';

const poses = {
  foreman: {width: 465, height: 480},
  machine: {width: 702, height: 480},
  delivery: {width: 566, height: 480},
  door: {width: 556, height: 480},
} as const;

interface ShippyProps {
  pose: keyof typeof poses;
  className?: string;
}

// Decorative: every pose repeats what the text beside it already says, so it is hidden from
// assistive technology and dropped from the machine-readable Markdown.
export function Shippy({pose, className}: ShippyProps) {
  const {width, height} = poses[pose];
  return (
    <img
      src={`${basePath}/img/shippy/${pose}.webp`}
      alt=""
      aria-hidden="true"
      width={width}
      height={height}
      loading={pose === 'foreman' ? 'eager' : 'lazy'}
      className={`not-prose pointer-events-none h-auto select-none ${className ?? ''}`}
    />
  );
}
