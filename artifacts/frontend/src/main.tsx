import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { registerSW } from "virtual:pwa-register";

if ("serviceWorker" in navigator) {
  registerSW({
    onNeedRefresh() {},
    onOfflineReady() {
      console.log("Vipro ERP: ready to work offline");
    },
  });
}

createRoot(document.getElementById("root")!).render(<App />);
