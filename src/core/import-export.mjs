export function exportStudio(studio){return {format:"apex-studio",version:studio.version,exportedAt:new Date().toISOString(),snapshot:studio.snapshot()};}
export function importStudio(studio,bundle){if(bundle?.format!=="apex-studio")throw new Error("Unsupported Apex bundle");return studio.restore(bundle.snapshot??{});}
