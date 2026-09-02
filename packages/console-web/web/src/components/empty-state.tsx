import type { ComponentType } from "react";
import { Card, CardContent } from "@/components/ui/card";

interface EmptyStateProps {
  readonly icon: ComponentType<{ className?: string }>;
  readonly title: string;
  readonly hint?: string;
}

export function EmptyState({ icon: Icon, title, hint }: EmptyStateProps) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
        <span className="flex size-10 items-center justify-center rounded-full bg-muted">
          <Icon className="size-5 text-muted-foreground" />
        </span>
        <p className="text-sm font-medium">{title}</p>
        {hint ? <p className="max-w-sm text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}