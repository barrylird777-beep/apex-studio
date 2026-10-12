export function uid(prefix="apx") { return `${prefix}_${crypto.randomUUID().replaceAll("-","")}`; }
export function now() { return new Date().toISOString(); }
