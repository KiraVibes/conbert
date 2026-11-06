import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { WorkflowStep } from '@conbert/core';
import {
  channelRequestSchema,
  runWorkflowRequestSchema,
  testWorkflowRequestSchema,
  workflowRequestSchema,
  workflowStepsSchema,
} from '@conbert/schemas';
import { currentUser } from '../auth/plugin';
import type { AppContext } from '../context';
import {
  createChannel,
  deleteChannel,
  listChannels,
  testChannel,
  updateChannel,
} from '../notifications/service';
import { getOwnFile } from '../storage/uploads';
import { toWorkflowRunDto } from '../workflows/executor';
import {
  cancelOrRemoveRun,
  createWorkflow,
  deleteWorkflow,
  exportWorkflow,
  importWorkflow,
  listRuns,
  listWorkflows,
  ownRun,
  ownWorkflow,
  startRun,
  toWorkflowDto,
  updateWorkflow,
} from '../workflows/service';

const idParams = z.object({ id: z.string().uuid() });
/** Quick action without a saved workflow ("In WebP umwandeln" from the list). */
const quickRunSchema = runWorkflowRequestSchema.extend({
  steps: workflowStepsSchema,
  name: z.string().trim().max(80).default(''),
});

export function registerWorkflowRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/workflows', async (request) => {
    const user = currentUser(request);
    return { workflows: listWorkflows(ctx, user.id) };
  });

  app.post('/api/workflows', async (request, reply) => {
    const user = currentUser(request);
    reply.status(201);
    return { workflow: createWorkflow(ctx, user.id, workflowRequestSchema.parse(request.body)) };
  });

  app.post('/api/workflows/import', async (request, reply) => {
    const user = currentUser(request);
    reply.status(201);
    return { workflow: importWorkflow(ctx, user.id, request.body) };
  });

  app.get('/api/workflows/:id', async (request) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    return { workflow: toWorkflowDto(ownWorkflow(ctx, user.id, id)) };
  });

  app.get('/api/workflows/:id/export', async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    const row = ownWorkflow(ctx, user.id, id);
    const name = row.name.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'workflow';
    reply.header('Content-Disposition', `attachment; filename="${name}.conbert-workflow.json"`);
    return exportWorkflow(row);
  });

  app.put('/api/workflows/:id', async (request) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    return {
      workflow: updateWorkflow(ctx, user.id, id, workflowRequestSchema.parse(request.body)),
    };
  });

  app.delete('/api/workflows/:id', async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    deleteWorkflow(ctx, user.id, id);
    reply.status(204);
  });

  app.post('/api/workflows/:id/run', async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    const body = runWorkflowRequestSchema.parse(request.body);
    const wf = ownWorkflow(ctx, user.id, id);
    reply.status(201);
    return {
      run: await startRun(ctx, user.id, {
        name: wf.name,
        workflowId: wf.id,
        steps: wf.steps as WorkflowStep[],
        keepOriginal: wf.keepOriginal,
        fileIds: body.fileIds,
        toList: body.toList,
      }),
    };
  });

  /** Test run with one file: nothing is saved or sent, the result is shown. */
  app.post('/api/workflows/:id/test', async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    const { fileId } = testWorkflowRequestSchema.parse(request.body);
    getOwnFile(ctx, user.id, fileId);
    const wf = ownWorkflow(ctx, user.id, id);
    reply.status(201);
    return {
      run: await startRun(ctx, user.id, {
        name: wf.name,
        workflowId: wf.id,
        steps: wf.steps as WorkflowStep[],
        keepOriginal: wf.keepOriginal,
        fileIds: [fileId],
        toList: false,
        test: true,
      }),
    };
  });

  app.post('/api/workflows/quick-run', async (request, reply) => {
    const user = currentUser(request);
    const body = quickRunSchema.parse(request.body);
    reply.status(201);
    return {
      run: await startRun(ctx, user.id, {
        name: body.name,
        workflowId: null,
        steps: body.steps as WorkflowStep[],
        keepOriginal: false,
        fileIds: body.fileIds,
        toList: body.toList,
      }),
    };
  });

  app.get('/api/workflow-runs', async (request) => {
    const user = currentUser(request);
    return { runs: listRuns(ctx, user.id) };
  });

  app.get('/api/workflow-runs/:id', async (request) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    return { run: toWorkflowRunDto(ownRun(ctx, user.id, id)) };
  });

  app.delete('/api/workflow-runs/:id', async (request) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    return { run: await cancelOrRemoveRun(ctx, user.id, id) };
  });

  // --- Notification channels ---
  app.get('/api/notifications/channels', async (request) => {
    const user = currentUser(request);
    return { channels: listChannels(ctx, user.id) };
  });

  app.post('/api/notifications/channels', async (request, reply) => {
    const user = currentUser(request);
    reply.status(201);
    return { channel: createChannel(ctx, user.id, channelRequestSchema.parse(request.body)) };
  });

  app.put('/api/notifications/channels/:id', async (request) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    return { channel: updateChannel(ctx, user.id, id, channelRequestSchema.parse(request.body)) };
  });

  app.delete('/api/notifications/channels/:id', async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    deleteChannel(ctx, user.id, id);
    reply.status(204);
  });

  app.post('/api/notifications/channels/:id/test', async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    await testChannel(ctx, user.id, id);
    reply.status(204);
  });
}
