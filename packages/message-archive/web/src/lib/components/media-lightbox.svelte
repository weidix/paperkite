<script lang="ts">
  import Dialog from "$lib/components/ui/dialog.svelte";
  import type { LightboxItem } from "$lib/types";

  let { item, onClose }: { item: LightboxItem | null; onClose: () => void } = $props();
</script>

<Dialog open={item !== null} onOpenChange={(open) => !open && onClose()} contentClass="max-w-3xl" hideClose={false}>
  {#if item}
    <div class="max-h-[75vh] w-full overflow-auto rounded-md bg-muted/20">
      <img src={item.src} alt={item.alt} class="w-full object-contain" loading="lazy" decoding="async" />
    </div>
  {/if}
</Dialog>