import { useState, type FormEvent } from "react";
import { SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { toIsoString } from "@/lib/format";
import type { SearchQuery, TimeMode } from "@/lib/types";

interface SearchFormProps {
  readonly loading: boolean;
  readonly onSubmit: (query: SearchQuery) => void;
}

export function SearchForm({ loading, onSubmit }: SearchFormProps) {
  const [keyword, setKeyword] = useState("");
  const [excludeKeyword, setExcludeKeyword] = useState("");
  const [chatTitle, setChatTitle] = useState("");
  const [timeMode, setTimeMode] = useState<TimeMode>("include");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const switchTimeMode = (value: string): void => {
    const next = value as TimeMode;
    setTimeMode(next);
    if (next === "off") {
      setDateFrom("");
      setDateTo("");
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (loading) return;
    onSubmit({
      keyword: keyword.trim(),
      excludeKeyword: excludeKeyword.trim(),
      chatTitle: chatTitle.trim(),
      dateFrom: timeMode === "off" ? "" : toIsoString(dateFrom),
      dateTo: timeMode === "off" ? "" : toIsoString(dateTo),
      timeMode
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-base">检索条件</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="form-keyword">关键词</FieldLabel>
              <Input
                id="form-keyword"
                placeholder="多个关键词用空格分隔，例如 clash 节点 香港"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="form-exclude-keyword">不显示关键词</FieldLabel>
              <Input
                id="form-exclude-keyword"
                placeholder="多个关键词用空格分隔，例如 广告 抽奖"
                value={excludeKeyword}
                onChange={(event) => setExcludeKeyword(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="form-chat-title">群组名称</FieldLabel>
              <Input
                id="form-chat-title"
                placeholder="支持模糊匹配，例如 技术群"
                value={chatTitle}
                onChange={(event) => setChatTitle(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="form-time-mode">时间筛选</FieldLabel>
              <Select value={timeMode} onValueChange={switchTimeMode}>
                <SelectTrigger id="form-time-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="include">包含时间区间</SelectItem>
                    <SelectItem value="exclude">不包含时间区间</SelectItem>
                    <SelectItem value="off">不按时间筛选</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="form-date-from">开始时间</FieldLabel>
              <Input
                id="form-date-from"
                type="datetime-local"
                value={dateFrom}
                disabled={timeMode === "off"}
                onChange={(event) => setDateFrom(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="form-date-to">结束时间</FieldLabel>
              <Input
                id="form-date-to"
                type="datetime-local"
                value={dateTo}
                disabled={timeMode === "off"}
                onChange={(event) => setDateTo(event.target.value)}
              />
            </Field>
          </FieldGroup>
          <Button type="submit" aria-busy={loading} className={loading ? "cursor-wait" : undefined}>
            {loading ? <Spinner data-icon="inline-start" /> : <SearchIcon data-icon="inline-start" />}
            查询
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}