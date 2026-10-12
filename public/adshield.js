(() => {
  "use strict";
  if (window.__APEX_ADSHIELD__) return;
  window.__APEX_ADSHIELD__ = true;

  const youtube = /(^|\\.)youtube(?:-nocookie)?\\.com$/i.test(location.hostname);
  const genericSelectors = [
    '[id^="ad-"]',
    '[id*="advert"]',
    '[class*="advertisement"]',
    '[class*="ad-banner"]',
    '[data-ad-slot]',
    '[aria-label="Advertisement"]'
  ];
  const youtubeSelectors = [
    "ytd-display-ad-renderer",
    "ytd-promoted-sparkles-web-renderer",
    "ytd-ad-slot-renderer",
    "ytd-in-feed-ad-layout-renderer",
    ".ytp-ad-overlay-container",
    ".ytp-ad-overlay-slot",
    ".ytp-ad-text-overlay"
  ];

  const hide = (root = document) => {
    const selectors = youtube ? genericSelectors.concat(youtubeSelectors) : genericSelectors;
    for (const selector of selectors) {
      try {
        root.querySelectorAll(selector).forEach(el => {
          if (el && el.style.display !== "none") {
            el.style.setProperty("display", "none", "important");
            el.setAttribute("data-apex-adshield", "hidden");
          }
        });
      } catch {}
    }
  };

  const skipYoutubeAd = () => {
    if (!youtube) return;
    document.querySelectorAll("video").forEach(video => {
      const player = video.closest(".html5-video-player");
      if (!player?.classList.contains("ad-showing")) return;
      const skip = player.querySelector(
        ".ytp-ad-skip-button, .ytp-ad-skip-button-modern, button.ytp-ad-skip-button"
      );
      if (skip) {
        try { skip.click(); } catch {}
      }
      if (Number.isFinite(video.duration) && video.duration > 0) {
        try {
          video.currentTime = video.duration;
        } catch {}
      }
    });
  };

  const run = () => {
    hide();
    skipYoutubeAd();
  };

  run();
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(skipYoutubeAd, 350);
})();