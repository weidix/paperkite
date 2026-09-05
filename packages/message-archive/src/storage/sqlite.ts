import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  type AlbumRow,
  type ArchiveContextResult,
  type ArchiveQuery,
  type ArchiveSearchResult,
  type ArchiveStore,
  type BatchResult,
  type BlockwordAddResult,
  type BlockwordState,
  type ChatLedgerRow,
  type ChatRecord,
  type LastMessageInfo,
  type MediaRow,
  type MessageRecord,
  type MessageRow,
  type StoredMediaFile,
  albumEntryOf,
  buildContextEntries,
  groupKey,
  mediaKey,
  normalizeBlockword,
  normalizeContextLimit,
  normalizeLimit,
  normalizeOffset,
  normalizeRowId,
  normalizeTimeMode,
  splitTerms,
  toIsoDate,
  uniqueGroupKeys
} from "./model.js";

const MESSAGE_COLUMNS = `
  m.id AS row_id, m.message_id, m.chat_id, m.grouped_id, m.chat_title, m.date,
  m.sender_id, m.sender_username, m.sender_first_name, m.sender_last_name,
  m.has_media, m.media_type, m.message_type, m.text
`;

const MIME_SUBQUERY = `(
  SELECT mf.mime_type FROM media_files mf
   WHERE mf.chat_id = m.chat_id AND mf.message_id = m.message_id
   ORDER BY mf.id DESC LIMIT 1
)`;

/** 相册以组内第一条在时间线中定位，窗口按条目推进。 */
const GROUP_FIRST_CONDITION = `(
  m.grouped_id IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM messages g
     WHERE g.chat_id = m.chat_id AND g.grouped_id = m.grouped_id
       AND (g.date < m.date OR (g.date = m.date AND g.id < m.id))
  )
)`;

export class SqliteArchiveStore implements ArchiveStore {
  private readonly database: DatabaseSync;
  /** 屏蔽词内存缓存（小写归一）；读路径条件固定为 blocked = 0，与词数无关。 */
  private blockwords: readonly string[] = [];
  private blockwordsVersion = 0;

  constructor(readonly file: string) {
    mkdirSync(dirname(resolve(file)), { recursive: true });
    this.database = new DatabaseSync(resolve(file));
  }

  async init(): Promise<void> {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL,
        chat_id TEXT NOT NULL,
        grouped_id TEXT,
        chat_title TEXT,
        sender_id TEXT,
        sender_username TEXT,
        sender_first_name TEXT,
        sender_last_name TEXT,
        date TEXT NOT NULL,
        text TEXT,
        message_type TEXT DEFAULT 'text',
        reply_to_msg_id INTEGER,
        forward_from_id TEXT,
        forward_from_name TEXT,
        has_media INTEGER NOT NULL DEFAULT 0,
        media_type TEXT,
        media_path TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(message_id, chat_id)
      );
      CREATE INDEX IF NOT EXISTS idx_messages_chat_date ON messages(chat_id, date);
      CREATE INDEX IF NOT EXISTS idx_messages_chat_date_id ON messages(chat_id, date, id);
      CREATE INDEX IF NOT EXISTS idx_messages_chat_grouped ON messages(chat_id, grouped_id);
      CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
      CREATE TABLE IF NOT EXISTS media_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL,
        chat_id TEXT NOT NULL,
        media_type TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size INTEGER,
        mime_type TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (message_id, chat_id) REFERENCES messages (message_id, chat_id)
      );
      CREATE INDEX IF NOT EXISTS idx_media_message ON media_files(message_id, chat_id);
      CREATE TABLE IF NOT EXISTS chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT UNIQUE NOT NULL,
        title TEXT,
        username TEXT,
        type TEXT,
        description TEXT,
        members_count INTEGER,
        last_sync TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sync_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        start_date TEXT,
        end_date TEXT,
        messages_count INTEGER,
        media_count INTEGER,
        sync_started_at TEXT,
        sync_completed_at TEXT,
        status TEXT DEFAULT 'running'
      );
      CREATE TABLE IF NOT EXISTS blockwords (
        word TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );
    `);
    this.ensureBlockedColumn();
    this.blockwords = (this.database
      .prepare("SELECT word FROM blockwords ORDER BY word")
      .all() as readonly Record<string, unknown>[])
      .map((row) => String(row.word));
  }

  /** 老库迁移：messages 补 blocked 标志列。 */
  private ensureBlockedColumn(): void {
    const columns = this.database.prepare("PRAGMA table_info(messages)").all() as readonly Record<string, unknown>[];
    if (!columns.some((column) => String(column.name) === "blocked")) {
      this.database.exec("ALTER TABLE messages ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0");
    }
  }

  async close(): Promise<void> {
    this.database.close();
  }

  async saveChat(chat: ChatRecord): Promise<boolean> {
    const statement = this.database.prepare(`
      INSERT INTO chats (chat_id, title, username, type, description, members_count, last_sync, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET
        title = excluded.title,
        username = excluded.username,
        type = excluded.type,
        description = excluded.description,
        members_count = excluded.members_count,
        last_sync = excluded.last_sync
    `);
    const now = new Date().toISOString();
    statement.run(
      chat.chatId,
      chat.title ?? null,
      chat.username ?? null,
      chat.type ?? null,
      chat.description ?? null,
      chat.membersCount ?? null,
      now,
      now
    );
    return true;
  }

  async startSyncSession(chatId: string, startDate: string, endDate: string): Promise<number> {
    const result = this.database.prepare(`
      INSERT INTO sync_history (chat_id, start_date, end_date, sync_started_at, status)
      VALUES (?, ?, ?, ?, 'running')
    `).run(chatId, startDate, endDate, new Date().toISOString());
    return Number(result.lastInsertRowid);
  }

  async completeSyncSession(
    sessionId: number,
    messagesCount: number,
    mediaCount: number
  ): Promise<void> {
    if (sessionId < 0) return;
    this.database.prepare(`
      UPDATE sync_history
         SET sync_completed_at = ?, messages_count = ?, media_count = ?, status = 'completed'
       WHERE id = ?
    `).run(new Date().toISOString(), messagesCount, mediaCount, sessionId);
  }

  async getLastMessageInfo(chatId: string): Promise<LastMessageInfo | undefined> {
    const row = this.database.prepare(`
      SELECT message_id, date FROM messages
       WHERE chat_id = ?
       ORDER BY date DESC, message_id DESC
       LIMIT 1
    `).get(chatId) as { message_id: number; date: string } | undefined;
    return row ? { messageId: Number(row.message_id), date: row.date } : undefined;
  }

  async getChatUsername(chatId: string): Promise<string | undefined> {
    const row = this.database
      .prepare(`SELECT username FROM chats WHERE chat_id = ?`)
      .get(chatId) as { username: string | null } | undefined;
    const username = row?.username?.trim();
    return username || undefined;
  }

  async messageIdsExist(chatId: string, messageIds: readonly number[]): Promise<ReadonlySet<number>> {
    const ids = [...new Set(messageIds.map(Number))];
    if (!ids.length) return new Set();
    const placeholders = ids.map(() => "?").join(", ");
    const rows = this.database.prepare(`
      SELECT message_id FROM messages
       WHERE chat_id = ? AND message_id IN (${placeholders})
    `).all(chatId, ...ids) as readonly Record<string, unknown>[];
    return new Set(rows.map((row) => Number(row.message_id)));
  }

  async saveBatch(messages: readonly MessageRow[], media: readonly MediaRow[]): Promise<BatchResult> {
    if (!messages.length) return { messages: 0, media: 0 };
    const messageStatement = this.database.prepare(`
      INSERT OR IGNORE INTO messages
        (message_id, chat_id, grouped_id, chat_title, sender_id, sender_username,
         sender_first_name, sender_last_name, date, text, message_type,
         reply_to_msg_id, forward_from_id, forward_from_name,
         has_media, media_type, media_path, created_at, blocked)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const mediaStatement = this.database.prepare(`
      INSERT INTO media_files
        (message_id, chat_id, media_type, file_name, file_path, file_size, mime_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    this.database.exec("BEGIN");
    try {
      let inserted = 0;
      for (const row of messages) {
        const result = messageStatement.run(
          row.messageId,
          row.chatId,
          row.groupedId ?? null,
          row.chatTitle ?? null,
          row.senderId ?? null,
          row.senderUsername ?? null,
          row.senderFirstName ?? null,
          row.senderLastName ?? null,
          toIsoDate(row.date),
          row.text,
          row.messageType ?? "text",
          row.replyToMsgId ?? null,
          row.forwardFromId ?? null,
          row.forwardFromName ?? null,
          row.hasMedia ? 1 : 0,
          row.mediaType ?? null,
          row.mediaPath ?? null,
          now,
          matchesBlockword(row.text, this.blockwords) ? 1 : 0
        );
        inserted += Number(result.changes);
      }
      for (const row of media) {
        mediaStatement.run(
          row.messageId,
          row.chatId,
          row.mediaType,
          row.fileName,
          row.filePath,
          row.fileSize ?? null,
          row.mimeType ?? null,
          now
        );
      }
      this.database.exec("COMMIT");
      return { messages: inserted, media: media.length };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async listBlockwords(): Promise<BlockwordState> {
    return { words: [...this.blockwords], version: this.blockwordsVersion };
  }

  async addBlockword(word: string): Promise<BlockwordAddResult> {
    const normalized = normalizeBlockword(word);
    if (normalized === undefined) return "invalid";
    this.database.exec("BEGIN");
    try {
      const result = this.database.prepare(
        "INSERT OR IGNORE INTO blockwords (word, created_at) VALUES (?, ?)"
      ).run(normalized, new Date().toISOString());
      if (Number(result.changes) === 0) {
        this.database.exec("ROLLBACK");
        return "exists";
      }
      this.markBlockedMatches(normalized);
      this.blockwords = [...this.blockwords, normalized];
      this.blockwordsVersion += 1;
      this.database.exec("COMMIT");
      return "added";
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async removeBlockword(word: string): Promise<boolean> {
    const normalized = normalizeBlockword(word);
    if (normalized === undefined) return false;
    this.database.exec("BEGIN");
    try {
      const result = this.database.prepare("DELETE FROM blockwords WHERE word = ?").run(normalized);
      if (Number(result.changes) === 0) {
        this.database.exec("ROLLBACK");
        return false;
      }
      const next = this.blockwords.filter((item) => item !== normalized);
      this.rebuildBlocked(next);
      this.blockwords = next;
      this.blockwordsVersion += 1;
      this.database.exec("COMMIT");
      return true;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  /** 增量置位：只扫新词的命中，成本与词数无关。 */
  private markBlockedMatches(word: string): void {
    this.database.prepare(
      "UPDATE messages SET blocked = 1 WHERE blocked = 0 AND instr(lower(text), ?) > 0"
    ).run(word);
  }

  /** 删词后全量重算：清零后按剩余词表逐词置位（一次性成本，事务内调用）。 */
  private rebuildBlocked(words: readonly string[]): void {
    this.database.exec("UPDATE messages SET blocked = 0");
    if (!words.length) return;
    const condition = words.map(() => "instr(lower(text), ?) > 0").join(" OR ");
    this.database.prepare(`UPDATE messages SET blocked = 1 WHERE ${condition}`).run(...words);
  }

  async searchStructured(query: ArchiveQuery): Promise<ArchiveSearchResult> {
    const { where: rowWhere, values: rowValues } = buildWhere(query);
    const { where: memberWhere, values: memberValues } = buildWhere(query, "g");
    const entry = buildSearchWhere(rowWhere, rowValues, memberWhere, memberValues);
    const limit = normalizeLimit(query.limit);
    const offset = normalizeOffset(query.offset);
    const entryCount = this.database.prepare(
      `SELECT COUNT(*) AS count FROM messages m ${entry.where}`
    ).get(...entry.values) as { count: number };
    const messageCount = this.database.prepare(
      `SELECT COUNT(*) AS count FROM messages m ${rowWhere}`
    ).get(...rowValues) as { count: number };
    const rows = this.database.prepare(`
      SELECT ${MESSAGE_COLUMNS}, ${MIME_SUBQUERY} AS mime_type
        FROM messages m
        ${entry.where}
       ORDER BY m.date DESC, m.id DESC
       LIMIT ? OFFSET ?
    `).all(...entry.values, limit, offset) as readonly Record<string, unknown>[];
    const attached = this.attachMedia(rows);
    const groupMap = await this.fetchGroupsAttached(uniqueGroupKeys(rows));
    return {
      items: buildContextEntries(attached, groupMap),
      total: Number(entryCount.count),
      totalMessages: Number(messageCount.count),
      limit,
      offset
    };
  }

  async listChatLedger(limit: number): Promise<ChatLedgerRow[]> {
    const cap = Math.min(500, Math.max(1, Number.isInteger(limit) ? limit : 300));
    const rows = this.database.prepare(`
      SELECT
        c.chat_id AS chat_id,
        COALESCE(c.title, latest.chat_title) AS title,
        c.username,
        c.type,
        c.description,
        c.members_count,
        agg.count,
        latest.date AS last_date,
        substr(latest.text, 1, 120) AS last_text
      FROM chats c
      LEFT JOIN (
        SELECT chat_id, COUNT(*) AS count
          FROM messages
         WHERE blocked = 0
         GROUP BY chat_id
      ) agg ON agg.chat_id = c.chat_id
      LEFT JOIN (
        SELECT chat_id, chat_title, date, text,
               ROW_NUMBER() OVER (PARTITION BY chat_id ORDER BY date DESC, id DESC) AS rn
          FROM messages
         WHERE blocked = 0
      ) latest ON latest.chat_id = c.chat_id AND latest.rn = 1
      ORDER BY last_date DESC NULLS LAST, c.chat_id
      LIMIT ?
    `).all(cap) as readonly Record<string, unknown>[];
    return rows.map((row) => ({
      chatId: String(row.chat_id),
      title: String(row.title ?? row.chat_id),
      username: optionalString(row.username),
      type: optionalString(row.type),
      description: optionalString(row.description),
      membersCount: optionalNumber(row.members_count),
      count: Number(row.count ?? 0),
      lastDate: optionalString(row.last_date),
      lastText: optionalString(row.last_text)
    }));
  }

  async getMessageByRowId(rowId: string): Promise<MessageRecord | undefined> {
    const row = this.database.prepare(`
      SELECT ${MESSAGE_COLUMNS}, ${MIME_SUBQUERY} AS mime_type
        FROM messages m
       WHERE m.id = ? AND m.blocked = 0
       LIMIT 1
    `).get(Number(normalizeRowId(rowId))) as Record<string, unknown> | undefined;
    return row ? this.attachMedia([row])[0] : undefined;
  }

  async getMessageContext(
    rowId: string,
    beforeN: number,
    afterN: number,
    beforeOffset = 0,
    afterOffset = 0
  ): Promise<ArchiveContextResult> {
    const beforeLimit = normalizeContextLimit(beforeN);
    const afterLimit = normalizeContextLimit(afterN);
    const beforeOff = normalizeOffset(beforeOffset);
    const afterOff = normalizeOffset(afterOffset);
    const anchorRecord = await this.getMessageByRowId(rowId);
    if (!anchorRecord) {
      return { anchor: undefined, before: [], after: [], beforeN: 0, afterN: 0 };
    }

    let lower = { date: anchorRecord.date, id: Number(anchorRecord.rowId) };
    let upper = lower;
    let anchorGroup: readonly MessageRecord[] | undefined;
    if (anchorRecord.groupedId !== undefined) {
      const group = await this.fetchGroupAttached(anchorRecord.chatId, anchorRecord.groupedId);
      if (group.length > 1) {
        anchorGroup = group;
        lower = { date: group[0]!.date, id: Number(group[0]!.rowId) };
        const last = group[group.length - 1]!;
        upper = { date: last.date, id: Number(last.rowId) };
      }
    }

    const beforeRows = beforeLimit
      ? this.database.prepare(`
          SELECT ${MESSAGE_COLUMNS}, ${MIME_SUBQUERY} AS mime_type
            FROM messages m
           WHERE m.chat_id = ? AND (m.date < ? OR (m.date = ? AND m.id < ?))
             AND ${GROUP_FIRST_CONDITION}
             AND m.blocked = 0
           ORDER BY m.date DESC, m.id DESC
           LIMIT ? OFFSET ?
        `).all(anchorRecord.chatId, lower.date, lower.date, lower.id, beforeLimit, beforeOff) as readonly Record<string, unknown>[]
      : [];
    const afterRows = afterLimit
      ? this.database.prepare(`
          SELECT ${MESSAGE_COLUMNS}, ${MIME_SUBQUERY} AS mime_type
            FROM messages m
           WHERE m.chat_id = ? AND (m.date > ? OR (m.date = ? AND m.id > ?))
             AND ${GROUP_FIRST_CONDITION}
             AND m.blocked = 0
           ORDER BY m.date ASC, m.id ASC
           LIMIT ? OFFSET ?
        `).all(anchorRecord.chatId, upper.date, upper.date, upper.id, afterLimit, afterOff) as readonly Record<string, unknown>[]
      : [];
    const beforeCount = this.database.prepare(`
      SELECT COUNT(*) AS count FROM messages m
       WHERE m.chat_id = ? AND (m.date < ? OR (m.date = ? AND m.id < ?))
         AND ${GROUP_FIRST_CONDITION}
         AND m.blocked = 0
    `).get(anchorRecord.chatId, lower.date, lower.date, lower.id) as { count: number };
    const afterCount = this.database.prepare(`
      SELECT COUNT(*) AS count FROM messages m
       WHERE m.chat_id = ? AND (m.date > ? OR (m.date = ? AND m.id > ?))
         AND ${GROUP_FIRST_CONDITION}
         AND m.blocked = 0
    `).get(anchorRecord.chatId, upper.date, upper.date, upper.id) as { count: number };

    const groupMap = await this.fetchGroupsAttached(uniqueGroupKeys([...beforeRows, ...afterRows]));
    const before = buildContextEntries(await this.attachMedia([...beforeRows].reverse()), groupMap);
    const after = buildContextEntries(await this.attachMedia(afterRows), groupMap);
    const anchor = anchorGroup !== undefined
      ? albumEntryOf(anchorGroup, anchorRecord.rowId)
      : { kind: "message" as const, record: anchorRecord };
    return {
      anchor,
      before,
      after,
      beforeN: Number(beforeCount.count),
      afterN: Number(afterCount.count)
    };
  }

  private async fetchGroupAttached(chatId: string, groupedId: string): Promise<MessageRecord[]> {
    return this.attachMedia(this.groupRows([[chatId, groupedId]]));
  }

  private async fetchGroupsAttached(
    keys: readonly (readonly [string, string])[]
  ): Promise<Map<string, readonly MessageRecord[]>> {
    const result = new Map<string, readonly MessageRecord[]>();
    if (!keys.length) return result;
    const byKey = new Map<string, Record<string, unknown>[]>();
    for (const row of this.groupRows(keys)) {
      pushGrouped(byKey, groupKey(String(row.chat_id), String(row.grouped_id)), row);
    }
    for (const [key, rows] of byKey) {
      result.set(key, await this.attachMedia(rows));
    }
    return result;
  }

  private groupRows(keys: readonly (readonly [string, string])[]): readonly Record<string, unknown>[] {
    const sql = `
      SELECT ${MESSAGE_COLUMNS}, ${MIME_SUBQUERY} AS mime_type
        FROM messages m
       WHERE m.has_media = 1 AND m.blocked = 0 AND ${pairClause("grouped_id", keys)}
       ORDER BY m.date ASC, m.id ASC
    `;
    return this.database.prepare(sql).all(...pairValues(keys)) as readonly Record<string, unknown>[];
  }

  async getMediaFileById(id: string): Promise<StoredMediaFile | undefined> {
    const row = this.database.prepare(`
      SELECT mf.id, mf.message_id, mf.chat_id, mf.media_type, mf.file_name, mf.file_path, mf.file_size, mf.mime_type
        FROM media_files mf
       WHERE mf.id = ?
         AND NOT EXISTS (
           SELECT 1 FROM messages m
            WHERE m.chat_id = mf.chat_id AND m.message_id = mf.message_id
              AND m.blocked = 1
         )
       LIMIT 1
    `).get(Number(normalizeRowId(id))) as Record<string, unknown> | undefined;
    return row ? toStoredMediaFile(row) : undefined;
  }

  private attachMedia(rows: readonly Record<string, unknown>[]): MessageRecord[] {
    if (!rows.length) return [];
    const pairKeys = rows.map((row) => [String(row.chat_id), Number(row.message_id)] as const);
    const groupKeys = rows
      .filter((row) => row.grouped_id !== null && row.grouped_id !== undefined)
      .map((row) => [String(row.chat_id), String(row.grouped_id)] as const);

    const mediaMap = this.fetchMediaFiles(pairKeys);
    const albumMap = groupKeys.length
      ? this.fetchAlbumRows(groupKeys)
      : new Map<string, AlbumRow[]>();

    return rows.map((row) => toMessageRecord(row, mediaMap, albumMap));
  }

  private fetchMediaFiles(pairs: readonly (readonly [string, number])[]): Map<string, StoredMediaFile[]> {
    const sql = `
      SELECT id, message_id, chat_id, media_type, mime_type
        FROM media_files
       WHERE ${pairClause("message_id", pairs)}
       ORDER BY id ASC
    `;
    const rows = this.database.prepare(sql).all(...pairValues(pairs)) as readonly Record<string, unknown>[];
    const map = new Map<string, StoredMediaFile[]>();
    for (const row of rows) {
      const file = toStoredMediaFile(row);
      pushGrouped(map, mediaKey(file.chatId, file.messageId), file);
    }
    return map;
  }

  private fetchAlbumRows(pairs: readonly (readonly [string, string])[]): Map<string, AlbumRow[]> {
    const sql = `
      SELECT m.id AS row_id, m.message_id, m.chat_id, m.grouped_id, m.date,
             m.has_media, m.media_type, m.message_type,
             ${MIME_SUBQUERY} AS mime_type
        FROM messages m
       WHERE m.has_media = 1 AND m.blocked = 0 AND ${pairClause("grouped_id", pairs)}
       ORDER BY m.date ASC, m.id ASC
    `;
    const rows = this.database.prepare(sql).all(...pairValues(pairs)) as readonly Record<string, unknown>[];
    const map = new Map<string, AlbumRow[]>();
    for (const row of rows) {
      pushGrouped(map, groupKey(String(row.chat_id), String(row.grouped_id)), toAlbumRow(row));
    }
    return map;
  }
}

function pairClause(column: string, pairs: readonly (readonly [string, string | number])[]): string {
  return pairs
    .map(() => `(chat_id = ? AND ${column} = ?)`)
    .join(" OR ");
}

function pairValues(pairs: readonly (readonly [string, string | number])[]): (string | number)[] {
  return pairs.flatMap(([chatId, second]) => [chatId, second]);
}

function pushGrouped<T>(map: Map<string, T[]>, key: string, item: T): void {
  let items = map.get(key);
  if (!items) {
    items = [];
    map.set(key, items);
  }
  items.push(item);
}

function toStoredMediaFile(row: Record<string, unknown>): StoredMediaFile {
  return {
    id: String(row.id),
    messageId: Number(row.message_id),
    chatId: String(row.chat_id),
    mediaType: String(row.media_type ?? "document"),
    fileName: optionalString(row.file_name),
    filePath: optionalString(row.file_path),
    fileSize: optionalNumber(row.file_size),
    mimeType: optionalString(row.mime_type)
  };
}

function toAlbumRow(row: Record<string, unknown>): AlbumRow {
  return {
    rowId: String(row.row_id ?? row.id ?? ""),
    messageId: Number(row.message_id),
    chatId: String(row.chat_id),
    groupedId: String(row.grouped_id),
    date: toIsoDate(row.date),
    hasMedia: Boolean(row.has_media),
    mediaType: optionalString(row.media_type),
    messageType: optionalString(row.message_type),
    mimeType: optionalString(row.mime_type)
  };
}

function toMessageRecord(
  row: Record<string, unknown>,
  mediaMap: Map<string, StoredMediaFile[]>,
  albumMap: Map<string, AlbumRow[]>
): MessageRecord {
  const chatId = String(row.chat_id ?? "");
  const messageId = Number(row.message_id);
  const groupedId = optionalString(row.grouped_id);
  const mediaFiles = mediaMap.get(mediaKey(chatId, messageId)) ?? [];
  const albumRows = groupedId !== undefined ? albumMap.get(groupKey(chatId, groupedId)) ?? [] : [];
  return {
    rowId: String(row.row_id ?? row.id ?? ""),
    messageId,
    chatId,
    groupedId,
    chatTitle: optionalString(row.chat_title),
    date: toIsoDate(row.date),
    senderId: optionalString(row.sender_id),
    senderUsername: optionalString(row.sender_username),
    senderFirstName: optionalString(row.sender_first_name),
    senderLastName: optionalString(row.sender_last_name),
    hasMedia: Boolean(row.has_media),
    mediaType: optionalString(row.media_type),
    messageType: optionalString(row.message_type) ?? "text",
    mimeType: optionalString(row.mime_type),
    text: String(row.text ?? ""),
    mediaFiles,
    albumRows
  };
}

/** 检索基线：普通消息取自身；相册取组内第一条作代表，组内任一条命中即整体命中。 */
function buildSearchWhere(
  rowWhere: string,
  rowValues: (string | number)[],
  memberWhere: string,
  memberValues: (string | number)[]
): { where: string; values: (string | number)[] } {
  const row = rowWhere?.replace(/^WHERE\s+/, "");
  const member = memberWhere
    ? ` OR EXISTS (
        SELECT 1 FROM messages g
         WHERE g.chat_id = m.chat_id AND g.grouped_id = m.grouped_id
           AND ${memberWhere.replace(/^WHERE\s+/, "")}
      )`
    : "";
  const matches = row ? ` AND (${row}${member})` : "";
  return {
    where: `WHERE ${GROUP_FIRST_CONDITION}${matches}`,
    values: [...rowValues, ...memberValues]
  };
}

function buildWhere(query: ArchiveQuery, alias = "m"): { where: string; values: (string | number)[] } {
  const conditions: string[] = [];
  const values: (string | number)[] = [];
  for (const term of splitTerms(query.keyword)) {
    conditions.push(`${alias}.text LIKE ? COLLATE NOCASE`);
    values.push(`%${escapeLike(term)}%`);
  }
  for (const term of splitTerms(query.excludeKeyword)) {
    conditions.push(`${alias}.text NOT LIKE ? COLLATE NOCASE`);
    values.push(`%${escapeLike(term)}%`);
  }
  if (query.chatId?.trim()) {
    conditions.push(`${alias}.chat_id = ?`);
    values.push(query.chatId.trim());
  }
  if (query.chatTitle?.trim()) {
    conditions.push(`${alias}.chat_title LIKE ? COLLATE NOCASE`);
    values.push(`%${escapeLike(query.chatTitle.trim())}%`);
  }
  appendTimeWhere(conditions, values, query, alias);
  conditions.push(`${alias}.blocked = 0`);
  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
}

function appendTimeWhere(
  conditions: string[],
  values: (string | number)[],
  query: ArchiveQuery,
  alias = "m"
): void {
  const mode = normalizeTimeMode(query.timeMode);
  if (mode === "off" || (!query.dateFrom && !query.dateTo)) return;
  const column = `${alias}.date`;
  if (mode === "include") {
    if (query.dateFrom) {
      conditions.push(`${column} >= ?`);
      values.push(query.dateFrom);
    }
    if (query.dateTo) {
      conditions.push(`${column} <= ?`);
      values.push(query.dateTo);
    }
    return;
  }
  if (query.dateFrom && query.dateTo) {
    conditions.push(`NOT (${column} >= ? AND ${column} <= ?)`);
    values.push(query.dateFrom, query.dateTo);
  } else if (query.dateFrom) {
    conditions.push(`${column} < ?`);
    values.push(query.dateFrom);
  } else if (query.dateTo) {
    conditions.push(`${column} > ?`);
    values.push(query.dateTo);
  }
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

/** 屏蔽词命中判定（子串、大小写不敏感）；空文本永不命中。 */
function matchesBlockword(text: string | undefined, words: readonly string[]): boolean {
  if (text === undefined || text === "") return false;
  const lower = text.toLowerCase();
  return words.some((word) => lower.includes(word));
}

function optionalString(value: unknown): string | undefined {
  return value === undefined || value === null || value === "" ? undefined : String(value);
}

function optionalNumber(value: unknown): number | undefined {
  return value === undefined || value === null || value === "" ? undefined : Number(value);
}