# Apex Studio Ad Blocker — iPhone

Native iOS companion for Apex Studio Network/Infrastructure. It uses Apple's system-wide encrypted DNS settings API. The user must explicitly enable the configuration in iOS Settings.

Build the Xcode project, set your Signing Team, enable Network Extensions → DNS Settings, install on the iPhone, then open the app and choose Install Ad Blocker. Enable the resulting DNS configuration in iOS Settings.

DNS blocking catches ad/tracker domains across the device. It cannot guarantee removal of ads served from the same first-party domain as legitimate content or hard-coded into an app.
