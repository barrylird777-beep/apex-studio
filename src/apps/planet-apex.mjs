import crypto from "node:crypto";
import { getApexApp } from "./apex-six-apps.mjs";

const APP = getApexApp("planet-apex");
const clone = value => structuredClone(value);
const safeId = value => {
  const id = String(value ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(id)) throw new TypeError("PlanetApeX id is invalid");
  return id;
};
const objectOrEmpty = value => value && typeof value === "object" && !Array.isArray(value) ? clone(value) : {};

export function createPlanet(input = {}) {
  return {
    id: safeId(input.id || crypto.randomUUID()),
    name: String(input.name || "PlanetApeX"),
    state: objectOrEmpty(input.state),
    regions: Array.isArray(input.regions) ? clone(input.regions) : [],
    entities: Array.isArray(input.entities) ? clone(input.entities) : [],
    createdAt: new Date().toISOString()
  };
}

export function addPlanetRegion(planet, input = {}) {
  const next = clone(planet);
  if (!next || typeof next !== "object") throw new TypeError("PlanetApeX planet is required");
  const id = safeId(input.id || crypto.randomUUID());
  if (!Array.isArray(next.regions)) next.regions = [];
  if (next.regions.some(region => region.id === id)) throw new Error("PlanetApeX region already exists: " + id);
  next.regions.push({
    id,
    name: String(input.name || "Unnamed region"),
    type: String(input.type || "region"),
    state: objectOrEmpty(input.state)
  });
  return next;
}

export function addPlanetEntity(planet, input = {}) {
  const next = clone(planet);
  if (!next || typeof next !== "object") throw new TypeError("PlanetApeX planet is required");
  const id = safeId(input.id || crypto.randomUUID());
  if (!Array.isArray(next.entities)) next.entities = [];
  if (next.entities.some(entity => entity.id === id)) throw new Error("PlanetApeX entity already exists: " + id);
  const regionId = input.regionId ? safeId(input.regionId) : null;
  if (regionId && (!Array.isArray(next.regions) || !next.regions.some(region => region.id === regionId))) {
    throw new Error("PlanetApeX entity references an unknown region: " + regionId);
  }
  next.entities.push({
    id,
    kind: String(input.kind || "entity"),
    name: String(input.name || "Unnamed entity"),
    regionId,
    state: objectOrEmpty(input.state)
  });
  return next;
}

export function planetSnapshot(planet) {
  return clone(planet);
}

export function planetApexStatus() {
  return {
    app: { ...APP },
    role: APP.role,
    capabilities: ["world-registry", "world-state", "regions", "entities", "cross-app world context"],
    persistence: "caller-owned; no process-local durability claim",
    canonical: true,
    checkedAt: new Date().toISOString()
  };
}
