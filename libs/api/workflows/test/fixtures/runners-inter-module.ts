import {runnerToolCapabilitiesSchema} from '@shipfox/api-runners-dto';
import type {RunnersInterModuleClient} from '@shipfox/api-runners-dto/inter-module';
import {sql} from 'drizzle-orm';
import {db} from '#db/db.js';

export const runnersTestClient: RunnersInterModuleClient = {
  enqueueJobExecution() {
    return Promise.resolve({});
  },
  releaseJobExecution() {
    return Promise.resolve({});
  },
  cancelJobs() {
    return Promise.resolve({});
  },
  async getLeaseState({jobId, jobExecutionId, runnerSessionId}) {
    const result = await db().execute<{active: boolean}>(sql`
      SELECT EXISTS(
        SELECT 1
        FROM runners_running_jobs
        WHERE job_id = ${jobId}
          AND job_execution_id = ${jobExecutionId}
          AND runner_session_id = ${runnerSessionId}
      ) AS active
    `);
    return {active: result.rows[0]?.active ?? false};
  },
  async getEffectiveRunnerToolCapabilities({runnerSessionId}) {
    const result = await db().execute<{
      toolCapabilities: unknown;
      toolCapabilitiesReportedAt: Date | string | null;
    }>(sql`
      SELECT
        tool_capabilities AS "toolCapabilities",
        tool_capabilities_reported_at AS "toolCapabilitiesReportedAt"
      FROM runners_runner_sessions
      WHERE id = ${runnerSessionId}
    `);
    const row = result.rows[0];
    const reportedAt = row?.toolCapabilitiesReportedAt;
    const reportFresh =
      reportedAt !== null &&
      reportedAt !== undefined &&
      Date.now() - new Date(reportedAt).getTime() <= 60_000;
    return {
      capabilities: reportFresh
        ? runnerToolCapabilitiesSchema.parse(row?.toolCapabilities ?? {harnesses: {}})
        : {harnesses: {}},
      reportFresh,
    };
  },
};
