(() => {
  "use strict";
  function alignCurrentApp() {
    const nav = document.querySelector(".apex-app-nav");
    const current = nav?.querySelector('a[aria-current="page"]');
    if (!nav || !current) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const target = current.offsetLeft - Math.max(0, (nav.clientWidth - current.clientWidth) / 2);
    nav.scrollTo({ left: Math.max(0, target), behavior: reduceMotion ? "auto" : "smooth" });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", alignCurrentApp, { once: true });
  } else {
    alignCurrentApp();
  }
})();