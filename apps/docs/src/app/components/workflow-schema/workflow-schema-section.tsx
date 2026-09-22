import {getWorkflowSchemaSection} from '@/lib/workflow-schema-source';
import {ExamplePane} from './example-pane';
import {FieldList} from './field-list';

export function WorkflowSchemaSection({id}: {id: string}) {
  const section = getWorkflowSchemaSection(id);

  return (
    <div
      className="not-prose my-region grid items-start gap-section xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]"
      data-workflow-schema-section={section.id}
    >
      <FieldList fields={section.fields} kind={section.kind} />
      <ExamplePane example={section.example} />
    </div>
  );
}
