import { createApp } from "vue";
import App from "./App.vue";
import "./style.css";
createApp(App).mount("#app");

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register(new URL("sw.js", document.baseURI), { updateViaCache: "none" })
      .catch(() => {
        /* Dashboard remains usable if offline installation is unavailable. */
      });
  });
}
