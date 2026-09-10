import {type CustomIconProps, SvgIcon} from './svg-icon-props.js';

/** Monochrome ClickUp mark so the provider icon follows the active theme. */
export function ClickUpLogo(props: CustomIconProps) {
  return (
    <SvgIcon viewBox="0 0 48 48" fill="currentColor" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M4 36.878l7.38-5.656c3.922 5.12 8.088 7.478 12.726 7.478 4.614 0 8.66-2.332 12.406-7.408L44 36.81C38.596 44.13 31.882 48 24.106 48 16.356 48 9.576 44.156 4 36.878Z" />
      <path d="M24.08 12.3 10.944 23.62l-6.072-7.04L24.11 0l19.086 16.592-6.1 7.018L24.08 12.3Z" />
    </SvgIcon>
  );
}
