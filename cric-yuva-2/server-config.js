// Cric Yuva 2 deployment configuration.
// Automatically connects to local backend in development/preview environments,
// while preserving production Render fallback when hosted externally.
(function () {
  if (typeof window !== "undefined") {
    const host = window.location.hostname || "";
    const isDev =
      !host ||
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.includes("run.app") ||
      host.includes("webcontainer") ||
      host.includes("github.dev") ||
      host.includes("app.github.dev");

    window.CRIC_YUVA_API_BASE = isDev ? "" : "https://yashwin-app-store.onrender.com";
  }
})();
