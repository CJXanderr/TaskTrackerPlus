import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initializeRootColorScheme } from "./lib/rootColorScheme";

// Keep native form controls (date picker, scrollbars) in step with Root's theme.
initializeRootColorScheme();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
