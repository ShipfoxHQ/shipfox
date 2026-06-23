import type {RemixiconComponentType} from '@remixicon/react';
import {type ComponentProps, createElement, type ReactNode} from 'react';

type SvgPassthroughProps = {
  height?: number | string | undefined;
  title?: string | undefined;
  width?: number | string | undefined;
};

export type CustomIconProps = Omit<ComponentProps<RemixiconComponentType>, 'children'> &
  SvgPassthroughProps;

type IconDimension = number | string;
type SvgIconProps = CustomIconProps & {
  children: ReactNode;
  defaultHeight?: IconDimension | undefined;
  defaultWidth?: IconDimension | undefined;
  fill?: string | undefined;
  viewBox?: string | undefined;
  xmlns?: string | undefined;
};

export function SvgIcon({children, defaultWidth, defaultHeight, ...props}: SvgIconProps) {
  return createElement(
    'svg',
    svgIconProps(props, defaultWidth, defaultHeight) as ComponentProps<'svg'>,
    children,
  );
}

export function svgIconProps(
  props: CustomIconProps,
  defaultWidth?: IconDimension,
  defaultHeight?: IconDimension,
) {
  const {size, width, height, ...restProps} = props;
  const resolvedWidth = width ?? size ?? defaultWidth;
  const resolvedHeight = height ?? size ?? defaultHeight ?? defaultWidth;

  return {
    ...restProps,
    'aria-hidden': svgAriaHidden(props),
    ...(resolvedWidth === undefined ? {} : {width: resolvedWidth}),
    ...(resolvedHeight === undefined ? {} : {height: resolvedHeight}),
  };
}

export function svgAriaHidden(props: CustomIconProps) {
  return (
    props['aria-hidden'] ??
    (props['aria-label'] === undefined && props['aria-labelledby'] === undefined ? true : undefined)
  );
}
