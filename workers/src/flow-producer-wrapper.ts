import { FlowProducer } from "bullmq";
import { connection } from "./queues.js";

const flowProducer = new FlowProducer({ connection });

export const addJobToFlow = async (args: any) => {
  return flowProducer.add(args);
};
