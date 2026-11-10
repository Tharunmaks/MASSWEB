import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Browser } from "@/components/massweb/shell";
import "@/styles.css";

/** Static entry for GitHub Pages: just the browser shell, talking to a Mass Web server. */
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Browser />
  </StrictMode>,
);
