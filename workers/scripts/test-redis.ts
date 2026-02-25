import "dotenv/config";
import { Job, Queue } from "bullmq";
import { connection, taskQueues, TaskQueueName } from "../src/queues.js";

async function main() {
  const errMsg =
    "child bull:llm-classify:4e9faa89-3526-4e48-acd4-20f5f02272dd-llm-classify failed";
  const match = errMsg.match(/child bull:([^:]+):([^ ]+) failed/);
  if (match) {
    const queueName = match[1];
    const jobId = match[2];
    console.log({ queueName, jobId });
    const queue =
      taskQueues[queueName as TaskQueueName] ||
      new Queue(queueName, { connection });
    const childJob = await Job.fromId(queue, jobId);
    if (childJob) {
      console.log(
        "Found child job:",
        childJob.id,
        "Failed Reason:",
        childJob.failedReason,
      );
    } else {
      console.log("Child job not found");
      const hgetRes = await connection.hget(
        `bull:${queueName}:${jobId}`,
        "failedReason",
      );
      console.log("hget Res:", hgetRes);
    }
  }
  process.exit(0);
}
main();
