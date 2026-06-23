import {type CustomIconProps, SvgIcon} from './svg-icon-props.js';

export function ThunderIcon(props: CustomIconProps) {
  return (
    <SvgIcon
      viewBox="0 0 25 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      defaultWidth={25}
      defaultHeight={24}
      {...props}
    >
      <path d="M14.2707 10.1872H19.5832L10.729 22V13.8219H5.4165L14.2707 2V10.1872Z" />
    </SvgIcon>
  );
}
