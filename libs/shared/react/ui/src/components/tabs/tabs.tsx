import {type HTMLMotionProps, motion, type Transition} from 'framer-motion';
import {
  Children,
  type ComponentProps,
  createContext,
  forwardRef,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {cn} from '#utils/cn.js';
import {debounce} from '#utils/debounce.js';

type TabsContextType<T extends string = string> = {
  activeValue: T;
  handleValueChange: (value: T) => void;
  registerTrigger: (value: string, node: HTMLElement | null) => void;
  getTriggerElement: (value: string) => HTMLElement | undefined;
  getAllTriggerValues: () => string[];
};

const TabsContext = createContext<TabsContextType<string> | undefined>(undefined);

function useTabs<T extends string = string>(): TabsContextType<T> {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error('useTabs must be used within a Tabs component');
  }
  return context as unknown as TabsContextType<T>;
}

type BaseTabsProps = ComponentProps<'div'> & {
  children: ReactNode;
};

type UnControlledTabsProps<T extends string = string> = BaseTabsProps & {
  defaultValue?: T;
  value?: never;
  onValueChange?: never;
};

type ControlledTabsProps<T extends string = string> = BaseTabsProps & {
  value: T;
  onValueChange?: (value: T) => void;
  defaultValue?: never;
};

type TabsProps<T extends string = string> = UnControlledTabsProps<T> | ControlledTabsProps<T>;

function Tabs<T extends string = string>({
  defaultValue,
  value,
  onValueChange,
  children,
  className,
  ...props
}: TabsProps<T>) {
  const [activeValue, setActiveValue] = useState<T | undefined>(defaultValue ?? undefined);
  const triggersRef = useRef(new Map<string, HTMLElement>());
  const initialSet = useRef(false);
  const isControlled = value !== undefined;

  useEffect(() => {
    if (
      !isControlled &&
      activeValue === undefined &&
      triggersRef.current.size > 0 &&
      !initialSet.current
    ) {
      const firstTab = Array.from(triggersRef.current.keys())[0];
      setActiveValue(firstTab as T);
      initialSet.current = true;
    }
  }, [activeValue, isControlled]);

  const registerTrigger = useCallback(
    (value: string, node: HTMLElement | null) => {
      if (node) {
        triggersRef.current.set(value, node);
        if (!isControlled && activeValue === undefined && !initialSet.current) {
          setActiveValue(value as T);
          initialSet.current = true;
        }
      } else {
        triggersRef.current.delete(value);
      }
    },
    [isControlled, activeValue],
  );

  const handleValueChange = useCallback(
    (val: T) => {
      if (!isControlled) setActiveValue(val);
      else onValueChange?.(val);
    },
    [isControlled, onValueChange],
  );

  const getTriggerElement = useCallback((val: string) => {
    return triggersRef.current.get(val);
  }, []);

  const getAllTriggerValues = useCallback(() => {
    return Array.from(triggersRef.current.keys());
  }, []);

  const resolvedActiveValue: T = useMemo(() => {
    if (value !== undefined) return value;
    if (activeValue !== undefined) return activeValue;
    const firstKey = Array.from(triggersRef.current.keys())[0];
    return (firstKey ?? '') as T;
  }, [value, activeValue]);

  return (
    <TabsContext.Provider
      value={{
        activeValue: resolvedActiveValue as string,
        handleValueChange: handleValueChange as (value: string) => void,
        registerTrigger,
        getTriggerElement,
        getAllTriggerValues,
      }}
    >
      <div
        data-slot="tabs"
        className={cn('flex flex-col gap-2', className)}
        {...(props as ComponentProps<'div'>)}
      >
        {children}
      </div>
    </TabsContext.Provider>
  );
}

type TabsListProps = ComponentProps<'div'> & {
  children: ReactNode;
  activeClassName?: string;
  transition?: Transition;
};

function TabsList({
  children,
  className,
  activeClassName,
  transition = {
    type: 'spring',
    stiffness: 400,
    damping: 30,
  },
  ...props
}: TabsListProps) {
  const {activeValue, getTriggerElement} = useTabs();
  const [indicatorStyle, setIndicatorStyle] = useState<{
    left: number;
    width: number;
  } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const updateIndicator = useCallback(() => {
    const activeTrigger = getTriggerElement(activeValue);

    if (activeTrigger && listRef.current) {
      const listRect = listRef.current.getBoundingClientRect();
      const triggerRect = activeTrigger.getBoundingClientRect();
      setIndicatorStyle({
        left: triggerRect.left - listRect.left,
        width: triggerRect.width,
      });
    }
  }, [activeValue, getTriggerElement]);

  useEffect(() => {
    const debouncedUpdate = debounce(updateIndicator, 100);
    window.addEventListener('resize', debouncedUpdate);
    requestAnimationFrame(updateIndicator);

    return () => {
      window.removeEventListener('resize', debouncedUpdate);
    };
  }, [updateIndicator]);

  return (
    <div
      ref={listRef}
      role="tablist"
      data-slot="tabs-list"
      className={cn('relative inline-flex items-center gap-8', className)}
      {...(props as ComponentProps<'div'>)}
    >
      {children}
      {indicatorStyle && (
        <motion.div
          className={cn(
            'absolute bottom-0 h-2 bg-foreground-highlight-interactive',
            activeClassName,
          )}
          initial={false}
          animate={{
            left: indicatorStyle.left,
            width: indicatorStyle.width,
          }}
          transition={transition}
        />
      )}
    </div>
  );
}

type TabsTriggerProps = Omit<HTMLMotionProps<'button'>, 'ref'> & {
  value: string;
  children: ReactNode;
};

const TabsTrigger = forwardRef<HTMLButtonElement, TabsTriggerProps>(
  ({value, children, className, onKeyDown, ...props}, ref) => {
    const {
      activeValue,
      handleValueChange,
      registerTrigger,
      getAllTriggerValues,
      getTriggerElement,
    } = useTabs();

    const localRef = useRef<HTMLButtonElement | null>(null);
    useImperativeHandle(ref, () => localRef.current as HTMLButtonElement);

    useEffect(() => {
      registerTrigger(value, localRef.current);
      return () => registerTrigger(value, null);
    }, [value, registerTrigger]);

    const isActive = activeValue === value;

    const handleKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLButtonElement>) => {
        onKeyDown?.(event);

        const allValues = getAllTriggerValues();
        const currentIndex = allValues.indexOf(value);

        if (currentIndex === -1) return;

        let targetIndex = currentIndex;
        let shouldPreventDefault = true;

        switch (event.key) {
          case 'ArrowLeft': {
            targetIndex = currentIndex > 0 ? currentIndex - 1 : allValues.length - 1;
            break;
          }
          case 'ArrowRight': {
            targetIndex = currentIndex < allValues.length - 1 ? currentIndex + 1 : 0;
            break;
          }
          case 'Home': {
            targetIndex = 0;
            break;
          }
          case 'End': {
            targetIndex = allValues.length - 1;
            break;
          }
          default: {
            shouldPreventDefault = false;
            return;
          }
        }

        if (shouldPreventDefault) {
          event.preventDefault();
          const targetValue = allValues[targetIndex];
          if (targetValue) {
            handleValueChange(targetValue);
            const targetElement = getTriggerElement(targetValue);
            targetElement?.focus();
          }
        }
      },
      [value, getAllTriggerValues, getTriggerElement, handleValueChange, onKeyDown],
    );

    return (
      <motion.button
        ref={localRef}
        data-slot="tabs-trigger"
        role="tab"
        tabIndex={isActive ? 0 : -1}
        whileTap={{scale: 0.95}}
        onClick={() => handleValueChange(value)}
        onKeyDown={handleKeyDown}
        data-state={isActive ? 'active' : 'inactive'}
        aria-selected={isActive}
        aria-controls={`tabpanel-${value}`}
        id={`tab-${value}`}
        className={cn(
          'relative inline-flex cursor-pointer items-center justify-center whitespace-nowrap px-0 py-10 text-sm font-medium transition-colors outline-none focus-visible:shadow-border-interactive-with-active focus-visible:rounded-2 disabled:pointer-events-none disabled:opacity-50',
          isActive ? 'text-foreground-neutral-base' : 'text-foreground-neutral-muted',
          className,
        )}
        {...props}
      >
        {children}
      </motion.button>
    );
  },
);

TabsTrigger.displayName = 'TabsTrigger';

type TabsContentsProps = ComponentProps<'div'> & {
  children: ReactNode;
};

function TabsContents({children, className, ...props}: TabsContentsProps) {
  const {activeValue} = useTabs();
  const childrenArray = Children.toArray(children);

  const activeChild = childrenArray.find(
    (child): child is ReactElement<{value: string}> =>
      isValidElement(child) &&
      typeof child.props === 'object' &&
      child.props !== null &&
      'value' in child.props &&
      child.props.value === activeValue,
  );

  return (
    <div data-slot="tabs-contents" className={cn(className)} {...(props as ComponentProps<'div'>)}>
      {activeChild}
    </div>
  );
}

type TabsContentProps = ComponentProps<'div'> & {
  value: string;
  children: ReactNode;
};

function TabsContent({children, value, className, ...props}: TabsContentProps) {
  const {activeValue} = useTabs();
  const isActive = activeValue === value;

  if (!isActive) {
    return null;
  }

  return (
    <div
      role="tabpanel"
      data-slot="tabs-content"
      aria-labelledby={`tab-${value}`}
      className={cn(className)}
      {...props}
    >
      {children}
    </div>
  );
}

export {
  Tabs,
  TabsContent,
  type TabsContentProps,
  TabsContents,
  type TabsContentsProps,
  type TabsContextType,
  TabsList,
  type TabsListProps,
  type TabsProps,
  TabsTrigger,
  type TabsTriggerProps,
  useTabs,
};
