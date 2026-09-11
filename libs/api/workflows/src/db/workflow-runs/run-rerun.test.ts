import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {eq, inArray} from 'drizzle-orm';
import type {AgentDefaultsResolver} from '#core/agent-defaults.js';
import {NoFailedJobsError, RunNotTerminalError, SourceRunNotFoundError} from '#core/errors.js';
import {nextStepForJob, recordStepResult} from '#core/job-execution.js';
import {assembleWorkflowRunContext} from '#core/step-config/assemble-run-context.js';
import {literalField} from '#core/step-config/fields.js';
import {stripSetupStep} from '#test/fixtures/strip-setup-step.js';
import {listTestRunAttempts} from '#test/helpers/run-attempts.js';
import {
  buildModel,
  expression,
  runAttemptCreatedEvents,
  stepOutputField,
  template,
} from '#test/helpers/workflow-runs.js';
import {db} from '../db.js';
import {jobExecutions} from '../schema/job-executions.js';
import {jobs} from '../schema/jobs.js';
import {steps as stepsTable} from '../schema/steps.js';
import {
  createRerunWorkflowRun,
  createWorkflowRun,
  getJobExecutionsByJobId,
  getJobsByWorkflowRunId,
  getStepAttempts,
  getStepsByJobId,
  getWorkflowRunAttemptById,
  getWorkflowRunById,
  updateWorkflowRunStatus,
} from '../workflow-runs.js';

describe('workflow run queries', () => {
  let workspaceId: string;
  let projectId: string;
  let definitionId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
    definitionId = crypto.randomUUID();
  });

  describe('createRerunWorkflowRun', () => {
    function rerunModel() {
      return buildModel({
        runName: `Run ${template('inputs.env')}`,
        jobs: {
          build: {
            runnerTemplates: [template('run.attempt == 1 ? "attempt-1" : "attempt-2"')],
            steps: [{run: 'echo build'}],
          },
          test: {needs: 'build', steps: [{run: 'echo test'}]},
          deploy: {needs: 'test', steps: [{run: 'echo deploy'}]},
          notify: {steps: [{run: 'echo notify'}]},
        },
      });
    }

    async function createTerminalSourceRun() {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: rerunModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
        inputs: {env: 'staging'},
        sourceSnapshot: {content: 'name: Original\njobs: {}\n', format: 'yaml'},
      });
      const runJobs = await getJobsByWorkflowRunId(run.id);
      await Promise.all([
        markJob(runJobs, 'build', 'succeeded'),
        markJob(runJobs, 'test', 'failed'),
        markJob(runJobs, 'deploy', 'skipped'),
        markJob(runJobs, 'notify', 'cancelled'),
      ]);
      await updateWorkflowRunStatus({workflowRunId: run.id, status: 'failed', expectedVersion: 1});

      return run;
    }

    async function markJob(
      runJobs: Awaited<ReturnType<typeof getJobsByWorkflowRunId>>,
      key: string,
      status: 'succeeded' | 'failed' | 'cancelled' | 'skipped',
    ) {
      const job = runJobs.find((candidate) => candidate.key === key);
      if (!job) throw new Error(`Missing job ${key}`);
      await db().update(jobs).set({status}).where(eq(jobs.id, job.id));
      const jobSteps = await getStepsByJobId(job.id);
      await db()
        .update(stepsTable)
        .set({
          status: status === 'skipped' ? 'cancelled' : status,
          error: status === 'failed' ? {message: 'failed'} : null,
        })
        .where(
          inArray(
            stepsTable.id,
            jobSteps.map((step) => step.id),
          ),
        );
    }

    test('all mode resets every job and step to pending', async () => {
      const source = await createTerminalSourceRun();

      const rerun = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      expect(rerun).toMatchObject({
        id: source.id,
        number: source.number,
        name: 'Run staging',
        workflowName: 'Test Workflow',
        nameOverride: 'Run staging',
        inputs: {env: 'staging'},
        sourceSnapshot: {content: 'name: Original\njobs: {}\n', format: 'yaml'},
      });
      const sourceAfter = await getWorkflowRunById(source.id);
      expect(sourceAfter?.currentAttempt).toBe(2);
      const attempts = await listTestRunAttempts({workflowRunId: source.id, projectId});
      expect(attempts.map((attempt) => attempt.attempt).sort()).toEqual([1, 2]);

      const rerunJobs = await getJobsByWorkflowRunId(rerun.id);
      expect(rerunJobs.every((job) => job.status === 'pending' && !job.carriedOver)).toBe(true);
      for (const job of rerunJobs) {
        const jobSteps = await getStepsByJobId(job.id);
        expect(jobSteps.every((step) => step.status === 'pending')).toBe(true);
        expect(jobSteps.every((step) => step.error === null)).toBe(true);
      }
    });

    test('re-materializes run-creation step config for the new attempt', async () => {
      const source = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            publish: {
              steps: [
                {
                  key: 'publish',
                  run: 'echo publish',
                  env: {BRANCH: `publish-${template('run.id')}-${template('run.attempt')}`},
                },
              ],
            },
          },
        }),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      const [sourceJob] = await getJobsByWorkflowRunId(source.id);
      if (!sourceJob) throw new Error('Missing source publish job');
      await markJob([sourceJob], 'publish', 'failed');
      const sourceStep = (await getStepsByJobId(sourceJob.id)).find(
        (step) => step.key === 'publish',
      );
      if (!sourceStep) throw new Error('Missing source publish step');
      await updateWorkflowRunStatus({
        workflowRunId: source.id,
        status: 'failed',
        expectedVersion: 1,
      });

      const rerun = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'failed',
        actorUserId: crypto.randomUUID(),
      });

      const [rerunJob] = await getJobsByWorkflowRunId(rerun.id);
      if (!rerunJob) throw new Error('Missing rerun publish job');
      const rerunStep = (await getStepsByJobId(rerunJob.id)).find((step) => step.key === 'publish');
      expect(rerunStep?.config).toMatchObject({
        env: {BRANCH: `publish-${source.id}-2`},
      });
      expect(rerunStep?.configPlan?.trace).toContainEqual(
        expect.objectContaining({
          expression: 'run.attempt',
          fillTarget: 'run-creation',
          evaluatedAt: 'run-creation',
          field: 'env',
          envKey: 'BRANCH',
          value: '2',
        }),
      );
      expect(
        (await getStepsByJobId(sourceJob.id)).find((step) => step.id === sourceStep.id),
      ).toEqual(sourceStep);
    });

    test('re-materializes agent prompts while preserving resolved defaults and session intent', async () => {
      const resolveAgentDefaults = vi.fn<AgentDefaultsResolver>().mockReturnValue({
        harness: 'pi',
        provider: 'openai',
        model: 'gpt-5.5-pro',
        thinking: 'medium',
      });
      const source = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            fix: {
              steps: [
                {
                  prompt: `Fix workflow attempt ${template('run.attempt')}.`,
                  session: {key: 'implementation', mode: 'resume'},
                },
              ],
            },
          },
        }),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
        resolveAgentDefaults,
      });
      const [sourceJob] = await getJobsByWorkflowRunId(source.id);
      if (!sourceJob) throw new Error('Missing source fix job');
      await markJob([sourceJob], 'fix', 'failed');
      await updateWorkflowRunStatus({
        workflowRunId: source.id,
        status: 'failed',
        expectedVersion: 1,
      });

      const rerun = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'failed',
        actorUserId: crypto.randomUUID(),
      });

      const [rerunJob] = await getJobsByWorkflowRunId(rerun.id);
      if (!rerunJob) throw new Error('Missing rerun fix job');
      const agentStep = (await getStepsByJobId(rerunJob.id)).find((step) => step.type === 'agent');
      expect(resolveAgentDefaults).toHaveBeenCalledTimes(1);
      expect(agentStep?.config).toMatchObject({
        harness: 'pi',
        provider: 'openai',
        model: 'gpt-5.5-pro',
        thinking: 'medium',
        prompt: 'Fix workflow attempt 2.',
        session: {key: 'implementation', mode: 'resume'},
      });
    });

    test('re-materializes attempt-scoped config across consecutive reruns', async () => {
      const source = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            publish: {
              steps: [
                {
                  key: 'publish',
                  run: 'echo publish',
                  env: {IDENTIFIER: `${template('run.id')}-${template('run.attempt')}`},
                },
              ],
            },
          },
        }),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      const [sourceJob] = await getJobsByWorkflowRunId(source.id);
      if (!sourceJob) throw new Error('Missing source publish job');
      await markJob([sourceJob], 'publish', 'failed');
      await updateWorkflowRunStatus({
        workflowRunId: source.id,
        status: 'failed',
        expectedVersion: 1,
      });

      const second = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });
      const [secondJob] = await getJobsByWorkflowRunId(second.id);
      if (!secondJob) throw new Error('Missing second-attempt publish job');
      await markJob([secondJob], 'publish', 'failed');
      await updateWorkflowRunStatus({
        workflowRunId: second.id,
        status: 'failed',
        expectedVersion: 1,
      });

      const third = await createRerunWorkflowRun({
        workflowRunId: second.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      const secondStep = (await getStepsByJobId(secondJob.id)).find(
        (step) => step.key === 'publish',
      );
      const [thirdJob] = await getJobsByWorkflowRunId(third.id);
      if (!thirdJob) throw new Error('Missing third-attempt publish job');
      const thirdStep = (await getStepsByJobId(thirdJob.id)).find((step) => step.key === 'publish');
      expect(second).toMatchObject({id: source.id, currentAttempt: 2});
      expect(third).toMatchObject({id: source.id, currentAttempt: 3});
      expect(secondStep?.config).toMatchObject({env: {IDENTIFIER: `${source.id}-2`}});
      expect(thirdStep?.config).toMatchObject({env: {IDENTIFIER: `${source.id}-3`}});
    });

    test('keeps the workflow attempt stable across a step restart', async () => {
      const source = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            publish: {
              steps: [
                {
                  key: 'producer',
                  run: 'echo publish',
                  env: {ATTEMPT: template('run.attempt')},
                },
                {
                  key: 'review',
                  run: 'exit 1',
                  gate: {
                    success: expression('step.exit_code == 0'),
                    onFailure: {restartFrom: 'producer'},
                  },
                },
              ],
            },
          },
        }),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      const [sourceJob] = await getJobsByWorkflowRunId(source.id);
      if (!sourceJob) throw new Error('Missing source publish job');
      await stripSetupStep(sourceJob.id);
      await markJob([sourceJob], 'publish', 'failed');
      await updateWorkflowRunStatus({
        workflowRunId: source.id,
        status: 'failed',
        expectedVersion: 1,
      });

      const rerun = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });
      const [rerunJob] = await getJobsByWorkflowRunId(rerun.id);
      if (!rerunJob) throw new Error('Missing rerun publish job');
      const producer = await nextStepForJob(rerunJob.id);
      if (producer.kind !== 'step') throw new Error('Expected producer step');
      await recordStepResult({
        jobExecutionId: producer.step.jobExecutionId,
        stepId: producer.step.id,
        status: 'succeeded',
        exitCode: 0,
      });
      const review = await nextStepForJob(rerunJob.id);
      if (review.kind !== 'step') throw new Error('Expected review step');
      const restart = await recordStepResult({
        jobExecutionId: review.step.jobExecutionId,
        stepId: review.step.id,
        status: 'failed',
        error: {message: 'review failed'},
        exitCode: 1,
      });

      const retriedProducer = await nextStepForJob(rerunJob.id);
      expect(rerun.currentAttempt).toBe(2);
      expect(restart).toEqual({jobFinished: false});
      expect(retriedProducer).toEqual({
        kind: 'step',
        step: expect.objectContaining({
          id: producer.step.id,
          currentAttempt: 2,
          config: {run: 'echo publish', env: {ATTEMPT: '2'}},
        }),
        dispatched: true,
      });
      const attempts = await getStepAttempts(rerunJob.id);
      expect(
        attempts.find((attempt) => attempt.stepId === producer.step.id && attempt.attempt === 2),
      ).toMatchObject({
        config: {run: 'echo publish', env: {ATTEMPT: '2'}},
        evaluationTrace: expect.arrayContaining([
          expect.objectContaining({
            expression: 'run.attempt',
            evaluatedAt: 'run-creation',
            value: '2',
          }),
        ]),
      });
    });

    test('failed mode leaves carried step config on its source attempt', async () => {
      const source = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            build: {
              steps: [{key: 'build', run: 'echo build', env: {ATTEMPT: template('run.attempt')}}],
            },
            publish: {
              steps: [
                {key: 'publish', run: 'echo publish', env: {ATTEMPT: template('run.attempt')}},
              ],
            },
          },
        }),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      const sourceJobs = await getJobsByWorkflowRunId(source.id);
      await markJob(sourceJobs, 'build', 'succeeded');
      await markJob(sourceJobs, 'publish', 'failed');
      await updateWorkflowRunStatus({
        workflowRunId: source.id,
        status: 'failed',
        expectedVersion: 1,
      });

      const rerun = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'failed',
        actorUserId: crypto.randomUUID(),
      });

      const rerunJobs = await getJobsByWorkflowRunId(rerun.id);
      const build = rerunJobs.find((job) => job.key === 'build');
      const publish = rerunJobs.find((job) => job.key === 'publish');
      const buildStep = (await getStepsByJobId(build?.id as string)).find(
        (step) => step.key === 'build',
      );
      const publishStep = (await getStepsByJobId(publish?.id as string)).find(
        (step) => step.key === 'publish',
      );
      expect(build).toMatchObject({status: 'succeeded', carriedOver: true});
      expect(buildStep?.config).toMatchObject({env: {ATTEMPT: '1'}});
      expect(publish).toMatchObject({status: 'pending', carriedOver: false});
      expect(publishStep?.config).toMatchObject({env: {ATTEMPT: '2'}});
    });

    test('reruns clone the parsed model onto the new attempt', async () => {
      const source = await createTerminalSourceRun();

      await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      const attempts = await listTestRunAttempts({workflowRunId: source.id, projectId});
      const sourceAttempt = attempts.find((attempt) => attempt.attempt === 1);
      const rerunAttempt = attempts.find((attempt) => attempt.attempt === 2);
      const reloadedRerunAttempt = await getWorkflowRunAttemptById(rerunAttempt?.id as string);
      expect(reloadedRerunAttempt?.model).toEqual(sourceAttempt?.model);
    });

    test('failed and full reruns preserve the materialized gate attempt limit', async () => {
      async function createTerminalGatedSourceRun() {
        const source = await createWorkflowRun({
          workspaceId,
          projectId,
          definitionId,
          model: buildModel({
            jobs: {
              build: {
                steps: [
                  {key: 'producer', run: 'echo producer'},
                  {
                    key: 'review',
                    run: 'echo review',
                    gate: {onFailure: {restartFrom: 'producer', maxAttempts: 25}},
                  },
                ],
              },
            },
          }),
          triggerPayload: {
            source: 'manual',
            event: 'fire',
            subscriptionId: crypto.randomUUID(),
            userId: crypto.randomUUID(),
          },
        });
        const sourceJobs = await getJobsByWorkflowRunId(source.id);
        await markJob(sourceJobs, 'build', 'failed');
        await updateWorkflowRunStatus({
          workflowRunId: source.id,
          status: 'failed',
          expectedVersion: 1,
        });
        return source;
      }

      for (const mode of ['failed', 'all'] as const) {
        const source = await createTerminalGatedSourceRun();
        await createRerunWorkflowRun({
          workflowRunId: source.id,
          mode,
          actorUserId: crypto.randomUUID(),
        });

        const rerunJob = (await getJobsByWorkflowRunId(source.id)).find(
          (job) => job.key === 'build',
        );
        if (!rerunJob) throw new Error('Missing rerun job');
        const rerunGateStep = (await getStepsByJobId(rerunJob.id)).find(
          (step) => step.position === 2,
        );
        expect(rerunGateStep?.config).toMatchObject({
          gate: {on_failure: {max_attempts: 25}},
        });
      }
    });

    test('reruns consume the frozen agent tool materialization snapshot', async () => {
      const resolveAgentDefaults = vi.fn<AgentDefaultsResolver>().mockReturnValue({
        harness: 'pi',
        provider: 'openai',
        model: 'gpt-5.5-pro',
        thinking: 'medium',
      });
      const getAgentToolsContext = vi.fn().mockResolvedValue({
        catalogs: [
          {
            provider: 'github',
            tools: [
              {
                id: 'issue_read',
                description: 'Read issues.',
                sensitivity: 'read',
                sensitive: false,
                requiredScope: [{permission: 'issues', access: 'read'}],
                inputSchema: {type: 'object'},
                methods: [
                  {
                    id: 'get',
                    description: 'Get an issue.',
                    sensitivity: 'read',
                    sensitive: false,
                    requiredScope: [{permission: 'issues', access: 'read'}],
                  },
                ],
              },
            ],
          },
        ],
        workspaceConnections: [
          {
            id: 'connection-1',
            slug: 'github-main',
            provider: 'github',
            capabilities: ['agent_tools'],
          },
        ],
        defaultConnection: {
          id: 'connection-1',
          slug: 'github-main',
          provider: 'github',
        },
      });
      const integrations = {getAgentToolsContext} as unknown as IntegrationsModuleClient;
      const projects = {
        getProjectById: vi.fn().mockResolvedValue({
          project: {sourceConnectionId: 'connection-1'},
        }),
      } as unknown as ProjectsModuleClient;
      const source = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            fix: {
              steps: [
                {
                  key: 'fix',
                  harness: 'pi',
                  provider: 'openai',
                  model: 'gpt-5.5-pro',
                  thinking: 'medium',
                  prompt: `Fix attempt ${template('run.attempt')}.`,
                  integrations: [
                    {
                      connection: 'github-main',
                      include: ['issue_read.get'],
                      allowWrite: false,
                    },
                  ],
                },
              ],
            },
          },
        }),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
        integrations,
        projects,
        resolveAgentDefaults,
      });
      const [sourceJob] = await getJobsByWorkflowRunId(source.id);
      if (!sourceJob) throw new Error('Missing source fix job');
      await markJob([sourceJob], 'fix', 'failed');
      await updateWorkflowRunStatus({
        workflowRunId: source.id,
        status: 'failed',
        expectedVersion: 1,
      });
      const [sourceAttempt] = await listTestRunAttempts({workflowRunId: source.id, projectId});
      const snapshot = sourceAttempt?.agentToolMaterialization;
      const snapshotIntegrations = snapshot?.steps[0]?.integrations;
      if (snapshotIntegrations === undefined)
        throw new Error('Missing source integration snapshot');

      await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      const attempts = await listTestRunAttempts({workflowRunId: source.id, projectId});
      const rerunAttempt = attempts.find((attempt) => attempt.attempt === 2);
      expect(rerunAttempt?.agentToolMaterialization).toEqual(snapshot);
      expect(getAgentToolsContext).toHaveBeenCalledTimes(1);
      expect(resolveAgentDefaults).toHaveBeenCalledTimes(1);
      const [rerunJob] = await getJobsByWorkflowRunId(source.id);
      if (!rerunJob) throw new Error('Missing rerun fix job');
      const rerunAgentStep = (await getStepsByJobId(rerunJob.id)).find(
        (step) => step.type === 'agent',
      );
      expect(rerunAgentStep?.config).toMatchObject({
        prompt: 'Fix attempt 2.',
        integrations: snapshotIntegrations,
      });
    });

    test('reruns re-materialize each job checkout policy from the model', async () => {
      const source = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            build: {
              checkout: {
                permissions: {contents: 'write'},
                persistCredentials: false,
              },
              steps: [{run: 'echo build'}],
            },
          },
        }),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      const sourceJobs = await getJobsByWorkflowRunId(source.id);
      const sourceJob = sourceJobs[0];
      if (!sourceJob) throw new Error('Missing source job');
      await db()
        .update(jobs)
        .set({checkoutPersistCredentials: true, checkoutPermissionsContents: 'read'})
        .where(eq(jobs.id, sourceJob.id));
      await markJob(sourceJobs, 'build', 'failed');
      await updateWorkflowRunStatus({
        workflowRunId: source.id,
        status: 'failed',
        expectedVersion: 1,
      });

      const rerun = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      const rerunJobs = await getJobsByWorkflowRunId(rerun.id);
      expect(rerunJobs[0]?.checkout).toEqual({
        permissions: {contents: 'write'},
        persistCredentials: false,
      });
    });

    test('reruns preserve the original resolved agent step config', async () => {
      const resolveAgentDefaults = vi.fn<AgentDefaultsResolver>().mockReturnValue({
        harness: 'pi',
        provider: 'openai',
        model: 'gpt-5.5-pro',
        thinking: 'medium',
      });
      const source = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            fix: {
              steps: [
                {
                  harness: 'pi',
                  tools: ['read', 'web_search'],
                  prompt: 'Fix the failing tests.',
                },
              ],
            },
          },
        }),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
        resolveAgentDefaults,
      });
      const sourceJobs = await getJobsByWorkflowRunId(source.id);
      await markJob(sourceJobs, 'fix', 'failed');
      await updateWorkflowRunStatus({
        workflowRunId: source.id,
        status: 'failed',
        expectedVersion: 1,
      });

      const rerun = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      const rerunJobs = await getJobsByWorkflowRunId(rerun.id);
      const rerunSteps = await getStepsByJobId(rerunJobs[0]?.id as string);
      const agentStep = rerunSteps.find((step) => step.type === 'agent');
      expect(resolveAgentDefaults).toHaveBeenCalledTimes(1);
      expect(agentStep?.config).toEqual({
        harness: 'pi',
        model: 'gpt-5.5-pro',
        provider: 'openai',
        thinking: 'medium',
        tools: ['read', 'web_search'],
        prompt: 'Fix the failing tests.',
      });
    });

    test('reruns clone authored step config', async () => {
      const source = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({jobs: {build: {steps: [{run: `echo "${template('run.id')}"`}]}}}),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      await updateWorkflowRunStatus({
        workflowRunId: source.id,
        status: 'failed',
        expectedVersion: 1,
      });

      const rerun = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });
      const rerunJobs = await getJobsByWorkflowRunId(rerun.id);
      const userStep = (await getStepsByJobId(rerunJobs[0]?.id as string))[1];

      expect(userStep?.authoredConfig).toEqual({run: `echo "${template('run.id')}"`});
    });

    test('reruns dispatch from the preserved step config plan', async () => {
      const source = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            build: {
              steps: [
                {key: 'build', run: 'build'},
                {
                  key: 'deploy',
                  run: 'deploy',
                  env: {
                    ATTEMPT: template('run.attempt'),
                    SHA: template('steps.build.outputs.sha'),
                  },
                },
              ],
            },
          },
        }),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      const sourceJobs = await getJobsByWorkflowRunId(source.id);
      const sourceJob = sourceJobs[0];
      if (!sourceJob) throw new Error('Expected source job');
      await stripSetupStep(sourceJob.id);
      const sourceSteps = await getStepsByJobId(sourceJob.id);
      const sourceProducer = sourceSteps[0];
      const sourceConsumer = sourceSteps[1];
      if (!sourceProducer || !sourceConsumer) throw new Error('Expected source steps');
      const shaPlan = stepOutputField('build', 'sha');
      await updateWorkflowRunStatus({
        workflowRunId: source.id,
        status: 'failed',
        expectedVersion: 1,
      });
      const rerun = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });
      const rerunJobs = await getJobsByWorkflowRunId(rerun.id);
      const rerunJob = rerunJobs[0];
      if (!rerunJob) throw new Error('Expected rerun job');
      const producer = await nextStepForJob(rerunJob.id);
      if (producer.kind !== 'step') throw new Error('Expected producer step');
      await recordStepResult({
        jobExecutionId: producer.step.jobExecutionId,
        stepId: producer.step.id,
        status: 'succeeded',
        output: {sha: 'new-snapshot'},
      });

      const consumer = await nextStepForJob(rerunJob.id);

      expect(consumer).toEqual({
        kind: 'step',
        step: expect.objectContaining({
          key: 'deploy',
          config: {run: 'deploy', env: {ATTEMPT: '2', SHA: 'new-snapshot'}},
          configPlan: expect.objectContaining({env: {SHA: shaPlan}}),
        }),
        dispatched: true,
      });
      const attempts = await getStepAttempts(rerunJob.id);
      expect(attempts.find((attempt) => attempt.stepId === sourceConsumer.id)).toBeUndefined();
      const consumerAttempt = attempts.find((attempt) => attempt.stepId !== producer.step.id);
      expect(consumerAttempt).toMatchObject({
        config: {run: 'deploy', env: {ATTEMPT: '2', SHA: 'new-snapshot'}},
      });
      expect(consumerAttempt?.evaluationTrace).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            expression: 'run.attempt',
            evaluatedAt: 'run-creation',
            value: '2',
          }),
          expect.objectContaining({
            expression: 'steps.build.outputs.sha',
            evaluatedAt: 'step-dispatch',
            value: 'new-snapshot',
          }),
        ]),
      );
    });

    test('reruns copy the source job execution name', async () => {
      const source = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            deploy: {
              executionName: `Deploy ${template('inputs.environment')}`,
              steps: [{run: 'echo deploy'}],
            },
          },
        }),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
        inputs: {environment: 'prod'},
      });
      const [sourceJob] = await getJobsByWorkflowRunId(source.id);
      if (!sourceJob) throw new Error('Missing deploy job');
      await markJob([sourceJob], 'deploy', 'failed');
      const [sourceExecution] = await getJobExecutionsByJobId(sourceJob.id);
      if (!sourceExecution) throw new Error('Missing deploy execution');
      await db()
        .update(jobExecutions)
        .set({name: 'Deploy prod (attempt 1)'})
        .where(eq(jobExecutions.id, sourceExecution.id));
      await updateWorkflowRunStatus({
        workflowRunId: source.id,
        status: 'failed',
        expectedVersion: 1,
      });

      const rerun = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      const [rerunJob] = await getJobsByWorkflowRunId(rerun.id);
      if (!rerunJob) throw new Error('Missing rerun deploy job');
      const [rerunExecution] = await getJobExecutionsByJobId(rerunJob.id);
      expect(rerunExecution?.name).toBe('Deploy prod (attempt 1)');
    });

    test('reruns preserve a null name override instead of copying the fallback', async () => {
      const source = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            deploy: {name: 'Deploy', steps: [{run: 'echo deploy'}]},
          },
        }),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      const [sourceJob] = await getJobsByWorkflowRunId(source.id);
      if (!sourceJob) throw new Error('Missing deploy job');
      await markJob([sourceJob], 'deploy', 'failed');
      const [sourceExecution] = await getJobExecutionsByJobId(sourceJob.id);
      if (!sourceExecution) throw new Error('Missing deploy execution');
      expect(sourceExecution.nameOverride).toBeNull();
      expect(sourceExecution.name).toBe('Deploy');
      await updateWorkflowRunStatus({
        workflowRunId: source.id,
        status: 'failed',
        expectedVersion: 1,
      });

      const rerun = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      const [rerunJob] = await getJobsByWorkflowRunId(rerun.id);
      if (!rerunJob) throw new Error('Missing rerun deploy job');
      const [rerunExecution] = await getJobExecutionsByJobId(rerunJob.id);
      expect(rerunExecution?.nameOverride).toBeNull();
      expect(rerunExecution?.name).toBe('Deploy');
      const [storedRerunExecution] = await db()
        .select({name: jobExecutions.name})
        .from(jobExecutions)
        .where(eq(jobExecutions.jobId, rerunJob.id));
      expect(storedRerunExecution?.name).toBeNull();
    });

    test('writes one run-attempt-created outbox event for the rerun', async () => {
      const source = await createTerminalSourceRun();

      const rerun = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      const events = await runAttemptCreatedEvents(rerun.id);
      expect(events.find((event) => event.attempt === 2)).toEqual(
        expect.objectContaining({
          workflowRunId: rerun.id,
          attempt: 2,
          workspaceId: rerun.workspaceId,
          projectId: rerun.projectId,
          definitionId: rerun.definitionId,
        }),
      );
      expect(events.find((event) => event.attempt === 2)).not.toHaveProperty(
        'carryOverFromWorkflowRunAttemptId',
      );
    });

    test('failed mode carries succeeded jobs and resets every non-succeeded job', async () => {
      const source = await createTerminalSourceRun();
      const sourceJobs = await getJobsByWorkflowRunId(source.id);
      for (const job of sourceJobs) {
        await db()
          .update(jobs)
          .set({outputs: {source: job.key}})
          .where(eq(jobs.id, job.id));
      }

      const rerun = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'failed',
        actorUserId: crypto.randomUUID(),
      });
      const sourceAttempts = await listTestRunAttempts({workflowRunId: source.id, projectId});
      const sourceAttempt = sourceAttempts.find((attempt) => attempt.attempt === 1);
      if (!sourceAttempt) throw new Error('Expected source attempt');
      const events = await runAttemptCreatedEvents(rerun.id);
      expect(events.find((event) => event.attempt === 2)).toMatchObject({
        carryOverFromWorkflowRunAttemptId: sourceAttempt.id,
      });

      const rerunJobs = await getJobsByWorkflowRunId(rerun.id);
      const build = rerunJobs.find((job) => job.key === 'build');
      const test = rerunJobs.find((job) => job.key === 'test');
      const deploy = rerunJobs.find((job) => job.key === 'deploy');
      const notify = rerunJobs.find((job) => job.key === 'notify');
      expect(build).toMatchObject({
        status: 'succeeded',
        carriedOver: true,
        outputs: {source: 'build'},
      });
      expect(test).toMatchObject({status: 'pending', carriedOver: false, outputs: null});
      expect(deploy).toMatchObject({status: 'pending', carriedOver: false, outputs: null});
      expect(notify).toMatchObject({status: 'pending', carriedOver: false, outputs: null});

      const buildSteps = await getStepsByJobId(build?.id as string);
      expect(buildSteps.every((step) => step.status === 'succeeded')).toBe(true);
      expect(buildSteps.every((step) => step.currentAttempt === 1)).toBe(true);
      expect(await getStepAttempts(build?.id as string)).toEqual([]);
      const buildExecutions = await getJobExecutionsByJobId(build?.id as string);
      expect(buildExecutions).toHaveLength(1);
      expect(buildExecutions[0]).toMatchObject({
        jobId: build?.id,
        status: 'succeeded',
      });
      expect(buildExecutions[0]?.finishedAt).toBeInstanceOf(Date);

      for (const job of [test, deploy, notify]) {
        const jobSteps = await getStepsByJobId(job?.id as string);
        expect(jobSteps.every((step) => step.status === 'pending')).toBe(true);
        expect(jobSteps.every((step) => step.error === null)).toBe(true);
      }
    });

    test('failed mode preserves the claimed session on a carried-over agent step', async () => {
      const source = await createTerminalSourceRun();
      const sourceJobs = await getJobsByWorkflowRunId(source.id);
      const sourceBuild = sourceJobs.find((job) => job.key === 'build');
      if (!sourceBuild) throw new Error('Missing source build job');
      const sourceBuildSteps = await getStepsByJobId(sourceBuild.id);
      const sourceAgentStep = sourceBuildSteps.find((step) => step.type === 'run');
      if (!sourceAgentStep) throw new Error('Missing source build step');
      const session = {
        id: crypto.randomUUID(),
        key: 'main',
        mode: 'resume' as const,
        segment: 3,
      };
      await db()
        .update(stepsTable)
        .set({
          type: 'agent',
          config: {
            harness: 'pi',
            provider: 'openai',
            model: 'gpt-5.5-pro',
            thinking: 'medium',
            prompt: 'Continue.',
            session,
          },
          configPlan: {
            agent: {session: {key: literalField('main'), mode: 'resume'}},
          },
          authoredConfig: {prompt: 'Continue.', session: {key: 'main', mode: 'resume'}},
        })
        .where(eq(stepsTable.id, sourceAgentStep.id));

      const rerun = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'failed',
        actorUserId: crypto.randomUUID(),
      });
      const rerunJobs = await getJobsByWorkflowRunId(rerun.id);
      const rerunBuild = rerunJobs.find((job) => job.key === 'build');
      if (!rerunBuild) throw new Error('Missing rerun build job');
      const rerunBuildSteps = await getStepsByJobId(rerunBuild.id);

      expect(rerunBuild).toMatchObject({status: 'succeeded', carriedOver: true});
      expect(rerunBuildSteps.find((step) => step.type === 'agent')).toMatchObject({
        status: 'succeeded',
        config: expect.objectContaining({session}),
      });
    });

    test('increments attempts across a lineage', async () => {
      const source = await createTerminalSourceRun();

      const second = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });
      await updateWorkflowRunStatus({
        workflowRunId: second.id,
        status: 'failed',
        expectedVersion: 1,
      });
      const third = await createRerunWorkflowRun({
        workflowRunId: second.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      expect(second.currentAttempt).toBe(2);
      expect(second.id).toBe(source.id);
      expect(third).toMatchObject({id: source.id, currentAttempt: 3});

      const secondJobs = await getJobsByWorkflowRunId(second.id);
      const secondBuild = secondJobs.find((job) => job.key === 'build');
      if (!secondBuild) throw new Error('Missing second-attempt build job');
      const [secondBuildExecution] = await getJobExecutionsByJobId(secondBuild.id);
      expect(secondBuildExecution?.runner).toEqual(['attempt-2', 'ubuntu-latest']);

      const sourceContext = assembleWorkflowRunContext({
        run: source,
        triggerPayload: source.triggerPayload,
        inputs: source.inputs,
      });
      const secondContext = assembleWorkflowRunContext({
        run: second,
        triggerPayload: second.triggerPayload,
        inputs: second.inputs,
      });
      expect(sourceContext.run).toMatchObject({id: source.id, attempt: 1n});
      expect(secondContext.run).toMatchObject({id: source.id, attempt: 2n});
    });

    test('rejects a retry with the original expected attempt after a rerun', async () => {
      const source = await createTerminalSourceRun();

      const second = await createRerunWorkflowRun({
        workflowRunId: source.id,
        expectedAttempt: 1,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      await expect(
        createRerunWorkflowRun({
          workflowRunId: source.id,
          expectedAttempt: 1,
          mode: 'all',
          actorUserId: crypto.randomUUID(),
        }),
      ).rejects.toMatchObject({
        currentAttempt: 2,
      });

      await expect(getWorkflowRunById(source.id)).resolves.toMatchObject({
        currentAttempt: second.currentAttempt,
      });
      const attempts = await listTestRunAttempts({workflowRunId: source.id, projectId});
      expect(attempts).toHaveLength(2);
    });

    test('pins the current attempt as the source across consecutive failed reruns', async () => {
      const source = await createTerminalSourceRun();
      const second = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'failed',
        actorUserId: crypto.randomUUID(),
      });
      const secondJobs = await getJobsByWorkflowRunId(second.id);
      await markJob(secondJobs, 'test', 'failed');
      await updateWorkflowRunStatus({
        workflowRunId: second.id,
        status: 'failed',
        expectedVersion: 1,
      });

      const third = await createRerunWorkflowRun({
        workflowRunId: second.id,
        mode: 'failed',
        actorUserId: crypto.randomUUID(),
      });
      const attempts = await listTestRunAttempts({workflowRunId: source.id, projectId});
      const firstAttempt = attempts.find((attempt) => attempt.attempt === 1);
      const secondAttempt = attempts.find((attempt) => attempt.attempt === 2);
      if (!firstAttempt || !secondAttempt) throw new Error('Expected source attempts');
      const events = await runAttemptCreatedEvents(third.id);

      expect(events.find((event) => event.attempt === 2)).toMatchObject({
        carryOverFromWorkflowRunAttemptId: firstAttempt.id,
      });
      expect(events.find((event) => event.attempt === 3)).toMatchObject({
        carryOverFromWorkflowRunAttemptId: secondAttempt.id,
      });
    });

    test('rejects a concurrent rerun while a new attempt is active', async () => {
      const source = await createTerminalSourceRun();

      const results = await Promise.allSettled([
        createRerunWorkflowRun({
          workflowRunId: source.id,
          mode: 'all',
          actorUserId: crypto.randomUUID(),
        }),
        createRerunWorkflowRun({
          workflowRunId: source.id,
          mode: 'all',
          actorUserId: crypto.randomUUID(),
        }),
      ]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    });

    test('rejects non-terminal sources and failed-mode runs with no failed jobs', async () => {
      const running = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: rerunModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      const succeeded = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: rerunModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      await updateWorkflowRunStatus({
        workflowRunId: succeeded.id,
        status: 'succeeded',
        expectedVersion: 1,
      });

      await expect(
        createRerunWorkflowRun({
          workflowRunId: running.id,
          mode: 'all',
          actorUserId: crypto.randomUUID(),
        }),
      ).rejects.toBeInstanceOf(RunNotTerminalError);
      await expect(
        createRerunWorkflowRun({
          workflowRunId: succeeded.id,
          mode: 'failed',
          actorUserId: crypto.randomUUID(),
        }),
      ).rejects.toBeInstanceOf(NoFailedJobsError);
    });

    test('rejects a missing source run', async () => {
      await expect(
        createRerunWorkflowRun({
          workflowRunId: crypto.randomUUID(),
          mode: 'all',
          actorUserId: crypto.randomUUID(),
        }),
      ).rejects.toBeInstanceOf(SourceRunNotFoundError);
    });
  });
});
