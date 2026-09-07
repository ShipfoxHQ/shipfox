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
      className="text-current whitespace-nowrap"
      data-usage-cost-state={cost?.state}
    >
      {cost?.state === 'estimated' ? 'Est. ' : ''}
      {formatted}
    </Code>
  );
}
