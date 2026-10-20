import {Badge} from '@shipfox/react-ui/badge';
import type {RegistryPackageKind} from '@shipfox/registry-format';

const KIND_LABELS: Record<RegistryPackageKind, string> = {template: 'Template', action: 'Action'};

export function KindBadge({
  kind,
  composite = false,
}: {
  kind: RegistryPackageKind;
  composite?: boolean;
}) {
  return <Badge variant="neutral">{composite ? 'Composite action' : KIND_LABELS[kind]}</Badge>;
}
