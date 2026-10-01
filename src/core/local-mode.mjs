export class LocalMode {
  constructor(policy){this.policy=policy;}
  isOffline(){return this.policy.localOnly===true;}
  assertRemoteAllowed(){
    if(this.isOffline() || this.policy.remoteProviders===false) throw new Error("Remote operation disabled by local-first policy");
    return true;
  }
  providerAllowed(kind="remote"){return kind==="local" || (this.policy.remoteProviders===true && !this.isOffline());}
}