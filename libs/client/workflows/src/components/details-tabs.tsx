import {Tabs, TabsContent, TabsList, TabsTrigger} from '@shipfox/react-ui/tabs';
import type {ReactNode} from 'react';

export function DetailsTabs({children, cost}: {children: ReactNode; cost?: ReactNode}) {
  if (!cost) return children;
  return (
    <Tabs defaultValue="details" className="flex min-h-0 w-full flex-1 flex-col">
      <div className="shrink-0 border-b border-border-neutral-base px-row">
        <TabsList aria-label="Details sections">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="cost">Cost</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="details" className="flex min-h-0 flex-1 flex-col">
        {children}
      </TabsContent>
      <TabsContent value="cost" className="min-h-0 flex-1 overflow-auto p-panel-compact">
        {cost}
      </TabsContent>
    </Tabs>
  );
}
