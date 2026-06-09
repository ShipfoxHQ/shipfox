import type {TriggerDto} from '@shipfox/api-definitions-dto';
import type {WorkflowDocument} from '@shipfox/workflow-document';

export function definitionTriggersFor(document: WorkflowDocument): Record<string, TriggerDto> {
  return Object.fromEntries(
    Object.entries(document.triggers ?? {}).map(([name, trigger]) => {
      const dto: TriggerDto = {
        source: trigger.source,
        event: trigger.event,
      };
      if (trigger.with !== undefined) dto.with = trigger.with;
      if (trigger.filter !== undefined) dto.filter = trigger.filter;
      return [name, dto];
    }),
  );
}
