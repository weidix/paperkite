<script lang="ts">
  import { Download, File, Image as ImageIcon, Video } from "lucide-svelte";
  import { fetchMediaMeta, mediaDiskUrl, mediaDownloadUrl, mediaLiveUrl, type MediaMeta } from "$lib/api";
  import { fmtBytes } from "$lib/format";
  import Button from "$lib/components/button.svelte";
  import type { StoredMediaFile } from "$lib/model";

  let { file, session, onpreview } = $props<{
    file: StoredMediaFile;
    session: string | null;
    onpreview(file: StoredMediaFile): void;
  }>();

  let meta = $state<MediaMeta | null>(null);
  let show = $state(false);
  let error = $state("");

  $effect(() => {
    meta = null;
    show = false;
    error = "";
    fetchMediaMeta(file.id).then((value) => (meta = value)).catch((e: unknown) => {
      error = e instanceof Error ? e.message : String(e);
    });
  });

  const previewKind = $derived(kindOf(file));
  const live = $derived(session !== null);
  const canPreview = $derived(previewKind !== "none");
  const src = $derived(show ? (meta?.onDisk ? mediaDiskUrl(file.id) : mediaLiveUrl(file.id)) : "");

  function kindOf(file: StoredMediaFile): "image" | "video" | "none" {
    const mime = file.mimeType ?? "";
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "video";
    if (file.mediaType === "photo" || file.mediaType === "sticker" || file.mediaType === "animation") return "image";
    return "none";
  }
</script>

<div class="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg border bg-muted">
  {#if show && src}
    {#if previewKind === "video"}
      <video src={src} controls class="h-full w-full object-contain" aria-label={file.fileName}><track kind="captions" /></video>
    {:else}
      <button class="h-full w-full" aria-label="放大预览" onclick={() => onpreview(file)}>
        <img
          src={src}
          alt={file.fileName}
          class="h-full w-full object-cover"
          onerror={() => (error = error || "加载失败")}
        />
      </button>
    {/if}
    <span class="absolute left-1 top-1 rounded border bg-card/90 px-1 py-px font-mono text-[9px] text-muted-foreground">
      {meta?.onDisk ? "落盘" : "在线"}
    </span>
  {:else}
    <div class="flex flex-col items-center gap-1 p-2">
      {#if previewKind === "image"}
        <ImageIcon class="size-5 text-muted-foreground" aria-hidden="true" />
      {:else if previewKind === "video"}
        <Video class="size-5 text-muted-foreground" aria-hidden="true" />
      {:else}
        <File class="size-5 text-muted-foreground" aria-hidden="true" />
      {/if}
      <span class="max-w-full truncate font-mono text-[10px] text-muted-foreground">{file.fileName ?? `media_${file.id}`}</span>
      <span class="font-mono text-[10px] text-muted-foreground/60">{fmtBytes(file.fileSize)}</span>
      <span class="flex items-center gap-1">
        {#if canPreview && (meta?.onDisk || live)}
          <Button
            variant="outline"
            size="sm"
            class="h-7 px-1.5 font-mono text-[10px]"
            onclick={() => (show = true)}
          >
            {meta?.onDisk ? "预览" : "在线取回"}
          </Button>
        {/if}
        <a
          href={meta?.onDisk ? mediaDownloadUrl(file.id, "file") : live ? mediaDownloadUrl(file.id, "live") : undefined}
          class="inline-flex h-7 items-center justify-center rounded-md border border-input bg-background px-1.5 font-mono text-[10px] shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          class:pointer-events-none={!(meta?.onDisk || live)}
          class:opacity-40={!(meta?.onDisk || live)}
          aria-label="下载媒体文件"
        >
          <Download class="size-3" aria-hidden="true" />
        </a>
      </span>
      {#if meta !== null && !meta.onDisk && !live}
        <span class="font-mono text-[10px] text-muted-foreground/60">未落盘</span>
      {/if}
    </div>
  {/if}
  {#if error}
    <span class="absolute bottom-1 left-1 right-1 truncate rounded border bg-card px-1 py-px font-mono text-[9px] text-muted-foreground">
      {error}
    </span>
  {/if}
</div>