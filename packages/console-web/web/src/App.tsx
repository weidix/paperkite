import { useState } from "react";
import {
  FileTextIcon,
  GaugeIcon,
  MenuIcon,
  MoonIcon,
  PuzzleIcon,
  RadioIcon,
  SunIcon,
  WorkflowIcon,
  ZapIcon,
  type LucideIcon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { LiveBadge } from "@/components/status";
import { useRuntime } from "@/lib/runtime-context";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import Overview from "@/views/overview";
import Flows from "@/views/flows";
import Events from "@/views/events";
import Actions from "@/views/actions";
import Logs from "@/views/logs";
import Plugins from "@/views/plugins";

type View = "overview" | "flows" | "events" | "actions" | "logs" | "plugins";

const VIEWS: readonly { value: View; label: string; icon: LucideIcon }[] = [
  { value: "overview", label: "总览", icon: GaugeIcon },
  { value: "flows", label: "流程", icon: WorkflowIcon },
  { value: "events", label: "事件", icon: RadioIcon },
  { value: "actions", label: "动作", icon: ZapIcon },
  { value: "logs", label: "日志", icon: FileTextIcon },
  { value: "plugins", label: "插件", icon: PuzzleIcon }
];

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-2 py-1">
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <span className="block size-3 rotate-45 rounded-[3px] border-2 border-primary-foreground" aria-hidden="true" />
      </span>
      <div className="flex flex-col leading-tight">
        <span className="font-display text-sm font-semibold tracking-tight">纸鸢</span>
        <span className="text-[11px] text-muted-foreground">运行控制台</span>
      </div>
    </div>
  );
}

function NavList({ view, onSelect }: { view: View; onSelect: (view: View) => void }) {
  return (
    <nav className="flex flex-col gap-1" aria-label="主导航">
      {VIEWS.map((item) => (
        <button
          key={item.value}
          type="button"
          onClick={() => onSelect(item.value)}
          className={cn(
            "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            view === item.value ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          <item.icon className="size-4" />
          {item.label}
        </button>
      ))}
    </nav>
  );
}

export default function App() {
  const [view, setView] = useState<View>("overview");
  const [navOpen, setNavOpen] = useState(false);
  const { snapshot, connected } = useRuntime();
  const { theme, toggle } = useTheme();
  const current = VIEWS.find((item) => item.value === view) ?? VIEWS[0]!;

  const selectView = (next: View): void => {
    setView(next);
    setNavOpen(false);
  };

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden w-56 shrink-0 flex-col gap-6 border-r bg-card/60 p-3 md:flex">
        <Brand />
        <NavList view={view} onSelect={setView} />
        <div className="mt-auto px-2">
          <p className="font-mono text-[11px] text-muted-foreground">
            paperkite · runtime.console_web
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
          <Sheet open={navOpen} onOpenChange={setNavOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="sm" className="md:hidden" aria-label="打开导航">
                <MenuIcon className="size-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-3">
              <SheetTitle className="sr-only">导航</SheetTitle>
              <div className="flex h-full flex-col gap-6">
                <Brand />
                <NavList view={view} onSelect={selectView} />
              </div>
            </SheetContent>
          </Sheet>
          <h1 className="font-display text-base font-semibold tracking-tight">{current.label}</h1>
          <span className="flex-1" />
          <LiveBadge label={snapshot?.running ? "运行中" : "已停止"} tone={snapshot?.running ? "ok" : "bad"} />
          <LiveBadge label={connected ? "已连接" : "重连中"} tone={connected ? "ok" : "bad"} />
          <Button variant="ghost" size="sm" onClick={toggle} aria-label="切换主题">
            {theme === "dark" ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
          </Button>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
          {view === "overview" ? <Overview onNavigate={setView} /> : null}
          {view === "flows" ? <Flows /> : null}
          {view === "events" ? <Events /> : null}
          {view === "actions" ? <Actions /> : null}
          {view === "logs" ? <Logs /> : null}
          {view === "plugins" ? <Plugins /> : null}
        </main>
      </div>
    </div>
  );
}