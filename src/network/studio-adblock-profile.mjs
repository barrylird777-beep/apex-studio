const DOH_URL = process.env.APEX_ADBLOCK_DOH_URL || "https://apex-studio-production.up.railway.app/api/network/adblock/doh";
const PROFILE_UUID = "A6A7B5F4-7D2A-4C3D-9F4C-5D1A4E7C9B20";
const DNS_PAYLOAD_UUID = "D9E2C6A1-3B74-4F2E-8C51-6A93B7D4E105";

function xmlEscape(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function plistString(value) {
  return `<string>${xmlEscape(value)}</string>`;
}

export function studioAdBlockMobileConfig() {
  const dohURL = new URL(DOH_URL);
  if (dohURL.protocol !== "https:") throw new Error("APEX_ADBLOCK_DOH_URL must use HTTPS");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>DNSSettings</key>
      <dict>
        <key>DNSProtocol</key>
        ${plistString("HTTPS")}
        <key>ServerURL</key>
        ${plistString(dohURL.toString())}
        <key>OnDemandRules</key>
        <array>
          <dict>
            <key>Action</key>
            ${plistString("Connect")}
          </dict>
        </array>
      </dict>
      <key>PayloadDescription</key>
      ${plistString("System-wide encrypted DNS ad and tracker blocking.")}
      <key>PayloadDisplayName</key>
      ${plistString("Apex Studio Ad Blocker DNS")}
      <key>PayloadIdentifier</key>
      ${plistString("com.apex.studio.adblocker.dns")}
      <key>PayloadOrganization</key>
      ${plistString("Apex Studio")}
      <key>PayloadType</key>
      ${plistString("com.apple.dnsSettings.managed")}
      <key>PayloadUUID</key>
      ${plistString(DNS_PAYLOAD_UUID)}
      <key>PayloadVersion</key>
      <integer>1</integer>
    </dict>
  </array>
  <key>PayloadDescription</key>
  ${plistString("Apex Studio system-wide DNS ad and tracker blocker.")}
  <key>PayloadDisplayName</key>
  ${plistString("Apex Studio Ad Blocker")}
  <key>PayloadIdentifier</key>
  ${plistString("com.apex.studio.adblocker.profile")}
  <key>PayloadOrganization</key>
  ${plistString("Apex Studio")}
  <key>PayloadType</key>
  ${plistString("Configuration")}
  <key>PayloadUUID</key>
  ${plistString(PROFILE_UUID)}
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>
`;
  return xml;
}
