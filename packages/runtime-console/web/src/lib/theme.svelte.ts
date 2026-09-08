export type Theme = "light" | "dark";

const STORAGE_KEY = "console-web-theme";

function initialTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

class ThemeStore {
  theme: Theme = $state(initialTheme());

  toggle(): void {
    this.theme = this.theme === "dark" ? "light" : "dark";
    localStorage.setItem(STORAGE_KEY, this.theme);
  }
}

export const theme = new ThemeStore();