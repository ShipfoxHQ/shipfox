'use client';

import type {LogRecord} from '@shipfox/api-logs-dto';
import {LogContent, LogRow, LogRows, type LogTimestampMode} from '@shipfox/react-ui';
import {type ReactNode, type UIEventHandler, useMemo} from 'react';
import {
  assertNever,
  buildLogTree,
  type LogNode,
  type LogTree,
  type MarkerLogRecord,
} from '#core/log-tree.js';
import {LogGroup} from './log-group.js';
import {OutputLogRow} from './output-log-row.js';
import {CappedMarker, EndMarker, GapMarker, RunnerLostMarker} from './system-markers.js';

export interface LogViewProps {
  records: readonly LogRecord[];
  timestamps?: LogTimestampMode;
  wrap?: boolean;
  showLineNumbers?: boolean;
  defaultGroupsOpen?: boolean;
  className?: string | undefined;
  onScroll?: UIEventHandler<HTMLDivElement> | undefined;
}

export function LogView({
  records,
  timestamps = 'off',
  wrap = false,
  showLineNumbers = true,
  defaultGroupsOpen = false,
  className,
  onScroll,
}: LogViewProps) {
  const tree = useMemo(() => buildLogTree(records), [records]);
  const isEmpty = tree.nodes.length === 0;

  return (
    <LogRows
      timestamps={timestamps}
      wrap={wrap}
      showLineNumbers={showLineNumbers}
      className={className}
      onScroll={onScroll}
      {...(tree.originTs != null ? {timestampOrigin: new Date(tree.originTs)} : {})}
    >
      {isEmpty ? (
        <LogRow lineNumber={null}>
          <LogContent variant="code" className="text-foreground-neutral-muted">
            No output
          </LogContent>
        </LogRow>
      ) : (
        renderNodes(tree.nodes, 0, tree, defaultGroupsOpen)
      )}
    </LogRows>
  );
}

function renderNodes(
  nodes: readonly LogNode[],
  depth: number,
  tree: LogTree,
  defaultGroupsOpen: boolean,
): ReactNode[] {
  // `node.seq` is the stable, unique render key (see `LogNodeBase`): a concatenated
  // multi-step/retry stream can repeat a `group_id` or a marker's `(type, ts)` at one
  // level, which a key derived from those fields would collide on.
  return nodes.map((node): ReactNode => {
    switch (node.kind) {
      case 'output':
        return (
          <OutputLogRow
            key={node.seq}
            record={node.record}
            lineNumber={node.lineNumber}
            indent={depth}
          />
        );
      case 'group':
        return (
          <LogGroup
            key={node.seq}
            node={node}
            depth={depth}
            terminated={tree.terminated}
            defaultOpen={defaultGroupsOpen}
          >
            {renderNodes(node.children, depth + 1, tree, defaultGroupsOpen)}
          </LogGroup>
        );
      case 'marker':
        return <MarkerRow key={node.seq} record={node.record} tree={tree} />;
      default:
        return assertNever(node);
    }
  });
}

function MarkerRow({record, tree}: {record: MarkerLogRecord; tree: LogTree}): ReactNode {
  switch (record.type) {
    case 'end':
      return (
        <EndMarker
          record={record}
          lineCount={tree.lineCount}
          durationMs={tree.originTs != null ? record.ts - tree.originTs : null}
        />
      );
    case 'gap':
      return <GapMarker record={record} />;
    case 'capped':
      return <CappedMarker record={record} />;
    case 'runner_lost':
      return <RunnerLostMarker record={record} />;
    default:
      return assertNever(record);
  }
}
