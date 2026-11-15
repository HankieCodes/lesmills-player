import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

function showFatal(text: string): void {
  console.error(text);
  const el = document.getElementById("root");
  if (el) {
    el.innerHTML = "";
    const pre = document.createElement("pre");
    pre.className = "fatal";
    pre.textContent = `LM Sync failed to start.\n\n${text}\n\nLog file: %APPDATA%\\lmsync\\logs\\main.log (press F12 for DevTools)`;
    el.appendChild(pre);
  }
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("React render error", error.stack, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return <pre className="fatal">{`Something went wrong:\n\n${this.state.error.stack ?? this.state.error.message}`}</pre>;
    }
    return this.props.children;
  }
}

window.addEventListener("error", (e) => showFatal(`${e.message}\n${e.filename}:${e.lineno}`));
window.addEventListener("unhandledrejection", (e) => console.error("Unhandled rejection", e.reason));

if (typeof window.lmsync === "undefined") {
  showFatal("The preload bridge (window.lmsync) is missing, so the app cannot talk to the main process.");
} else {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
}
