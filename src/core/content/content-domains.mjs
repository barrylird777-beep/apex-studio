export const CONTENT_DOMAINS = Object.freeze({
  BIBLE: "bible",
  KORN: "korn",
  ORIGINAL: "original"
});

export const AUDIO_PRODUCTION_ROLES = Object.freeze([
  "songwriting",
  "composition",
  "recording",
  "vocals",
  "narration",
  "dialogue",
  "music",
  "ambience",
  "sfx",
  "sound-design",
  "mix",
  "master"
]);

export function normalizeContentDomain(value) {
  const domain = String(value || CONTENT_DOMAINS.BIBLE).trim().toLowerCase();
  if (!Object.values(CONTENT_DOMAINS).includes(domain)) {
    throw new Error(`Unsupported content domain: ${domain}`);
  }
  return domain;
}

export function contentDomainPolicy(domain) {
  const normalized = normalizeContentDomain(domain);
  return Object.freeze({
    domain: normalized,
    requiresGardenPackage: normalized === CONTENT_DOMAINS.KORN,
    scriptureBacked: normalized === CONTENT_DOMAINS.BIBLE,
    canProduceFilm: true,
    canProduceShortVideo: true,
    canProduceMusic: true,
    audioRoles: AUDIO_PRODUCTION_ROLES
  });
}
