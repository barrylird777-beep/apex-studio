import { SACRED_TEXT_FAMILIES, SACRED_TEXT_TYPES, createSacredTextRecord, validateSacredTextRecord } from "./sacred-library.mjs";

export function indexSacredText(records=[]){
  const seen=new Set(), index={byId:{},byFamily:{},byLanguage:{},invalid:[]};
  for(const input of records){
    const record=createSacredTextRecord(input), validation=validateSacredTextRecord(record);
    if(!validation.ok){ index.invalid.push({record,errors:validation.errors}); continue; }
    if(seen.has(record.id)){ index.invalid.push({record,errors:["duplicate id"]}); continue; }
    seen.add(record.id);
    index.byId[record.id]=record;
    (index.byFamily[record.familyId]??=[]).push(record.id);
    (index.byLanguage[record.language]??=[]).push(record.id);
  }
  return {count:seen.size,...index};
}

export function buildSacredLibraryRegistry(records=[]){
  const indexed=indexSacredText(records);
  return {
    version:"1.0.0",
    supportedFamilies:SACRED_TEXT_FAMILIES.map(x=>x.id),
    supportedTextTypes:[...SACRED_TEXT_TYPES],
    ...indexed,
    ready:indexed.invalid.length===0
  };
}
