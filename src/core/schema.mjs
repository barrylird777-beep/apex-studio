export const APEX_SCHEMA_VERSION = "3.0.0";
export const ENTITY_TYPES = ["person","place","event","object","text","theme","faction","scene","asset","timeline","agent"];
export const RELATION_TYPES = ["mentions","located_at","participates_in","causes","precedes","follows","related_to","derived_from","depicts","appears_in","variant_of","contradicts","supports","influences"];

export function entity(input={}) {
  return {
    id: input.id ?? crypto.randomUUID(),
    type: input.type ?? "entity",
    name: input.name ?? "Unnamed",
    aliases: input.aliases ?? [],
    attributes: input.attributes ?? {},
    provenance: input.provenance ?? [],
    tags: input.tags ?? [],
    createdAt: input.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export function relation(input={}) {
  return {
    id: input.id ?? crypto.randomUUID(),
    type: input.type ?? "related_to",
    from: input.from,
    to: input.to,
    confidence: input.confidence ?? 1,
    provenance: input.provenance ?? [],
    attributes: input.attributes ?? {}
  };
}
