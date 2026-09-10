import { test } from "node:test";
import assert from "node:assert/strict";
import { Api } from "telegram/tl/api.js";
import { resolveChat, validateConfig, type ResolveClient } from "../packages/messages-watch/src/index.js";

const TIMEOUT = { timeout: 10_000 };

const channel = new Api.Channel({
  id: 1234567890 as never,
  title: "private",
  photo: new Api.ChatPhotoEmpty(),
  date: 0,
  participantsCount: 2
});

function clientReturning(invite: unknown): ResolveClient {
  return {
    async invoke() {
      return invite;
    },
    async getInputEntity(chat: string | number) {
      return chat;
    }
  };
}

test("validateConfig reports unusable chat references and accepts the rest", TIMEOUT, () => {
  assert.deepEqual(
    validateConfig({
      chats: [
        -1001234567890,
        "@channel_name",
        "t.me/channel_name",
        "t.me/joinchat/AAAAAEabcdefgh",
        "tg://join?invite=AAAAAEabcdefgh"
      ]
    }),
    []
  );
  assert.deepEqual(validateConfig({ chat: "https://t.me/+AAAAAEabcdefgh" }), []);
  assert.deepEqual(validateConfig({ chats: ["乱填"] }), [
    "无法解析的聊天引用 乱填，请使用群数字 ID、@用户名或邀请链接"
  ]);
});

test("resolveChat returns the chatId of an invite the account already joined", TIMEOUT, async () => {
  const resolved = await resolveChat(
    clientReturning(new Api.ChatInviteAlready({ chat: channel })),
    "https://t.me/+AAAAAEabcdefgh"
  );
  assert.equal(resolved, -1001234567890);
});

test("resolveChat reports a group the account has not joined", TIMEOUT, async () => {
  const client = clientReturning(
    new Api.ChatInvite({
      title: "private",
      participantsCount: 2,
      color: 0,
      photo: new Api.PhotoEmpty({ id: 0 as never }),
      requestNeeded: false
    })
  );
  await assert.rejects(resolveChat(client, "t.me/+AAAAAEabcdefgh"), /未加入群 AAAAAEabcdefgh，请先通过链接加入该群/);
});
