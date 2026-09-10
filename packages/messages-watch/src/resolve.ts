import { Api } from "telegram/tl/api.js";
import { getPeerId } from "telegram/Utils.js";

export interface ResolveClient {
  getInputEntity(chat: string | number): Promise<unknown>;
  invoke(request: unknown): Promise<unknown>;
}

const SHORT_INVITE = /^(?:https?:\/\/)?(?:www\.)?t\.me\/(?:joinchat\/|\+)([\w-]+)\/?$/i;

/** 把 chats 配置项归一化为过滤器可用的实体引用；短邀请链经 CheckChatInvite 换取 chatId。 */
export async function resolveChat(client: ResolveClient, chat: string | number): Promise<string | number> {
  if (typeof chat === "number") return chat;
  const hash = inviteHash(chat);
  if (hash) return resolveInvite(client, hash, chat);
  try {
    return asReference(await client.getInputEntity(chat));
  } catch (error) {
    throw new Error("无法解析的聊天引用 " + chat + "：" + messageOf(error));
  }
}

/** 识别邀请链接的 hash（t.me/+hash 与 t.me/joinchat/hash）；其余引用不涉及邀请解析。 */
export function inviteHash(chat: string): string | undefined {
  return chat.trim().match(SHORT_INVITE)?.[1];
}

async function resolveInvite(client: ResolveClient, hash: string, chat: string): Promise<string | number> {
  let invite: unknown;
  try {
    invite = await client.invoke(new Api.messages.CheckChatInvite({ hash }));
  } catch (error) {
    throw new Error("无法检查邀请链接 " + chat + "：" + messageOf(error));
  }
  if (invite instanceof Api.ChatInviteAlready) {
    return asReference(await client.getInputEntity(invite.chat as never));
  }
  throw new Error("未加入群 " + hash + "，请先通过链接加入该群");
}

/** 实体引用统一取带标记的 chatId；无法识别时沿用原值交由下游解析。 */
function asReference(entity: unknown): string | number {
  if (typeof entity === "number" || typeof entity === "string") return entity;
  try {
    return Number(getPeerId(entity as never));
  } catch {
    return entity as never;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
