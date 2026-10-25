import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyAppearance, preference } from "./client/appearance";
import { applyLayout, layoutPreference } from "./client/layout";
import "./styles.css";

const target = document.getElementById("root");
applyAppearance(preference());
applyLayout(layoutPreference());
if (target) createRoot(target).render(<App />);
if ("serviceWorker" in navigator)
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => {});
  });
