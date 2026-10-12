export function remoteProviderGuard(studio) {
  return (_req,res,next)=>{
    if (studio.localMode.providerAllowed("remote")) return next();
    res.status(403).json({
      error:"Remote providers are disabled by the local-first policy.",
      hint:"Set APEX_ALLOW_REMOTE_PROVIDERS=true only when you explicitly want external AI services."
    });
  };
}
