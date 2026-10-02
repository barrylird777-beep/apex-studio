import { uid, now } from "./id.mjs";

export class UniverseScale {
  constructor() {
    this.objects = new Map();
  }

  add(input = {}) {
    const object = {
      id: input.id ?? uid("universe"),
      name: input.name ?? "Unnamed",
      type: input.type ?? "object",
      parentId: input.parentId ?? null,
      metadata: { ...(input.metadata ?? {}) },
      createdAt: input.createdAt ?? now(),
      updatedAt: now()
    };
    this.objects.set(object.id, object);
    return object;
  }

  get(id) {
    return this.objects.get(id) ?? null;
  }

  list() {
    return [...this.objects.values()];
  }

  seedMilkyWay() {
    if (this.list().length) return this;
    const galaxy = this.add({ id: "milky-way", name: "Milky Way", type: "galaxy" });
    this.add({ id: "solar-system", name: "Solar System", type: "star-system", parentId: galaxy.id });
    this.add({ id: "earth", name: "Earth", type: "planet", parentId: "solar-system" });
    return this;
  }

  snapshot() {
    return this.list();
  }

  restore(items = []) {
    for (const item of items) this.objects.set(item.id, item);
    return this;
  }
}
