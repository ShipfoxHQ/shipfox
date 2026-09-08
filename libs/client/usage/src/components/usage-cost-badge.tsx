import type {UsagePricingCost} from '@shipfox/client-shell/runtime';
import {useUsagePricing} from '@shipfox/client-shell/runtime';
import {Badge} from '@shipfox/react-ui/badge';
import {formatUsageCost, usagePricingDisclosure} from './usage-cost.js';

export function UsageCostBadge({cost}: {cost: UsagePricingCost | undefined}) {
  const pricing = useUsagePricing();
  const formatted = formatUsageCost(pricing, cost);
  const disclosure = usagePricingDisclosure(pricing, cost);
  if (!formatted) return null;

  return (
    <Badge
      data-usage-cost-state={cost?.state}
      variant="neutral"
      size="2xs"
      title={disclosure ?? (cost?.state === 'estimated' ? 'Estimated cost' : 'Resolved cost')}
    >
      {cost?.state === 'estimated' ? 'Est. ' : ''}
      {formatted}
    </Badge>
  );
}
