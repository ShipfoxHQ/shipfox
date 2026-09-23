import type {Meta, StoryObj} from '@storybook/react';
import {Badge} from '#components/badge/index.js';
import {Callout, CalloutContent, CalloutDescription} from '#components/callout/index.js';
import {Icon} from '#components/icon/index.js';
import {
  Inspector,
  InspectorFact,
  InspectorFactSeparator,
  InspectorFacts,
  InspectorHeader,
  InspectorTabs,
} from './inspector.js';
import {
  InspectorSection,
  InspectorSectionBody,
  InspectorSectionEmpty,
  PropertyCode,
  PropertyDisclosureRow,
  PropertyList,
  PropertyRow,
} from './inspector-section.js';

const meta = {
  title: 'Components/Inspector',
  component: Inspector,
  parameters: {layout: 'fullscreen'},
  tags: ['autodocs'],
  args: {label: 'Workflow inspector', onClose: () => undefined, children: null},
} satisfies Meta<typeof Inspector>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Docked: Story = {
  render: (args) => (
    <div className="flex h-[720px]">
      <div className="flex-1" />
      <Inspector {...args} presentation="docked">
        <InspectorHeader
          title="deploy-web"
          description="Run 1 · Attempt 2"
          status={
            <Badge variant="success" size="xs">
              Succeeded
            </Badge>
          }
        >
          <InspectorFacts>
            <InspectorFact icon={<Icon name="gitBranchLine" />} description="Reference: main">
              main
            </InspectorFact>
            <InspectorFactSeparator />
            <InspectorFact icon={<Icon name="timerLine" />} description="Ran for 5 seconds">
              5s
            </InspectorFact>
          </InspectorFacts>
        </InspectorHeader>
        <InspectorTabs
          tabs={[
            {value: 'results', label: 'Results', count: 4, content: <SectionsContent />},
            {value: 'cost', label: 'Cost', content: null},
          ]}
        />
      </Inspector>
    </div>
  ),
};

function SectionsContent() {
  return (
    <>
      <InspectorSection title="Job outputs" count={2}>
        <PropertyList>
          <PropertyRow
            label="artifact"
            labelFont="code"
            meta={<Badge size="2xs">string</Badge>}
            copyValue="https://example.com/builds/very-long-production-artifact-name"
            copyLabel="Copy output artifact"
          >
            https://example.com/builds/very-long-production-artifact-name
          </PropertyRow>
          <PropertyRow label="replicas" labelFont="code" meta={<Badge size="2xs">number</Badge>}>
            3
          </PropertyRow>
          <PropertyRow label="deployment" labelFont="code" meta={<Badge size="2xs">object</Badge>}>
            <PropertyCode>
              {JSON.stringify({environment: 'production', sha: 'd34db33f'}, null, 2)}
            </PropertyCode>
          </PropertyRow>
          <PropertyDisclosureRow label="Payload" summary="2 fields" defaultOpen={false}>
            <PropertyCode>
              {JSON.stringify({branch: 'main', sender: 'octocat'}, null, 2)}
            </PropertyCode>
          </PropertyDisclosureRow>
        </PropertyList>
      </InspectorSection>
      <InspectorSection title="Condition" aside={<Badge size="2xs">false</Badge>}>
        <PropertyList>
          <PropertyRow label="Expression">inputs.environment == "production"</PropertyRow>
          <PropertyRow label="Reads">inputs.environment</PropertyRow>
        </PropertyList>
      </InspectorSection>
      <InspectorSection title="Execution outputs">
        <InspectorSectionEmpty>Not produced yet</InspectorSectionEmpty>
      </InspectorSection>
      <InspectorSection title="Pricing and request details" defaultOpen={false}>
        <InspectorSection title="claude-sonnet-4">
          <PropertyList>
            <PropertyRow label="Requests">12</PropertyRow>
          </PropertyList>
        </InspectorSection>
      </InspectorSection>
      <InspectorSection title="Trigger events">
        <InspectorSectionBody>
          <Callout type="warning" variant="secondary">
            <CalloutContent>
              <CalloutDescription>
                The stored value is too large to display (70 000 bytes).
              </CalloutDescription>
            </CalloutContent>
          </Callout>
        </InspectorSectionBody>
      </InspectorSection>
    </>
  );
}
