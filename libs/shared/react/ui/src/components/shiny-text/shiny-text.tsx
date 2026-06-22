import {cn} from '#utils/cn.js';

type ShinyTextProps = {
  text: string;
  disabled?: boolean;
  speed?: number;
  className?: string;
};

function ShinyText({text, disabled = false, speed = 5, className = ''}: ShinyTextProps) {
  const animationDuration = `${speed}s`;

  return (
    <span className={cn('shiny-text', {disabled: disabled}, className)} style={{animationDuration}}>
      {text}
    </span>
  );
}

export type {ShinyTextProps};
export {ShinyText};
