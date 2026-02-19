import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import cron from "node-cron";

export interface CronJob {
  id: string;
  schedule: string;
  prompt: string;
  chatId: string;
  createdAt: string;
}

const DATA_DIR = path.join(homedir(), ".jellyfish");
const CRON_FILE = path.join(DATA_DIR, "crons.json");

const activeTasks = new Map<string, ReturnType<typeof cron.schedule>>();
let fireHandler: ((job: CronJob) => Promise<void>) | undefined;

const ensureDataDir = async (): Promise<void> => {
  await mkdir(DATA_DIR, { recursive: true });
};

const scheduleJob = (job: CronJob): void => {
  if (!fireHandler) {
    return;
  }
  const task = cron.schedule(job.schedule, () => {
    void fireHandler?.(job);
  });
  activeTasks.set(job.id, task);
};

const unscheduleJob = (id: string): void => {
  const existing = activeTasks.get(id);
  if (!existing) {
    return;
  }
  existing.stop();
  existing.destroy();
  activeTasks.delete(id);
};

export const loadCrons = async (): Promise<CronJob[]> => {
  try {
    const raw = await Bun.file(CRON_FILE).text();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is CronJob => {
      if (typeof item !== "object" || item === null) {
        return false;
      }
      const record = item as Record<string, unknown>;
      return (
        typeof record.id === "string" &&
        typeof record.schedule === "string" &&
        typeof record.prompt === "string" &&
        typeof record.chatId === "string" &&
        typeof record.createdAt === "string"
      );
    });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return [];
    }
    throw error;
  }
};

export const saveCrons = async (jobs: CronJob[]): Promise<void> => {
  await ensureDataDir();
  await Bun.write(CRON_FILE, `${JSON.stringify(jobs, null, 2)}\n`);
};

export const addCron = async (schedule: string, prompt: string, chatId: string): Promise<CronJob> => {
  if (!cron.validate(schedule)) {
    throw new Error("Invalid cron expression");
  }

  const jobs = await loadCrons();
  const newJob: CronJob = {
    id: crypto.randomUUID(),
    schedule,
    prompt,
    chatId,
    createdAt: new Date().toISOString(),
  };
  jobs.push(newJob);
  await saveCrons(jobs);
  scheduleJob(newJob);
  return newJob;
};

export const removeCron = async (id: string): Promise<boolean> => {
  const jobs = await loadCrons();
  const nextJobs = jobs.filter((job) => job.id !== id);
  if (nextJobs.length === jobs.length) {
    return false;
  }
  await saveCrons(nextJobs);
  unscheduleJob(id);
  return true;
};

export const startCronScheduler = async (
  onFire: (job: CronJob) => Promise<void>,
): Promise<void> => {
  fireHandler = onFire;
  for (const task of activeTasks.values()) {
    task.stop();
    task.destroy();
  }
  activeTasks.clear();

  const jobs = await loadCrons();
  for (const job of jobs) {
    if (!cron.validate(job.schedule)) {
      console.warn(`Skipping invalid cron schedule for job ${job.id}`);
      continue;
    }
    scheduleJob(job);
  }
};
