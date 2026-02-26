import { vi } from "vitest";

/**
 * Create a mock BullMQ Job for testing
 */
export function createMockJob(
  name: string,
  data: any = {},
  opts: any = {},
): any {
  return {
    id: `job-${Math.random().toString(36).substring(7)}`,
    name,
    data,
    opts,
    queueQualifiedName: "mock-queue",
    updateData: vi.fn(async (newData) => {
      Object.assign(data, newData);
    }),
    moveToWaitingChildren: vi.fn(async () => true), // Default: wait for children
    getChildrenValues: vi.fn(async () => ({})),
    log: vi.fn(),
    updateProgress: vi.fn(),
  };
}

/**
 * Create a mock FlowProducer
 */
export function createMockFlowProducer() {
  return {
    add: vi.fn(async (flow) => ({
      job: {
        id: `flow-${Math.random().toString(36).substring(7)}`,
        ...flow,
      },
      children: flow.children || [],
    })),
  };
}
