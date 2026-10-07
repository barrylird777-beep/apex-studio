export const APEX_APPLICATIONS = Object.freeze([
  'KornKnob',
  'Apex Rapid Production',
  'Apex Opportunity Engine',
  'Apex Studio',
  'Garden of Apex'
]);

export function assertApexApplication(name) {
  if (!APEX_APPLICATIONS.includes(name)) throw new Error(`unknown Apex application: ${name}`);
  return name;
}

export function applicationStatePath(root, name) {
  assertApexApplication(name);
  return `${root}/applications/${encodeURIComponent(name)}/state`;
}
