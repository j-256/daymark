import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyAppearance, preference } from "./client/appearance";
import "./styles.css";

const target = document.getElementById("root");
applyAppearance(preference());
if (target) createRoot(target).render(<App />);
if ("serviceWorker" in navigator)
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => {});
  });
