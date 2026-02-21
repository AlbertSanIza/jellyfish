import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

export type AgentName = 'codex' | 'opencode' | 'claude'
export type JobStatus = 'running' | 'done' | 'failed' | 'killed'

export interface Job {
    id: string
    agent: AgentName
    task: string
    workdir: string
    chatId: string
    status: JobStatus
    pid?: number
    startedAt: string
    completedAt?: string
    exitCode?: number
    output: string
}

const DATA_DIR = path.join(homedir(), '.jellyfish')
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json')
const OUTPUT_LIMIT = 3000

const appendLimited = (existing: string, chunk: string, limit: number): string => {
    const merged = existing + chunk
    return merged.length <= limit ? merged : merged.slice(-limit)
}

const ensureDataDir = async (): Promise<void> => {
    await mkdir(DATA_DIR, { recursive: true })
}

let jobsWriteLock = Promise.resolve()

const withJobsWriteLock = async <T>(action: () => Promise<T>): Promise<T> => {
    const previous = jobsWriteLock
    let release = () => {}
    jobsWriteLock = new Promise<void>((resolve) => {
        release = resolve
    })
    await previous
    try {
        return await action()
    } finally {
        release()
    }
}

export const loadJobs = async (): Promise<Job[]> => {
    try {
        const raw = await Bun.file(JOBS_FILE).text()
        const parsed = JSON.parse(raw) as unknown
        if (!Array.isArray(parsed)) {
            return []
        }
        return parsed.filter((item): item is Job => {
            if (typeof item !== 'object' || item === null) {
                return false
            }

            const record = item as Record<string, unknown>
            const hasValidAgent = record.agent === 'codex' || record.agent === 'opencode' || record.agent === 'claude'
            const hasValidStatus = record.status === 'running' || record.status === 'done' || record.status === 'failed' || record.status === 'killed'
            return (
                typeof record.id === 'string' &&
                hasValidAgent &&
                typeof record.task === 'string' &&
                typeof record.workdir === 'string' &&
                typeof record.chatId === 'string' &&
                hasValidStatus &&
                typeof record.startedAt === 'string' &&
                typeof record.output === 'string'
            )
        })
    } catch (error) {
        const err = error as NodeJS.ErrnoException
        if (err.code === 'ENOENT') {
            return []
        }
        throw error
    }
}

export const saveJobs = async (jobs: Job[]): Promise<void> => {
    await ensureDataDir()
    await Bun.write(JOBS_FILE, `${JSON.stringify(jobs, null, 2)}\n`)
}

const updateJob = async (id: string, updater: (job: Job) => Job): Promise<Job | null> =>
    withJobsWriteLock(async () => {
        const jobs = await loadJobs()
        const index = jobs.findIndex((job) => job.id === id)
        if (index < 0) {
            return null
        }
        const updated = updater(jobs[index] as Job)
        jobs[index] = updated
        await saveJobs(jobs)
        return updated
    })

const readStream = async (stream: ReadableStream<Uint8Array> | null, onChunk: (chunk: string) => Promise<void> | void): Promise<void> => {
    if (!stream) {
        return
    }

    const reader = stream.getReader()
    const decoder = new TextDecoder()
    try {
        while (true) {
            const { value, done } = await reader.read()
            if (done) {
                break
            }
            if (!value) {
                continue
            }
            const text = decoder.decode(value, { stream: true })
            if (text) {
                await onChunk(text)
            }
        }
        const trailing = decoder.decode()
        if (trailing) {
            await onChunk(trailing)
        }
    } finally {
        reader.releaseLock()
    }
}

const commandForAgent = (agent: AgentName, task: string): string[] => {
    switch (agent) {
        case 'codex':
            return ['codex', '--full-auto', 'exec', task]
        case 'opencode':
            return ['/Applications/OpenCode.app/Contents/MacOS/opencode-cli', 'run', task]
        case 'claude':
            return ['claude', '--permission-mode', 'acceptEdits', '--print', task]
    }
}

export const spawnJob = async (
    agent: AgentName,
    task: string,
    workdir: string,
    chatId: string,
    onComplete: (job: Job) => Promise<void> | void
): Promise<Job> => {
    const id = crypto.randomUUID()
    const command = commandForAgent(agent, task)
    const proc = Bun.spawn(command, {
        cwd: workdir,
        stdout: 'pipe',
        stderr: 'pipe'
    })

    const baseJob: Job = {
        id,
        agent,
        task,
        workdir,
        chatId,
        status: 'running',
        pid: proc.pid,
        startedAt: new Date().toISOString(),
        output: ''
    }

    await withJobsWriteLock(async () => {
        const jobs = await loadJobs()
        jobs.push(baseJob)
        await saveJobs(jobs)
    })

    const appendOutput = async (chunk: string): Promise<void> => {
        await updateJob(id, (job) => ({
            ...job,
            output: appendLimited(job.output, chunk, OUTPUT_LIMIT)
        }))
    }

    void Promise.all([readStream(proc.stdout, appendOutput), readStream(proc.stderr, appendOutput)])

    void proc.exited.then(async (exitCode) => {
        const final = await updateJob(id, (job) => ({
            ...job,
            status: exitCode === 0 ? 'done' : job.status === 'killed' ? 'killed' : 'failed',
            completedAt: new Date().toISOString(),
            exitCode
        }))
        if (final) {
            await onComplete(final)
        }
    })

    return baseJob
}

export const listJobs = async (chatId: string): Promise<Job[]> => {
    const jobs = await loadJobs()
    return jobs
        .filter((job) => job.chatId === chatId)
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
        .slice(0, 10)
}

export const killJob = async (id: string): Promise<Job | null> => {
    const jobs = await loadJobs()
    const target = jobs.find((job) => job.id === id)
    if (!target) {
        return null
    }

    if (target.status !== 'running') {
        return target
    }

    if (typeof target.pid === 'number') {
        try {
            process.kill(target.pid, 'SIGTERM')
        } catch (error) {
            const err = error as NodeJS.ErrnoException
            if (err.code !== 'ESRCH') {
                throw error
            }
        }
    }

    return updateJob(id, (job) => ({
        ...job,
        status: 'killed',
        completedAt: new Date().toISOString()
    }))
}

export const getJob = async (id: string): Promise<Job | null> => {
    const jobs = await loadJobs()
    return jobs.find((job) => job.id === id) ?? null
}
