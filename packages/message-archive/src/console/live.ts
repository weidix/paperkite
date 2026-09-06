import { Readable } from "node:stream";
import bigInt from "big-integer";
import { utils } from "telegram";
import { iterDownload } from "telegram/client/downloads.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { RuntimeLogger, SessionAccess } from "@paperkite/sdk";
import type { ArchiveClient } from "../archiver.js";
import type { StoredMediaFile } from "../storage/index.js";
import { extFromMime, fetchMessage, fileNameOf, isMissingPeer, liveMediaMime, parseRange, unwrapWebPage } from "./media.js";

const CHUNK_BYTES = 512 * 1024;

const DELETED_MESSAGE = "消息已从 Telegram 删除或会话无法访问";
const UNAVAILABLE_MESSAGE = "无法从 Telegram 取回该媒体";

export class LiveMediaError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export interface LiveMediaStreamOptions {
  readonly sessions: SessionAccess;
  readonly session: string;
  readonly logger: RuntimeLogger;
}

/**
 * 在线媒体直通：一次请求独立从 Telegram 取对应字节区间并转发给响应，
 * 逐块取用、即时释放会话，播放器的尾部元数据或拖动请求可随时插队。
 */
export class LiveMediaStreamer {
  constructor(private readonly deps: LiveMediaStreamOptions) {}

  async serve(
    request: FastifyRequest,
    reply: FastifyReply,
    file: StoredMediaFile,
    chatUsername: string | undefined,
    download: boolean
  ): Promise<Readable | undefined> {
    const { media, size, mime } = await this.resolveMedia(file, chatUsername);
    const range = request.headers.range;
    const part = range === undefined ? undefined : parseRange(range, size);
    if (range !== undefined && part === undefined) {
      reply.header("content-type", "application/json; charset=utf-8");
      reply.code(416).header("content-range", `bytes */${size}`);
      reply.send({ error: "range 请求无效" });
      return undefined;
    }
    const start = part?.start ?? 0;
    const end = part?.end ?? size - 1;
    reply.header("content-type", mime);
    reply.header("accept-ranges", "bytes");
    reply.header("cache-control", "no-store");
    if (part !== undefined) {
      reply.code(206);
      reply.header("content-range", `bytes ${start}-${end}/${size}`);
    }
    reply.header("content-length", String(end - start + 1));
    if (download) {
      reply.header("content-disposition", `attachment; filename="${downloadName(file, mime)}"`);
    }
    return Readable.from(this.pump(media, start, end - start + 1));
  }

  private async *pump(media: unknown, offset: number, totalBytes: number): AsyncGenerator<Buffer> {
    let remaining = totalBytes;
    let position = offset;
    while (remaining > 0) {
      const length = Math.min(CHUNK_BYTES, remaining);
      const bytes = await this.fetchPart(media, position, length);
      if (bytes === undefined || bytes.length !== length) {
        throw new Error("live media download truncated");
      }
      remaining -= bytes.length;
      position += bytes.length;
      yield bytes;
    }
  }

  private async fetchPart(media: unknown, offset: number, length: number): Promise<Buffer | undefined> {
    return this.deps.sessions.run(this.deps.session, async (client) => {
      const host = client as unknown as ArchiveClient;
      const parts: Buffer[] = [];
      let received = 0;
      for await (const chunk of liveChunksOf(host, media, offset, Math.ceil(length / CHUNK_BYTES))) {
        parts.push(chunk);
        received += chunk.length;
        if (received >= length) break;
      }
      if (received === 0) return undefined;
      return Buffer.concat(parts).subarray(0, length);
    });
  }

  private async resolveMedia(file: StoredMediaFile, chatUsername: string | undefined): Promise<{
    readonly media: unknown;
    readonly size: number;
    readonly mime: string;
  }> {
    try {
      const result = await this.deps.sessions.run(this.deps.session, async (client) => {
        const host = client as unknown as ArchiveClient;
        const message = await fetchMessage(host, file, chatUsername);
        if (message === undefined) return "missing" as const;
        if (message.media === undefined || message.media === null) return "unavailable" as const;
        const media = unwrapWebPage(message.media);
        const info = utils.getFileInfo(media as Parameters<typeof utils.getFileInfo>[0]);
        const size = totalBytesOf(info.size);
        if (!(size > 0)) return "unavailable" as const;
        return { media, size, mime: liveMediaMime(message) };
      });
      if (result === "missing") throw new LiveMediaError(410, DELETED_MESSAGE);
      if (result === "unavailable") throw new LiveMediaError(404, UNAVAILABLE_MESSAGE);
      return result;
    } catch (error) {
      if (error instanceof LiveMediaError) throw error;
      const missing = isMissingPeer(error);
      if (missing) {
        this.deps.logger.debug("live media peer missing for message " + file.messageId + ", likely deleted");
      } else {
        this.deps.logger.warn("live media fetch failed for message " + file.messageId, error);
      }
      throw new LiveMediaError(missing ? 410 : 404, missing ? DELETED_MESSAGE : UNAVAILABLE_MESSAGE);
    }
  }
}

function liveChunksOf(client: ArchiveClient, media: unknown, offset: number, limit: number): AsyncIterable<Buffer> {
  const provided = client.iterMediaChunks?.(media, { offset, limit });
  if (provided !== undefined) return provided;
  return iterDownload(client as unknown as Parameters<typeof iterDownload>[0], {
    file: media as unknown as Parameters<typeof iterDownload>[1]["file"],
    offset: bigInt(offset),
    limit,
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

/** 下载文件名：缺扩展名时按 mime 补齐。 */
function downloadName(file: StoredMediaFile, mime: string): string {
  const name = fileNameOf(file, "");
  const ext = extFromMime(mime);
  return ext !== "" && !name.includes(".") ? name + ext : name;
}