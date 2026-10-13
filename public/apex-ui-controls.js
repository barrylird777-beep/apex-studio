(() => {
  "use strict";
  const nav = document.querySelector(".apex-app-nav");
  if (!nav || document.querySelector("[data-apex-ui-controls]")) return;

  const links = [...nav.querySelectorAll('a:not(.apex-app-brand)')];
  if (!links.length) return;

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "apex-ui-menu-trigger";
  trigger.textContent = "Menu";
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", "apex-ui-drawer");
  trigger.setAttribute("aria-label", "Open app menu and display settings");
  nav.append(trigger);

  const backdrop = document.createElement("div");
  backdrop.className = "apex-ui-backdrop";
  backdrop.hidden = true;
  backdrop.dataset.apexUiControls = "true";

  const drawer = document.createElement("aside");
  drawer.className = "apex-ui-drawer";
  drawer.id = "apex-ui-drawer";
  drawer.setAttribute("role", "dialog");
  drawer.setAttribute("aria-modal", "true");
  drawer.setAttribute("aria-labelledby", "apex-ui-drawer-title");
  drawer.tabIndex = -1;

  const heading = document.createElement("div");
  heading.className = "apex-ui-drawer-heading";
  const title = document.createElement("h2");
  title.id = "apex-ui-drawer-title";
  title.textContent = "APEX controls";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "apex-ui-close";
  close.textContent = "Close";
  close.setAttribute("aria-label", "Close app menu and display settings");
  heading.append(title, close);

  const appSection = document.createElement("section");
  appSection.className = "apex-ui-drawer-section";
  const appHeading = document.createElement("h3");
  appHeading.textContent = "Six canonical apps";
  const appList = document.createElement("div");
  appList.className = "apex-ui-drawer-links";
  for (const link of links) {
    const copy = link.cloneNode(true);
    copy.removeAttribute("style");
    if (link.getAttribute("aria-current") === "page") {
      copy.setAttribute("aria-current", "page");
      copy.setAttribute("aria-label", (copy.textContent.trim() || "Current app") + ", current page");
    }
    appList.append(copy);
  }
  appSection.append(appHeading, appList);

  const settings = document.createElement("section");
  settings.className = "apex-ui-drawer-section";
  const settingsHeading = document.createElement("h3");
  settingsHeading.textContent = "Display settings";
  const settingsNote = document.createElement("p");
  settingsNote.textContent = "These visual adjustments apply only in this open page. They do not change your saved app data.";
  settingsNote.className = "apex-ui-settings-note";

  function addToggle(labelText, className, description) {
    const label = document.createElement("label");
    label.className = "apex-ui-toggle";
    const copy = document.createElement("span");
    copy.className = "apex-ui-toggle-copy";
    const name = document.createElement("strong");
    name.textContent = labelText;
    const detail = document.createElement("small");
    detail.textContent = description;
    copy.append(name, detail);
    const input = document.createElement("input");
    input.type = "checkbox";
    input.addEventListener("change", () => document.body.classList.toggle(className, input.checked));
    label.append(copy, input);
    settings.append(label);
  }
  addToggle("Higher contrast", "apex-ui-high-contrast", "Strengthen text and panel borders.");
  addToggle("Compact spacing", "apex-ui-compact", "Fit more dashboard content on screen.");

  const footer = document.createElement("p");
  footer.className = "apex-ui-drawer-footer";
  footer.textContent = "APEX ANCHOR · app boundaries remain separate";
  settings.append(settingsHeading, settingsNote, ...settings.querySelectorAll(".apex-ui-toggle"), footer);

  drawer.append(heading, appSection, settings);
  backdrop.append(drawer);
  document.body.append(backdrop);

  let priorFocus = null;
  function openDrawer() {
    priorFocus = document.activeElement;
    backdrop.hidden = false;
    document.body.classList.add("apex-ui-drawer-open");
    trigger.setAttribute("aria-expanded", "true");
    close.focus();
  }
  function closeDrawer() {
    backdrop.hidden = true;
    document.body.classList.remove("apex-ui-drawer-open");
    trigger.setAttribute("aria-expanded", "false");
    if (priorFocus && typeof priorFocus.focus === "function") priorFocus.focus();
  }
  trigger.addEventListener("click", openDrawer);
  close.addEventListener("click", closeDrawer);
  backdrop.addEventListener("click", event => { if (event.target === backdrop) closeDrawer(); });
  drawer.addEventListener("click", event => {
    if (event.target.closest("a")) closeDrawer();
  });
  document.addEventListener("keydown", event => {
    if (backdrop.hidden) return;
    if (event.key === "Escape") { event.preventDefault(); closeDrawer(); return; }
    if (event.key !== "Tab") return;
    const focusable = [...drawer.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled),[tabindex="0"]')];
    if (!focusable.length) { event.preventDefault(); drawer.focus(); return; }
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
})();