import { PackageIcon, PuzzleIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { Mono } from "@/components/code";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/hooks";

const KIND_LABEL = { action: "动作", trigger: "触发器", service: "服务" } as const;

export default function Plugins() {
  const plugins = useAsync(() => api.plugins(), []);

  if (plugins.loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-9 w-48 rounded-lg" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const items = plugins.data ?? [];

  if (items.length === 0) {
    return (
      <EmptyState
        icon={PuzzleIcon}
        title="没有已安装的插件"
        hint="通过 paperkite plugin add 安装插件，或在核心 bundles 中声明内置插件。"
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>插件</TableHead>
              <TableHead>版本</TableHead>
              <TableHead className="hidden md:table-cell">能力</TableHead>
              <TableHead className="w-24 text-center">状态</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((plugin) => (
              <TableRow key={plugin.name}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="flex size-7 items-center justify-center rounded-md bg-accent text-accent-foreground">
                      <PackageIcon className="size-3.5" />
                    </span>
                    <Mono className="text-sm">{plugin.name}</Mono>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="font-mono text-xs text-muted-foreground">{plugin.version ?? "-"}</span>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <div className="flex flex-wrap gap-1">
                    {plugin.capabilities.map((item) => (
                      <Badge key={item.name} variant={item.kind === "action" ? "default" : item.kind === "trigger" ? "outline" : "secondary"}>
                        <span className="font-mono">{item.name}</span>
                        <span className="text-[10px] opacity-70">· {KIND_LABEL[item.kind]}</span>
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-center">
                  {plugin.loaded ? <Badge variant="secondary">已加载</Badge> : <Badge variant="outline" className="text-muted-foreground">未加载</Badge>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}