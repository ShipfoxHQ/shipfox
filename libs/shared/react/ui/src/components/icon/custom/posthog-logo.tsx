import {type CustomIconProps, SvgIcon} from './svg-icon-props.js';

/** Monochrome PostHog mark so the provider icon follows the active theme. */
export function PosthogLogo(props: CustomIconProps) {
  return (
    <SvgIcon viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M12 2.5a9.5 9.5 0 1 0 9.5 9.5H12V2.5Zm0 4.1v3.8H8.2A5.7 5.7 0 0 1 12 6.6Zm0 10.8a5.7 5.7 0 0 1-5.3-3.6H12v3.6Z" />
      <path d="M13.5 2.65V10H21a9.5 9.5 0 0 0-7.5-7.35Z" />
    </SvgIcon>
  );
}
