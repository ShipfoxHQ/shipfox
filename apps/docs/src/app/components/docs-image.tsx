import {ImageZoom} from 'fumadocs-ui/components/image-zoom';
import type {ComponentProps} from 'react';
import {basePath} from '@/url';

type ImageProps = ComponentProps<'img'>;

const withBase = (value?: ImageProps['src']) =>
  typeof value === 'string' && value.startsWith('/') ? `${basePath}${value}` : value;

interface DocsImageProps extends Omit<ImageProps, 'src'> {
  src?: ImageProps['src'];
  lightSrc?: string;
  darkSrc?: string;
}

export function DocsImage({src, lightSrc, darkSrc, ...props}: DocsImageProps) {
  const resolvedLightSrc = withBase(lightSrc ?? src ?? darkSrc);
  const resolvedDarkSrc = withBase(darkSrc ?? src ?? lightSrc);

  if (resolvedDarkSrc === resolvedLightSrc) {
    return <ZoomableImage src={resolvedLightSrc} {...props} />;
  }

  return (
    <>
      <span className="block dark:hidden">
        <ZoomableImage src={resolvedLightSrc} {...props} />
      </span>
      <span className="hidden dark:block">
        <ZoomableImage src={resolvedDarkSrc} {...props} />
      </span>
    </>
  );
}

function ZoomableImage({src, ...props}: ImageProps) {
  const className = props.className ? `rounded-lg ${props.className}` : 'rounded-lg';

  // biome-ignore lint/suspicious/noExplicitAny: bridge intrinsic img props to fumadocs ImageZoom
  return <ImageZoom src={src as any} {...(props as any)} className={className} />;
}
