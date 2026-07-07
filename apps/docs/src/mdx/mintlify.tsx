import {Accordion, Accordions} from 'fumadocs-ui/components/accordion';
import {Callout} from 'fumadocs-ui/components/callout';
import {Card, Cards} from 'fumadocs-ui/components/card';
import {ImageZoom} from 'fumadocs-ui/components/image-zoom';
import {Step, Steps} from 'fumadocs-ui/components/steps';
import {
  Book,
  BookOpen,
  Bot,
  Boxes,
  Bug,
  CircleCheck,
  Clipboard,
  Cloud,
  Code,
  Cpu,
  Download,
  FileText,
  GitBranch,
  Github,
  Laptop,
  Layers,
  ListChecks,
  type LucideIcon,
  Map as MapIcon,
  Plug,
  Puzzle,
  Rocket,
  RotateCw,
  SatelliteDish,
  Server,
  Sparkles,
  Terminal,
  WandSparkles,
  Webhook,
  Workflow,
  Wrench,
  Zap,
} from 'lucide-react';
import type {ComponentProps, ReactNode} from 'react';
import {basePath} from '@/url';

// Maps the Font Awesome icon names used by the Mintlify source to lucide icons,
// so ported `<Card icon="...">` markup renders unchanged. Unknown names fall
// back to no icon rather than breaking the build.
const ICONS: Record<string, LucideIcon> = {
  aws: Cloud,
  bolt: Zap,
  book: Book,
  'book-open': BookOpen,
  bug: Bug,
  clipboard: Clipboard,
  cloud: Cloud,
  code: Code,
  'code-branch': GitBranch,
  'circle-check': CircleCheck,
  'diagram-project': Workflow,
  dharmachakra: Boxes,
  download: Download,
  'file-lines': FileText,
  github: Github,
  laptop: Laptop,
  'layer-group': Layers,
  'list-check': ListChecks,
  map: MapIcon,
  microchip: Cpu,
  plug: Plug,
  'puzzle-piece': Puzzle,
  robot: Bot,
  rocket: Rocket,
  rotate: RotateCw,
  'satellite-dish': SatelliteDish,
  server: Server,
  sparkles: Sparkles,
  terminal: Terminal,
  'wand-magic-sparkles': WandSparkles,
  webhook: Webhook,
  wrench: Wrench,
};

function iconNode(icon?: string): ReactNode {
  if (!icon) return undefined;
  const Icon = ICONS[icon];
  return Icon ? <Icon className="size-4" /> : undefined;
}

type MintCardProps = {
  title: ReactNode;
  icon?: string;
  href?: string;
  children?: ReactNode;
};

function MintCard({title, icon, href, children}: MintCardProps) {
  return (
    <Card title={title} icon={iconNode(icon)} href={href}>
      {children}
    </Card>
  );
}

function MintCardGroup({children}: {children?: ReactNode}) {
  return <Cards>{children}</Cards>;
}

const calloutOf = (type: 'info' | 'warn') => {
  function MintCallout({children}: {children?: ReactNode}) {
    return <Callout type={type}>{children}</Callout>;
  }
  return MintCallout;
};

function MintStep({title, children}: {title?: ReactNode; children?: ReactNode}) {
  return (
    <Step>
      {title ? <div className="font-medium text-fd-foreground">{title}</div> : null}
      {children}
    </Step>
  );
}

function MintAccordionGroup({children}: {children?: ReactNode}) {
  return <Accordions type="single">{children}</Accordions>;
}

function MintAccordion({title, children}: {title: string; children?: ReactNode}) {
  return <Accordion title={title}>{children}</Accordion>;
}

function MintFrame({caption, children}: {caption?: ReactNode; children?: ReactNode}) {
  return (
    <figure className="rounded-lg border border-fd-border bg-fd-card p-2">
      {children}
      {caption ? (
        <figcaption className="mt-2 text-center text-sm text-fd-muted-foreground">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

type ParamFieldProps = {
  path?: string;
  body?: string;
  query?: string;
  name?: string;
  type?: string;
  required?: boolean;
  default?: string;
  children?: ReactNode;
};

function ParamField({
  path,
  body,
  query,
  name,
  type,
  required,
  default: def,
  children,
}: ParamFieldProps) {
  const label = path ?? body ?? query ?? name;
  return (
    <div className="my-3 rounded-lg border border-fd-border bg-fd-card/40 p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {label ? <code className="text-sm font-medium text-fd-foreground">{label}</code> : null}
        {type ? <span className="font-mono text-xs text-fd-muted-foreground">{type}</span> : null}
        {required ? (
          <span className="rounded bg-fd-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fd-primary">
            required
          </span>
        ) : null}
        {def !== undefined ? (
          <span className="font-mono text-xs text-fd-muted-foreground">default: {def}</span>
        ) : null}
      </div>
      {children ? <div className="mt-1.5 text-sm text-fd-muted-foreground">{children}</div> : null}
    </div>
  );
}

// Prefixes root-relative asset paths with the basePath (the app is served under
// /docs) so ported markdown can keep clean `/img/...` sources, and keeps the
// Fumadocs click-to-zoom behaviour.
export function MintImage({src, ...props}: ComponentProps<'img'>) {
  const resolved =
    typeof src === 'string' && src.startsWith('/') ? `${basePath}${src}` : (src ?? '');
  // biome-ignore lint/suspicious/noExplicitAny: bridge intrinsic img props to fumadocs ImageZoom
  return <ImageZoom src={resolved as any} {...(props as any)} />;
}

export const mintlifyComponents = {
  Card: MintCard,
  CardGroup: MintCardGroup,
  Note: calloutOf('info'),
  Info: calloutOf('info'),
  Tip: calloutOf('info'),
  Warning: calloutOf('warn'),
  Step: MintStep,
  Steps,
  AccordionGroup: MintAccordionGroup,
  Accordion: MintAccordion,
  Frame: MintFrame,
  ParamField,
};
