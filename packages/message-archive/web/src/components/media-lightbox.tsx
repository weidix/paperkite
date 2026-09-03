import {
  Dialog,
  DialogContent,
  DialogTitle
} from "@/components/ui/dialog";
import type { LightboxItem } from "@/lib/types";

export function MediaLightbox({
  item,
  onClose
}: {
  readonly item: LightboxItem | null;
  readonly onClose: () => void;
}) {
  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogTitle className="sr-only">图片预览</DialogTitle>
        {item ? <img src={item.src} alt={item.alt} className="max-h-[75vh] w-full rounded-md object-contain" /> : null}
      </DialogContent>
    </Dialog>
  );
}