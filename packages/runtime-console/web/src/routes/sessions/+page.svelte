<script lang="ts">
  import { RefreshCw, Users } from "lucide-svelte";
  import { toast } from "$lib/toast-store.svelte";
  import Badge from "$lib/components/ui/badge.svelte";
  import Button from "$lib/components/ui/button.svelte";
  import { api } from "$lib/api";
  import { errorText, formatDateTime } from "$lib/format";
  import { runtime } from "$lib/runtime.svelte";
  import type { SessionSnapshot, SessionState } from "$lib/runtime";

  const STATE_LABEL: Record<SessionState, string> = {
    connected: "已连接",
    starting: "连接中",
    isolated: "已隔离",
    "waiting-auth": "等待登录"
  };

  const STATE_VARIANT: Record<SessionState, "default" | "outline" | "secondary" | "destructive"> = {
    connected: "default",
    starting: "outline",
    isolated: "destructive",
    "waiting-auth": "destructive"
  };

  const sessions = $derived(runtime.snapshot?.sessions ?? []);

  let busy = $state<string | null>(null);

  async function reconnect(session: SessionSnapshot): Promise<void> {
    busy = session.name;
    try {
      await api.reconnectSession(session.name);
      toast.success(`已触发 ${session.name} 重连`);
    } catch (cause) {
      toast.error(errorText(cause));
    } finally {
      busy = null;
    }
  }
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-wrap items-center gap-2">
    <h2 class="font-display text-sm font-semibold tracking-tight">Telegram 会话状态</h2>
    <span class="flex-1"></span>
    <span class="text-xs text-muted-foreground">状态变化实时同步，隔离与恢复自动完成</span>
  </div>

  {#if sessions.length === 0}
    <div class="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
      <span class="flex size-10 items-center justify-center rounded-full bg-muted">
        <Users class="size-5 text-muted-foreground" aria-hidden="true" />
      </span>
      <p class="text-sm font-medium">没有会话</p>
      <p class="max-w-sm text-xs text-muted-foreground">流程引用哪个会话，运行时启动后这里就会出现对应的状态。</p>
    </div>
  {:else}
    <div class="rounded-lg border bg-card text-card-foreground shadow-sm">
      <div class="p-0">
        <div class="relative w-full overflow-auto"><table class="w-full caption-bottom text-sm">
          <thead class="[&_tr]:border-b">
            <tr class="border-b transition-colors hover:bg-muted/40 data-[state=selected]:bg-muted">
              <th class="h-10 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0">会话</th>
              <th class="h-10 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0">状态</th>
              <th class="h-10 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 hidden md:table-cell">说明</th>
              <th class="h-10 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 hidden md:table-cell">受影响流程</th>
              <th class="h-10 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 w-32"></th>
            </tr>
          </thead>
          <tbody class="[&_tr:last-child]:border-0">
            {#each sessions as session (session.name)}
              <tr class="border-b transition-colors hover:bg-muted/40 data-[state=selected]:bg-muted">
                <td class="p-4 align-middle [&:has([role=checkbox])]:pr-0">
                  <div class="flex flex-col gap-0.5">
                    <span class="font-mono tracking-tight text-sm">{session.name}</span>
                    <span class="font-mono text-[11px] text-muted-foreground">自 {formatDateTime(session.since)}</span>
                  </div>
                </td>
                <td class="p-4 align-middle [&:has([role=checkbox])]:pr-0">
                  <Badge variant={STATE_VARIANT[session.state]}>
                    {STATE_LABEL[session.state]}{session.state === "isolated" && session.attempts > 0 ? ` · 第 ${session.attempts} 次` : ""}
                  </Badge>
                </td>
                <td class="p-4 align-middle [&:has([role=checkbox])]:pr-0 hidden max-w-72 md:table-cell">
                  <span class="text-xs text-muted-foreground">{session.reason ?? "-"}</span>
                </td>
                <td class="p-4 align-middle [&:has([role=checkbox])]:pr-0 hidden md:table-cell">
                  {#if session.flows.length === 0}
                    <span class="text-xs text-muted-foreground/60">-</span>
                  {:else}
                    <div class="flex flex-wrap gap-1">
                      {#each session.flows as flow (flow.kind + ":" + flow.id)}
                        <Badge variant="outline">
                          <span class="font-mono">{flow.kind}:{flow.id}</span>
                        </Badge>
                      {/each}
                    </div>
                  {/if}
                </td>
                <td class="p-4 align-middle [&:has([role=checkbox])]:pr-0 text-right">
                  {#if session.state === "isolated" || session.state === "waiting-auth"}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy === session.name}
                      onclick={() => void reconnect(session)}
                      aria-label={`重连 ${session.name}`}
                    >
                      <RefreshCw class={"size-3.5 " + (busy === session.name ? "animate-spin" : "")} aria-hidden="true" />
                      立即重试
                    </Button>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table></div>
      </div>
    </div>
  {/if}
</div>