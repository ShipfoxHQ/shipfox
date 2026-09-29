import {Badge} from '@shipfox/react-ui/badge';
import type {RegistryPackageKind} from '@shipfox/registry-format';

const KIND_LABELS: Record<RegistryPackageKind, string> = {template: 'Template', action: 'Action'};

export function KindBadge({kind}: {kind: RegistryPackageKind}) {
  return <Badge variant="neutral">{KIND_LABELS[kind]}</Badge>;
}
