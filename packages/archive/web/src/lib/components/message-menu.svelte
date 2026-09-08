<script lang="ts">
  import { ArrowLeft, MoreHorizontal, ShieldBan, UserX, X } from "lucide-svelte";
  import { ApiError, addBlockedUser, addBlockword } from "$lib/api";
  import { fmtTs, senderName } from "$lib/format";
  import { backToSearch, bumpBlocks, navigate, showToast, viewStore } from "$lib/state.svelte";
  import type { MessageRecord } from "$lib/model";

  /** 与后端屏蔽词上限一致：整条消息文字或单个选区的长度上限。 */
  const WORD_MAX = 64;

  let {
    record,
    /** 相册场景：关键词来源用说明文字而非某一行文本。 */
    keywordSource = null,
    /** 相册锚点场景：以聚焦行判定「当前正查看的这条消息」。 */
    navRecordId = null
  } = $props<{
    record: MessageRecord;
    keywordSource?: string | null;
    navRecordId?: string | null;
  }>();

  const keywordText = $derived(keywordSource ?? record.text);
  const sender = $derived(record.senderId ?? null);
  const shortText = $derived(keywordText.trim().length > 0 && keywordText.trim().length <= WORD_MAX);

  let open = $state(false);
  let picking = $state(false);
  let busy = $state(false);
  /** 最近一次松手时容器内的原生选区文本，trim 后为空表示无有效选区。 */
  let picked = $state("");
  let pickerEl = $state<HTMLDivElement | null>(null);

  const pickedText = $derived(picked.trim());
  const pickedTooLong = $derived(pickedText.length > WORD_MAX);

  $effect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  /** 划词：松手一次性读取选区（anchor/focus 均须落在工作区容器内），拖动过程不监听。 */
  $effect(() => {
    if (!picking) return;
    const onUp = (): void => {
      const selection = window.getSelection();
      const container = pickerEl;
      if (selection === null || selection.isCollapsed || container === null) {
        picked = "";
        return;
      }
      if (!container.contains(selection.anchorNode) || !container.contains(selection.focusNode)) {
        picked = "";
        return;
      }
      picked = selection.toString();
    };
    addEventListener("mouseup", onUp);
    return () => removeEventListener("mouseup", onUp);
  });

  function toggle(): void {
    if (open) {
      close();
      return;
    }
    open = true;
    picking = false;
  }

  function close(): void {
    open = false;
    picking = false;
    picked = "";
    clearPickerSelection();
  }

  /** 回到三按钮视图：残留选区一并清除。 */
  function backToOptions(): void {
    picking = false;
    picked = "";
    clearPickerSelection();
  }

  /** 仅清除弹窗容器内的选区，页面其他选择不受影响。 */
  function clearPickerSelection(): void {
    const selection = window.getSelection();
    const container = pickerEl;
    if (selection === null || selection.isCollapsed || container === null) return;
    if (container.contains(selection.anchorNode)) selection.removeAllRanges();
  }

  async function blockUser(): Promise<void> {
    if (sender === null || busy) return;
    busy = true;
    try {
      const name = [record.senderFirstName, record.senderLastName].filter(Boolean).join(" ");
      await addBlockedUser({
        userId: sender,
        ...(name ? { name } : {}),
        ...(record.senderUsername ? { username: record.senderUsername } : {})
      });
      showToast(`已屏蔽用户 ${record.senderUsername ? `@${record.senderUsername}` : senderName(record)}`);
      afterBlocked();
    } catch (cause) {
      showToast(messageOf(cause));
    } finally {
      busy = false;
    }
  }

  async function blockWholeText(): Promise<void> {
    if (!shortText || busy) return;
    const word = keywordText.trim();
    busy = true;
    try {
      await addBlockword(word);
      showToast(`已屏蔽「${word.slice(0, 24)}」`);
      afterBlocked();
    } catch (cause) {
      showToast(messageOf(cause));
    } finally {
      busy = false;
    }
  }

  async function addPicked(): Promise<void> {
    const word = pickedText;
    if (word === "" || pickedTooLong || busy) return;
    busy = true;
    try {
      await addBlockword(word);
      showToast(`已屏蔽「${word.slice(0, 24)}」`);
      afterBlocked();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        showToast(`「${word.slice(0, 24)}」已在屏蔽列表`);
      } else {
        showToast(messageOf(cause));
      }
    } finally {
      busy = false;
    }
  }

  /** 屏蔽动作后：当前正查看这条消息时回到检索页，其余场景交给检索刷新。 */
  function afterBlocked(): void {
    close();
    bumpBlocks();
    const target = navRecordId ?? record.recordId;
    if (viewStore.current.kind === "message" && viewStore.current.recordId === target) {
      navigate(backToSearch());
    }
  }

  function messageOf(cause: unknown): string {
    if (cause instanceof ApiError) return cause.message;
    return cause instanceof Error ? cause.message : String(cause);
  }
</script>

<div class="relative shrink-0">
  <button
    type="button"
    class="rounded-md p-1.5 text-muted-foreground opacity-40 transition-opacity hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 group-hover:opacity-100"
    aria-label="消息操作"
    aria-haspopup="dialog"
    aria-expanded={open}
    onclick={toggle}
  >
    <MoreHorizontal class="size-3.5" aria-hidden="true" />
  </button>

  {#if open}
    <div
      class="fixed inset-0 z-40 flex animate-fade-in items-center justify-center bg-background/80"
      role="dialog"
      aria-modal="true"
      aria-label="消息操作"
    >
      <button
        type="button"
        tabindex="-1"
        class="absolute inset-0 cursor-default"
        aria-label="关闭消息操作"
        onclick={close}
      ></button>
      <div class="relative z-10 flex max-h-[80vh] w-full max-w-md animate-zoom-in flex-col rounded-lg border border-border bg-card shadow-sm">
        <div class="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium leading-5">消息操作</p>
            <p class="truncate font-mono text-[10px] leading-4 text-muted-foreground">
              {senderName(record)} · #{record.messageId} · {fmtTs(record.date)}
            </p>
          </div>
          <button
            type="button"
            class="rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            aria-label="关闭"
            onclick={close}
          >
            <X class="size-4" aria-hidden="true" />
          </button>
        </div>

        {#if picking}
          <div class="flex min-h-0 flex-1 flex-col">
            <button
              type="button"
              class="flex shrink-0 items-center gap-1.5 px-4 py-2 text-left font-mono text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              onclick={backToOptions}
            >
              <ArrowLeft class="size-3" aria-hidden="true" />
              返回操作选项
            </button>
            <div bind:this={pickerEl} class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {#if keywordText.trim()}
                <p class="whitespace-pre-wrap break-words text-[13px] leading-snug">{keywordText}</p>
              {:else}
                <p class="py-6 text-center font-mono text-xs text-muted-foreground">这条消息没有可选的文字。</p>
              {/if}
            </div>
            <div class="shrink-0 border-t p-3">
              {#if pickedText !== "" && !pickedTooLong}
                <div class="mb-2 flex min-w-0 items-center gap-2 font-mono text-xs">
                  <span class="min-w-0 truncate">「{pickedText}」</span>
                  <span class="shrink-0 text-muted-foreground">{pickedText.length} 字</span>
                </div>
              {/if}
              <div class="flex items-center gap-2">
                {#if pickedText !== ""}
                  <button
                    type="button"
                    class="h-9 shrink-0 rounded-md border px-4 text-sm font-medium transition-colors hover:bg-accent"
                    onclick={() => (picked = "")}
                  >
                    取消
                  </button>
                {/if}
                {#if pickedText !== "" && !pickedTooLong}
                  <button
                    type="button"
                    disabled={busy}
                    class="flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
                    onclick={addPicked}
                  >
                    <span class="truncate">添加屏蔽词「{pickedText}」</span>
                  </button>
                {:else if pickedTooLong}
                  <p class="min-w-0 flex-1 font-mono text-[11px] leading-5 text-destructive">
                    所选内容过长（{pickedText.length} 字），请选择 1–{WORD_MAX} 字
                  </p>
                {:else}
                  <p class="min-w-0 flex-1 py-2 text-center font-mono text-[11px] text-muted-foreground">
                    拖选消息文字中的任意片段，松手后添加为屏蔽词
                  </p>
                {/if}
              </div>
            </div>
          </div>
        {:else}
          <div class="flex flex-col p-2">
            <button
              type="button"
              disabled={sender === null || busy}
              class="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              onclick={blockUser}
            >
              <UserX class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span class="min-w-0 flex-1">
                <span class="block text-sm font-medium">屏蔽此用户</span>
                <span class="block truncate text-[11px] text-muted-foreground">
                  {sender !== null ? senderName(record) : "该消息没有发送者信息"}
                </span>
              </span>
            </button>
            <button
              type="button"
              disabled={!keywordText.trim() || busy}
              class="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              onclick={() => (picking = true)}
            >
              <ShieldBan class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span class="min-w-0 flex-1">
                <span class="block text-sm font-medium">选词屏蔽</span>
                <span class="block truncate text-[11px] text-muted-foreground">
                  {keywordText.trim() ? "在这条消息里拖选要屏蔽的内容" : "这条消息没有可选的词"}
                </span>
              </span>
            </button>
            <button
              type="button"
              disabled={!shortText || busy}
              class="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              onclick={blockWholeText}
            >
              <ShieldBan class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span class="min-w-0 flex-1">
                <span class="block text-sm font-medium">屏蔽此消息</span>
                <span class="block truncate text-[11px] text-muted-foreground">
                  {shortText
                    ? `整条文字（${keywordText.trim().length} 字）作为屏蔽词`
                    : `消息过长（${keywordText.trim().length} 字），请选词屏蔽`}
                </span>
              </span>
            </button>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>