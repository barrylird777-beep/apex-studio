export function provenanceRecord(input={}){
  return {sourceId:input.sourceId??null,sourceClass:input.sourceClass??null,locator:input.locator??null,claimType:input.claimType??"statement",confidence:input.confidence??"unspecified",note:input.note??null};
}

export function classifyClaim(claim={}){
  if(claim.original===true) return "original_fiction";
  if(claim.sourceClass) return claim.sourceClass;
  return "unclassified";
}
