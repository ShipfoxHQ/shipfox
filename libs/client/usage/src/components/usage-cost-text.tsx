import {type UsagePricingCost, useUsagePricing} from '@shipfox/client-shell/runtime';
import {Code} from '@shipfox/react-ui/typography';
import {formatUsageCost} from './usage-cost.js';

export function UsageCostText({cost}: {cost: UsagePricingCost | undefined}) {
  const formatted = formatUsageCost(useUsagePricing(), cost);
  if (!formatted) return null;
  return (
    <Code
      as="span"
      variant="label"
      className="whitespace-nowrap text-foreground-neutral-subtle"
      data-usage-cost-state={cost?.state}
    >
      {formatted}
    </Code>
  );
}
