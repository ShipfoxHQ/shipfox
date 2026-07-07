'use client';

import {cva, type VariantProps} from 'class-variance-authority';
import {AnimatePresence, motion, type Transition} from 'framer-motion';
import {
  type ComponentProps,
  createContext,
  type MouseEvent,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {cn} from '#utils/cn.js';
import {Callout, type CalloutType} from '../callout/index.js';
import {Icon} from '../icon/index.js';

const closeIconVariants = cva('w-16 h-16', {
  variants: {
    variant: {
      default: 'text-tag-neutral-icon',
      info: 'text-tag-blue-icon',
      success: 'text-tag-success-icon',
      warning: 'text-tag-warning-icon',
      error: 'text-tag-error-icon',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

const alertDefaultTransition: Transition = {
  duration: 0.2,
  ease: 'easeInOut',
};

type AlertContextValue = {
  isOpen: boolean;
  onClose: () => void;
  variant: CalloutType;
};

const AlertContext = createContext<AlertContextValue | null>(null);

function useAlertContext() {
  const context = useContext(AlertContext);
  if (!context) {
    throw new Error('Alert components must be used within an Alert component');
  }
  return context;
}

type AlertProps = ComponentProps<'div'> & {
  variant?: CalloutType;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  animated?: boolean;
  transition?: Transition;
  autoClose?: number;
};

function Alert({
  className,
  variant = 'default',
  children,
  open: controlledOpen,
  defaultOpen = true,
  onOpenChange,
  animated = true,
  transition = alertDefaultTransition,
  autoClose,
  ...props
}: AlertProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;

  const handleClose = useCallback(() => {
    if (controlledOpen === undefined) {
      setInternalOpen(false);
    }
    onOpenChange?.(false);
  }, [controlledOpen, onOpenChange]);

  const handleCloseRef = useRef(handleClose);
  useEffect(() => {
    handleCloseRef.current = handleClose;
  }, [handleClose]);

  useEffect(() => {
    if (autoClose && isOpen && autoClose > 0) {
      const timeoutId = setTimeout(() => {
        handleCloseRef.current();
      }, autoClose);

      return () => {
        clearTimeout(timeoutId);
      };
    }
    return undefined;
  }, [autoClose, isOpen]);

  const contextValue: AlertContextValue = {
    isOpen,
    onClose: handleClose,
    variant,
  };

  const alert = (
    <AlertContext.Provider value={contextValue}>
      <Callout
        data-slot="alert"
        role="alert"
        type={variant}
        className={cn('relative', className)}
        {...props}
      >
        {children}
      </Callout>
    </AlertContext.Provider>
  );

  if (!animated) {
    if (!isOpen) {
      return null;
    }

    return alert;
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="alert"
          className="w-full flex items-start gap-4"
          initial={{opacity: 0}}
          animate={{opacity: 1}}
          exit={{opacity: 0}}
          transition={transition}
        >
          {alert}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function AlertContent({className, ...props}: ComponentProps<'div'>) {
  return <div data-slot="alert-content" className={cn('flex-1 min-w-0', className)} {...props} />;
}

function AlertTitle({className, ...props}: ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn('font-medium text-sm leading-20 text-foreground-neutral-base mb-4', className)}
      {...props}
    />
  );
}

function AlertDescription({className, ...props}: ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        'text-xs leading-20 text-foreground-neutral-base [&_p]:leading-relaxed',
        className,
      )}
      {...props}
    />
  );
}

function AlertActions({className, ...props}: ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-actions"
      className={cn('flex items-center gap-8 mt-8', className)}
      {...props}
    />
  );
}

function AlertAction({className, ...props}: ComponentProps<'button'>) {
  return (
    <button
      data-slot="alert-action"
      type="button"
      className={cn(
        'bg-transparent border-none p-0 cursor-pointer text-xs font-medium leading-20 text-foreground-neutral-base hover:text-foreground-neutral-subtle transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-background-accent-blue-base focus-visible:ring-offset-2',
        className,
      )}
      {...props}
    />
  );
}

function AlertClose({
  className,
  variant: variantProp,
  onClick,
  ...props
}: ComponentProps<'button'> & VariantProps<typeof closeIconVariants>) {
  const {onClose, variant: contextVariant} = useAlertContext();
  const variant = variantProp ?? contextVariant ?? 'default';

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    onClose();
    onClick?.(e);
  };

  return (
    <button
      data-slot="alert-close"
      type="button"
      className={cn(
        'absolute cursor-pointer top-12 right-12 rounded-4 p-4 bg-transparent border-none text-foreground-neutral-muted hover:text-foreground-neutral-base hover:bg-background-components-hover transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-background-accent-blue-base focus-visible:ring-offset-2',
        className,
      )}
      aria-label="Close"
      onClick={handleClick}
      {...props}
    >
      <Icon name="close" className={cn(closeIconVariants({variant}))} />
    </button>
  );
}

export type {AlertProps};
export {
  Alert,
  AlertAction,
  AlertActions,
  AlertClose,
  AlertContent,
  AlertDescription,
  AlertTitle,
  alertDefaultTransition,
};
