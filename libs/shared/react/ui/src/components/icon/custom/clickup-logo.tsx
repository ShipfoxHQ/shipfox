import {type CustomIconProps, SvgIcon} from './svg-icon-props.js';

/** Monochrome ClickUp mark so the provider icon follows the active theme. */
export function ClickUpLogo(props: CustomIconProps) {
  return (
    <SvgIcon viewBox="0 0 48 48" fill="currentColor" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M24 8.5c-3.24 0-6.25 1.28-8.48 3.6l-3.94-3.79C14.27 4.94 18.86 3 24 3s9.73 1.94 12.42 5.31l-3.94 3.79C30.25 9.78 27.24 8.5 24 8.5Z" />
      <path d="M24 45c-5.73 0-10.7-2.15-14.36-6.22C6.2 34.86 4.5 29.6 4.5 24c0-5.12 1.83-10.16 5.15-14.2l4.24 3.48C11.9 16.15 10 20.1 10 24c0 4.22 1.27 7.8 3.67 10.47C16 37.06 19.48 38.5 24 38.5s8-1.44 10.33-4.03C36.73 31.8 38 28.22 38 24c0-3.9-1.9-7.85-3.89-10.72l4.24-3.48c3.32 4.04 5.15 9.08 5.15 14.2 0 5.6-1.7 10.86-5.14 14.78C34.7 42.85 29.73 45 24 45Z" />
    </SvgIcon>
  );
}
