import type {AuthMethod, RouteExport} from '@shipfox/node-fastify';
import type {OutboxTable} from '@shipfox/node-outbox';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import type {ZodType} from 'zod';
import type {ModuleSubscriber} from './subscriber.js';

export interface ModuleDatabase {
  db: () => NodePgDatabase<Record<string, unknown>>;
  migrationsPath: string;
  /**
   * Stable name for this database's drizzle migration-tracking table. When
   * omitted, the name is derived from the module name and the database's
   * position in the module's `database` array. Set this for modules that
   * compose databases conditionally (e.g. feature-flagged providers), where a
   * positional name would shift if another database is added or removed and
   * silently re-run migrations against existing tables.
   */
  migrationsTableName?: string;
}

export interface ModulePublisher {
  name: string;
  table: OutboxTable;
  db: () => NodePgDatabase<Record<string, unknown>>;
  /**
   * Optional schemas for events this publisher writes. Omitted entries preserve
   * the historical unchecked payload path; new entries should live in the
   * producing module's `*-dto` package so payload types and validation share one
   * contract.
   */
  eventSchemas?: Record<string, ZodType>;
}

export interface WorkflowStart {
  name: string;
  id: string;
  args?: unknown[];
  /**
   * Optional Temporal cron expression (e.g. `* * * * *`). When set, the
   * workflow is started with `cronSchedule` so Temporal handles recurrence
   * natively — no continueAsNew loop or external scheduler needed.
   */
  cronSchedule?: string;
}

export interface ModuleWorker {
  taskQueue: string;
  workflowsPath: string;
  activities: () => object;
  workflows: WorkflowStart[];
}

/**
 * Hook for observable gauges over shared service state. Implementations must
 * fetch the service metrics provider inside the callback so ordinary module
 * imports do not bind the metrics port.
 */
export type ModuleMetricsRegistration = () => void;

export interface ShipfoxModule {
  name: string;
  database?: ModuleDatabase | ModuleDatabase[];
  auth?: AuthMethod[];
  routes?: RouteExport[];
  e2eRoutes?: RouteExport[];
  publishers?: ModulePublisher[];
  subscribers?: ModuleSubscriber[];
  workers?: ModuleWorker[];
  metrics?: ModuleMetricsRegistration;
}
