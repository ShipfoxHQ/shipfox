import {type CustomIconProps, SvgIcon} from './svg-icon-props.js';

/** Monochrome Notion mark so the provider icon follows the active theme. */
export function NotionLogo(props: CustomIconProps) {
  return (
    <SvgIcon viewBox="0 0 48 48" fill="currentColor" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M7 6h25l9 9v27H7V6Zm7 7v22h6V22l10 13h5V15h-6v13L19 13h-5Z" />
    </SvgIcon>
  );
}
