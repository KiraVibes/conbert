import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  channelSchema,
  channelsResponseSchema,
  workflowResponseSchema,
  workflowRunResponseSchema,
  workflowRunsResponseSchema,
  workflowsResponseSchema,
  type ChannelRequest,
  type WorkflowRequest,
  type WorkflowRunDto,
  type WorkflowStepInput,
} from '@conbert/schemas';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import { subscribeToWorkflows } from '@/lib/job-socket';

export const WORKFLOWS_KEY = ['workflows'] as const;
export const RUNS_KEY = ['workflow-runs'] as const;
export const CHANNELS_KEY = ['notification-channels'] as const;

export function useWorkflows() {
  return useQuery({
    queryKey: WORKFLOWS_KEY,
    queryFn: ({ signal }) => apiGet('/api/workflows', workflowsResponseSchema, { signal }),
    select: (data) => data.workflows,
  });
}

export const createWorkflow = (body: WorkflowRequest) =>
  apiPost('/api/workflows', body, workflowResponseSchema).then((r) => r.workflow);
export const updateWorkflow = (id: string, body: WorkflowRequest) =>
  apiPut(`/api/workflows/${id}`, body, workflowResponseSchema).then((r) => r.workflow);
export const deleteWorkflow = (id: string) => apiDelete(`/api/workflows/${id}`);
export const importWorkflow = (json: unknown) =>
  apiPost('/api/workflows/import', json, workflowResponseSchema).then((r) => r.workflow);
export const exportUrl = (id: string) => `/api/workflows/${id}/export`;

export const runWorkflow = (id: string, fileIds: string[], toList = true) =>
  apiPost(`/api/workflows/${id}/run`, { fileIds, toList }, workflowRunResponseSchema).then(
    (r) => r.run,
  );
export const testWorkflow = (id: string, fileId: string) =>
  apiPost(`/api/workflows/${id}/test`, { fileId }, workflowRunResponseSchema).then((r) => r.run);
export const quickRun = (steps: WorkflowStepInput[], fileIds: string[], name: string) =>
  apiPost(
    '/api/workflows/quick-run',
    { steps, fileIds, name, toList: true },
    workflowRunResponseSchema,
  ).then((r) => r.run);
export const removeRun = (id: string) => apiDelete(`/api/workflow-runs/${id}`);

/** Recent runs, kept live over the WebSocket. */
export function useWorkflowRuns() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: RUNS_KEY,
    queryFn: ({ signal }) => apiGet('/api/workflow-runs', workflowRunsResponseSchema, { signal }),
    select: (data) => data.runs,
  });
  useEffect(
    () =>
      subscribeToWorkflows((run) => {
        queryClient.setQueryData<{ runs: WorkflowRunDto[] }>(RUNS_KEY, (old) => {
          const list = old?.runs ?? [];
          return {
            runs: list.some((r) => r.id === run.id)
              ? list.map((r) => (r.id === run.id ? run : r))
              : [run, ...list],
          };
        });
      }),
    [queryClient],
  );
  return query;
}

export function useChannels() {
  return useQuery({
    queryKey: CHANNELS_KEY,
    queryFn: ({ signal }) =>
      apiGet('/api/notifications/channels', channelsResponseSchema, { signal }),
    select: (data) => data.channels,
  });
}

const channelResponse = z.object({ channel: channelSchema });
export const createChannel = (body: ChannelRequest) =>
  apiPost('/api/notifications/channels', body, channelResponse).then((r) => r.channel);
export const updateChannel = (id: string, body: ChannelRequest) =>
  apiPut(`/api/notifications/channels/${id}`, body, channelResponse).then((r) => r.channel);
export const deleteChannel = (id: string) => apiDelete(`/api/notifications/channels/${id}`);
export const testChannel = (id: string) => apiPost(`/api/notifications/channels/${id}/test`, {});
