import { GARDEN_OF_APEX, createGarden } from "../core/garden-of-apex.mjs";
import { getApexApp } from "./apex-six-apps.mjs";

const APP = getApexApp("garden-of-apex");

export function createGardenApp(options = {}) {
  const garden = createGarden(options);
  return Object.freeze({
    app: { ...APP },
    meta: GARDEN_OF_APEX,
    put: garden.put,
    get: garden.get,
    list: garden.list,
    snapshot: garden.snapshot,
    status() {
      return {
        app: { ...APP },
        collective: GARDEN_OF_APEX.collective,
        scope: [...GARDEN_OF_APEX.scope],
        itemCount: garden.list().length,
        checkedAt: new Date().toISOString()
      };
    }
  });
}

export function gardenStatus(itemCount = 0) {
  return {
    app: { ...APP },
    collective: GARDEN_OF_APEX.collective,
    scope: [...GARDEN_OF_APEX.scope],
    itemCount: Math.max(0, Number(itemCount) || 0),
    checkedAt: new Date().toISOString()
  };
}
