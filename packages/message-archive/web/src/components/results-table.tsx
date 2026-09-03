import { ImageIcon, ScrollTextIcon, SearchIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious
} from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MediaGallery } from "@/components/media-gallery";
import { formatDisplayName, formatMessageDate } from "@/lib/format";
import { HighlightedText } from "@/lib/highlight";
import type { LightboxItem, SearchQuery, SearchRow } from "@/lib/types";

const PAGE_SIZE = 50;

function MessageCell({
  row,
  keyword,
  onOpenMedia
}: {
  readonly row: SearchRow;
  readonly keyword: string;
  readonly onOpenMedia: (item: LightboxItem) => void;
}) {
  return (
    <div className="flex flex-col gap-2 py-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="font-mono text-[11px]">
          {formatMessageDate(row.date)}
        </Badge>
        <Badge variant="secondary" className="max-w-48 truncate">
          {row.chat_title || "未知群组"}
        </Badge>
        {row.sender_username ? (
          <Badge variant="ghost" className="font-mono text-[11px]">
            @{row.sender_username}
          </Badge>
        ) : (
          <Badge variant="ghost" className="text-[11px]">
            {formatDisplayName(row)}
          </Badge>
        )}
        {row.has_media ? (
          <Badge variant="secondary">
            <ImageIcon />
            媒体
          </Badge>
        ) : null}
      </div>
      <p className="text-sm leading-relaxed whitespace-pre-wrap">
        <HighlightedText text={row.text} keyword={keyword} />
      </p>
      <MediaGallery row={row} onOpen={onOpenMedia} />
    </div>
  );
}

interface ResultsTableProps {
  readonly query: SearchQuery | null;
  readonly items: readonly SearchRow[];
  readonly total: number;
  readonly page: number;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onOpenContext: (row: SearchRow) => void;
  readonly onOpenMedia: (item: LightboxItem) => void;
  readonly onPrev: () => void;
  readonly onNext: () => void;
}

export function ResultsTable({
  query,
  items,
  total,
  page,
  loading,
  error,
  onOpenContext,
  onOpenMedia,
  onPrev,
  onNext
}: ResultsTableProps) {
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const keyword = query?.keyword ?? "";
  const meta = loading
    ? "查询中..."
    : query
      ? `共 ${total} 条 · 第 ${page} / ${pageCount} 页 · 本页 ${items.length} 条`
      : "暂无结果";

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="font-display text-base">查询结果</CardTitle>
        <CardDescription>{meta}</CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>查询失败</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {!loading && items.length === 0 ? (
          <Empty className="min-h-64">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchIcon />
              </EmptyMedia>
              <EmptyTitle>{query ? "没有匹配结果" : "尚未查询"}</EmptyTitle>
              <EmptyDescription>
                {query ? "尝试放宽关键词或调整时间范围" : "在左侧填写检索条件后开始查询"}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>消息内容</TableHead>
                <TableHead className="w-24">上下文</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && items.length === 0
                ? Array.from({ length: 5 }, (_, index) => (
                    <TableRow key={index}>
                      <TableCell>
                        <div className="flex flex-col gap-2 py-1">
                          <Skeleton className="h-4 w-2/3" />
                          <Skeleton className="h-3 w-full" />
                          <Skeleton className="h-3 w-1/2" />
                        </div>
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-7 w-16" />
                      </TableCell>
                    </TableRow>
                  ))
                : items.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="align-top">
                        <MessageCell row={row} keyword={keyword} onOpenMedia={onOpenMedia} />
                      </TableCell>
                      <TableCell className="align-top">
                        <Button variant="ghost" size="sm" onClick={() => onOpenContext(row)}>
                          <ScrollTextIcon data-icon="inline-start" />
                          上下文
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {items.length > 0 ? (
        <CardFooter className="flex-wrap justify-between gap-3">
          <p className="text-xs text-muted-foreground">第 {page} / {pageCount} 页</p>
          <Pagination className="w-auto">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  text="上一页"
                  href="#"
                  onClick={(event) => {
                    event.preventDefault();
                    if (page > 1) onPrev();
                  }}
                />
              </PaginationItem>
              <PaginationItem>
                <PaginationNext
                  text="下一页"
                  href="#"
                  onClick={(event) => {
                    event.preventDefault();
                    if (page < pageCount) onNext();
                  }}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </CardFooter>
      ) : null}
    </Card>
  );
}