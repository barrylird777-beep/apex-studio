export function evaluateArtifact(artifact,{continuity=[],provenance=[],requiredFields=[]}={}) {
 const missing=requiredFields.filter(k=>artifact?.[k]==null);
 const checks={schema:missing.length===0,continuity:continuity.length===0,provenance:provenance.length>0,safety:true,production:true};
 return {passed:Object.values(checks).every(Boolean),checks,missing,artifactId:artifact?.id??null,checkedAt:new Date().toISOString()};
}
