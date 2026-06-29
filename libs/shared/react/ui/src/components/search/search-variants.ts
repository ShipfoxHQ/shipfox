import {cva} from 'class-variance-authority';

const sharedInputStyles = [
  'inline-flex items-center gap-8',
  'text-sm leading-20',
  'transition-[color,box-shadow,background-color] outline-none',
];

const variantStyles = {
  primary: {
    base: ['bg-background-field-base', 'shadow-button-neutral'],
    focus: 'focus-within:shadow-border-interactive-with-active',
    hover: 'hover:bg-background-field-hover',
    focusVisible: 'focus-visible:shadow-border-interactive-with-active',
  },
  secondary: {
    base: ['bg-background-field-component', 'border border-border-neutral-strong'],
    focus: 'focus-within:shadow-border-interactive-with-active',
    hover: 'hover:bg-background-field-component-hover',
    focusVisible: 'focus-visible:shadow-border-interactive-with-active',
  },
};

const sizeStyles = {
  base: 'h-32 px-8 py-6',
  small: 'h-28 px-8 py-4',
};

const radiusStyles = {
  rounded: 'rounded-full',
  squared: 'rounded-6',
};

export const searchInputVariants = cva(sharedInputStyles, {
  variants: {
    variant: {
      primary: [...variantStyles.primary.base, variantStyles.primary.focus],
      secondary: [...variantStyles.secondary.base, variantStyles.secondary.focus],
    },
    size: sizeStyles,
    radius: radiusStyles,
  },
  defaultVariants: {
    variant: 'primary',
    size: 'base',
    radius: 'squared',
  },
});

export const searchTriggerVariants = cva(
  [
    ...sharedInputStyles,
    'cursor-pointer text-foreground-neutral-muted',
    'disabled:pointer-events-none disabled:cursor-not-allowed disabled:text-foreground-neutral-disabled',
  ],
  {
    variants: {
      variant: {
        primary: [
          ...variantStyles.primary.base,
          variantStyles.primary.hover,
          variantStyles.primary.focusVisible,
        ],
        secondary: [
          ...variantStyles.secondary.base,
          variantStyles.secondary.hover,
          variantStyles.secondary.focusVisible,
        ],
      },
      size: sizeStyles,
      radius: radiusStyles,
    },
    defaultVariants: {
      variant: 'primary',
      size: 'base',
      radius: 'squared',
    },
  },
);
