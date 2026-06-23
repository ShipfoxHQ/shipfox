import {type CustomIconProps, SvgIcon} from './svg-icon-props.js';

export function EllipseMiniSolidIcon(props: CustomIconProps) {
  return (
    <SvgIcon
      viewBox="0 0 25 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      defaultWidth={25}
      defaultHeight={24}
      {...props}
    >
      <circle cx="12.2" cy="12.2" r="3.2" />
    </SvgIcon>
  );
}
