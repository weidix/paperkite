<script lang="ts">
  import { resolveMessageRef } from "$lib/api";
  import type { TelegramMessageRef } from "$lib/format";
  import { navigate } from "$lib/state.svelte";

  let {
    href,
    ref,
    class: className = "",
    children
  }: {
    href: string;
    ref: TelegramMessageRef;
    class?: string;
    children?: import("svelte").Snippet;
  } = $props();

  let busy = $state(false);

  /** t.me 消息链接优先站内跳转；存档缺失时退回 Telegram 外链。 */
  async function openRef(event: { preventDefault(): void; stopPropagation(): void }): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    busy = true;
    try {
      const { recordId } = await resolveMessageRef(ref);
      navigate({ kind: "message", recordId });
    } catch {
      window.open(href, "_blank", "noopener,noreferrer");
    } finally {
      busy = false;
    }
  }
</script>

<a
  {href}
  class={className}
  target="_blank"
  rel="noopener noreferrer"
  title="跳转到存档中的该消息（未存档则打开 Telegram）"
  onclick={openRef}
  onkeydown={(event) => {
    if (event.key === "Enter") void openRef(event);
  }}
  tabindex="0"
>
  {@render children?.()}
</a>