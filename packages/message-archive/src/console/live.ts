import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, open, rm, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { utils } from "telegram";
import { iterDownload } from "telegram/client/downloads.js";
import type { RuntimeLogger, SessionAccess } from "@paperkite/sdk";
import type { ArchiveClient, TelegramMessage } from "../archiver.js";
import type { StoredMediaFile } from "../storage/index.js";
import { fetchMessage, isMissingPeer, liveMediaMime, unwrapWebPage } from "./media.js";

const CHUNK_BYTES = 512 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;
const DEFAULT_CANCEL_GRACE_MS = 5 * 1_000;
const DEFAULT_CACHE_CAP_BYTES = 4 * 1024 * 1024 * 1024;

const DELETED_MESSAGE = "消息已从 Telegram 删除或会话无法访问";
const UNAVAILABLE_MESSAGE = "无法从 Telegram 取回该媒体";
const CANCELLED_MESSAGE = "加载已取消，请重试";

export type LiveOutcome =
  | { readonly ok: true; readonly size: number; readonly mime: string }
  | { readonly ok: false; readonly status: number; readonly message: string };

export interface LiveMediaManagerOptions {
  readonly sessions: SessionAccess;
  readonly session: string;
  readonly logger: RuntimeLogger;
  readonly cacheDir: string;
  readonly maxCacheBytes?: number;
  readonly cancelGraceMs?: number;
}

export interface LiveHandle {
  /** 等到知道总大小与 mime 或失败时兑现；失败即终止。 */
  readonly ready: Promise<LiveOutcome>;
  attach(): void;
  detach(): void;
  readStream(start: number, end: number): Readable;
}

/** 在线媒体渐进缓存：一份顺序下载落盘供多个消费端（含范围请求）同时读取。 */
export class LiveMediaManager {
  private readonly jobs = new Map<string, LiveJob>();
  private readonly maxCacheBytes: number;
  private cacheBytes = 0;

  constructor(private readonly deps: LiveMediaManagerOptions) {
    this.maxCacheBytes = deps.maxCacheBytes ?? DEFAULT_CACHE_CAP_BYTES;
  }

  acquire(file: StoredMediaFile, chatUsername: string | undefined): LiveHandle {
    const key = liveKey(file);
    const existing = this.jobs.get(key);
    if (existing !== undefined && existing.active) return existing;
    if (existing !== undefined) this.jobs.delete(key);
    const job = new LiveJob(key, file, chatUsername, this.deps);
    this.jobs.set(key, job);
    void job.run().then(() => this.settle(key, job));
    return job;
  }

  async close(): Promise<void> {
    for (const job of this.jobs.values()) job.cancel();
    await Promise.allSettled([...this.jobs.values()].map((job) => job.finished));
    this.jobs.clear();
  }

  private settle(key: string, job: LiveJob): void {
    if (job.ok) {
      this.cacheBytes += job.size;
      while (this.cacheBytes > this.maxCacheBytes) {
        const victim = [...this.jobs.values()].find((candidate) => candidate.ok && candidate.consumers === 0);
        if (victim === undefined) return;
        this.cacheBytes -= victim.size;
        victim.dispose();
        this.jobs.delete(victim.key);
      }
    } else {
      this.jobs.delete(key);
    }
  }
}

function liveKey(file: StoredMediaFile): string {
  return `${file.chatId}_${file.messageId}`;
}

class LiveJob implements LiveHandle {
  readonly ready: Promise<LiveOutcome>;
  readonly finished: Promise<void>;
  size = 0;
  ok = false;
  active = true;
  consumers = 0;
  availableBytes = 0;
  private resolvedReady = false;
  private readonly cachePath: string;
  private readonly cancelGraceMs: number;
  private cancelled = false;
  finishedSettled = false;
  private cancelTimer: NodeJS.Timeout | undefined;
  private readonly growthWaiters = new Set<() => void>();
  private resolveReady!: (value: LiveOutcome | PromiseLike<LiveOutcome>) => void;
  private resolveFinished!: () => void;

  constructor(
    readonly key: string,
    private readonly file: StoredMediaFile,
    private readonly chatUsername: string | undefined,
    private readonly deps: LiveMediaManagerOptions
  ) {
    this.cachePath = join(deps.cacheDir, `live_${key}`);
    this.cancelGraceMs = deps.cancelGraceMs ?? DEFAULT_CANCEL_GRACE_MS;
    this.ready = new Promise<LiveOutcome>((resolvePromise) => {
      this.resolveReady = resolvePromise;
    });
    this.finished = new Promise<void>((resolvePromise) => {
      this.resolveFinished = resolvePromise;
    });
  }

  attach(): void {
    this.consumers += 1;
    if (this.cancelTimer !== undefined) {
      clearTimeout(this.cancelTimer);
      this.cancelTimer = undefined;
    }
  }

  detach(): void {
    this.consumers -= 1;
    if (this.consumers <= 0 && !this.finishedSettled && this.cancelTimer === undefined) {
      const timer = setTimeout(() => {
        if (this.consumers <= 0 && !this.finishedSettled) this.cancel();
      }, this.cancelGraceMs);
      timer.unref();
      this.cancelTimer = timer;
    }
  }

  readStream(start: number, end: number): Readable {
    return new GrowingReadable(this, start, end);
  }

  cancel(): void {
    this.cancelled = true;
    this.notifyGrowth();
  }

  dispose(): void {
    this.active = false;
    void rm(this.cachePath, { force: true });
  }

  entryPath(): string {
    return this.cachePath;
  }

  async run(): Promise<void> {
    try {
      const result = await this.deps.sessions.run(this.deps.session, async (client) => {
        const host = client as unknown as ArchiveClient;
        const message = await fetchMessage(host, this.file, this.chatUsername);
        if (message === undefined) return "missing" as const;
        if (message.media === undefined || message.media === null) return "unavailable" as const;
        const info = utils.getFileInfo(unwrapWebPage(message.media) as Parameters<typeof utils.getFileInfo>[0]);
        const size = totalBytesOf(info.size);
        if (!(size > 0)) return "unavailable" as const;
        this.publish(size, liveMediaMime(message));
        await this.download(host, message, size);
        return this.cancelled ? "cancelled" as const : "ok" as const;
      });
      if (result === "missing") this.fail(410, DELETED_MESSAGE);
      else if (result === "unavailable") this.fail(404, UNAVAILABLE_MESSAGE);
      else if (result === "cancelled") this.fail(503, CANCELLED_MESSAGE);
      else this.complete();
    } catch (error) {
      const missing = isMissingPeer(error);
      if (missing) {
        this.deps.logger.debug("live media peer missing for message " + this.file.messageId + ", likely deleted");
      } else {
        this.deps.logger.warn("live media download failed for message " + this.file.messageId, error);
      }
      this.fail(missing ? 410 : 404, missing ? DELETED_MESSAGE : UNAVAILABLE_MESSAGE);
    } finally {
      this.finishedSettled = true;
      this.notifyGrowth();
      this.resolveFinished();
    }
  }

  private async download(client: ArchiveClient, message: TelegramMessage, size: number): Promise<void> {
    await mkdir(this.deps.cacheDir, { recursive: true });
    const writer = createWriteStream(this.cachePath);
    try {
      for await (const chunk of liveChunksOf(client, message)) {
        if (this.cancelled) return;
        await writeChunk(writer, chunk);
        this.availableBytes += chunk.length;
        this.notifyGrowth();
        if (this.cancelled) return;
      }
      this.availableBytes = size;
    } finally {
      await endWriter(writer);
    }
  }

  private publish(size: number, mime: string): void {
    this.size = size;
    this.resolvedReady = true;
    this.resolveReady({ ok: true, size, mime });
    this.notifyGrowth();
  }

  private fail(status: number, message: string): void {
    if (!this.resolvedReady) {
      this.resolvedReady = true;
      this.resolveReady({ ok: false, status, message });
    }
    void rm(this.cachePath, { force: true });
    this.notifyGrowth();
  }

  private complete(): void {
    this.ok = true;
    this.notifyGrowth();
  }

  private notifyGrowth(): void {
    for (const waiter of [...this.growthWaiters]) waiter();
  }

  waitUntil(predicate: () => boolean): Promise<void> {
    if (predicate()) return Promise.resolve();
    return new Promise<void>((resolvePromise) => {
      const waiter = (): void => {
        if (predicate()) {
          this.growthWaiters.delete(waiter);
          resolvePromise();
        }
      };
      this.growthWaiters.add(waiter);
      waiter();
    });
  }
}

/** 从渐进下载文件里按需读取：数据未到时等待增长，下载失败时抛错。 */
class GrowingReadable extends Readable {
  private position: number;
  private fd: FileHandle | undefined;

  constructor(
    private readonly job: LiveJob,
    start: number,
    private readonly end: number
  ) {
    super();
    this.position = start;
  }

  override async _read(): Promise<void> {
    try {
      for (;;) {
        if (this.position > this.end) {
          this.push(null);
          return;
        }
        const pending = this.job.availableBytes - this.position;
        if (pending <= 0) {
          if (this.job.finishedSettled) {
            if (!this.job.ok) throw new Error("live media download failed");
            this.push(null);
            return;
          }
          await this.job.waitUntil(
            () => this.job.availableBytes > this.position || this.job.finishedSettled
          );
          continue;
        }
        const want = Math.min(READ_CHUNK_BYTES, this.end + 1 - this.position, pending);
        const fd = this.fd ??= await open(this.job.entryPath(), "r");
        const { bytesRead, buffer } = await fd.read(Buffer.allocUnsafe(want), 0, want, this.position);
        if (bytesRead === 0) {
          await this.job.waitUntil(
            () => this.job.availableBytes > this.position || this.job.finishedSettled
          );
          continue;
        }
        this.position += bytesRead;
        if (!this.push(buffer.subarray(0, bytesRead))) return;
      }
    } catch (error) {
      this.destroy(error as Error);
    }
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.fd?.close().catch(() => undefined);
    callback(error);
  }
}

function liveChunksOf(client: ArchiveClient, message: TelegramMessage): AsyncIterable<Buffer> {
  const provided = client.iterMediaChunks?.(message);
  if (provided !== undefined) return provided;
  return iterDownload(client as unknown as Parameters<typeof iterDownload>[0], {
    file: unwrapWebPage(message.media) as unknown as Parameters<typeof iterDownload>[1]["file"],
    requestSize: CHUNK_BYTES
  });
}

/** gramjs 长整型在不同来源（原生 BigInt / number / big-integer 包装）下的字节数提取。 */
function totalBytesOf(size: unknown): number {
  if (typeof size === "bigint") return Number(size);
  if (typeof size === "number") return size;
  if (size !== undefined && size !== null && typeof (size as { toJSNumber?: unknown }).toJSNumber === "function") {
    return (size as { toJSNumber(): number }).toJSNumber();
  }
  return 0;
}

function writeChunk(writer: WriteStream, chunk: Buffer): Promise<void> {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    writer.write(chunk, (error) => {
      if (error) rejectPromise(error);
      else resolvePromise();
    });
  });
}

function endWriter(writer: WriteStream): Promise<void> {
  if (writer.writableFinished) return Promise.resolve();
  return new Promise<void>((resolvePromise, rejectPromise) => {
    const onError = (error: Error): void => rejectPromise(error);
    writer.once("error", onError);
    writer.end(() => {
      writer.off("error", onError);
      resolvePromise();
    });
  });
}