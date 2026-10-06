/** Canonical Garden of Apex domain vocabulary. */
export const GARDEN_OF_APEX = Object.freeze({
  slug: 'the-garden-of-apex',
  name: 'THE Garden of Apex',
  kind: 'garden',
  collective: 'Jesus Freaks',
  description: 'The living world and ecosystem of the Jesus Freaks.',
  freakKinds: Object.freeze(['kernel', 'popcorn', 'cornnut', 'cob', 'protocob']),
  lifeStages: Object.freeze(['kernet', 'active']),
  discoveryKinds: Object.freeze(['popcorn', 'protocob', 'insight', 'artifact']),
});
export function isGardenFreakKind(value) { return GARDEN_OF_APEX.freakKinds.includes(String(value).toLowerCase()); }
export function assertGardenFreakKind(value) {
  if (!isGardenFreakKind(value)) throw new TypeError(`Unknown Garden Freak kind: ${value}`);
  return String(value).toLowerCase();
}
