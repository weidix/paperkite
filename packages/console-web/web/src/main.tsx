import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";
import App from "@/App";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/lib/theme";
import { RuntimeProvider } from "@/lib/runtime-context";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <RuntimeProvider>
        <App />
        <Toaster />
      </RuntimeProvider>
    </ThemeProvider>
  </StrictMode>
);