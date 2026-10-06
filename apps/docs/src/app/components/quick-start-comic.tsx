import {basePath} from '@/url';

const FRAMES = [
  {
    id: 'connect',
    label: 'Connect',
    alt: 'Shippy the fox hauls a huge coiled cable tagged MCP.',
  },
  {
    id: 'ask',
    label: 'Ask',
    alt: "Shippy whispers into a small robot's ear.",
  },
  {
    id: 'run',
    label: 'Run',
    alt: 'Shippy and the robot stare nervously at a terminal.',
  },
  {
    id: 'ship',
    label: 'Ship',
    alt: 'The robot hands Shippy a pull request and Shippy gives a thumbs up.',
  },
] as const;

export function QuickStartComic() {
  return (
    <ol className="not-prose grid list-none grid-cols-2 gap-cluster sm:grid-cols-4 lg:float-right lg:ms-region lg:w-40 lg:grid-cols-1">
      {FRAMES.map((frame, index) => (
        <li key={frame.id}>
          <figure>
            <img
              src={`${basePath}/img/quick-start/${frame.id}.webp`}
              alt={frame.alt}
              width={440}
              height={440}
              className="block aspect-square w-full [image-rendering:pixelated]"
            />
            <figcaption className="text-center font-mono text-fd-muted-foreground text-xs uppercase tracking-wide">
              <span className="text-fd-primary">{index + 1}</span> {frame.label}
            </figcaption>
          </figure>
        </li>
      ))}
    </ol>
  );
}
