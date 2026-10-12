export function requiredString(value,name,{max=10000,min=1}={}) {
  if(typeof value!=="string" || value.trim().length<min || value.length>max) throw Object.assign(new Error(name+" must be a string of length "+min+"-"+max),{statusCode:400});
  return value.trim();
}
export function optionalString(value,name,{max=10000}={}) {
  if(value===undefined||value===null) return undefined;
  return requiredString(value,name,{max});
}
export function positiveInt(value,name,{max=100000}={}) {
  const n=Number(value);
  if(!Number.isInteger(n)||n<1||n>max) throw Object.assign(new Error(name+" must be a positive integer"),{statusCode:400});
  return n;
}
export function objectBody(value) {
  if(!value || typeof value!=="object" || Array.isArray(value)) throw Object.assign(new Error("Request body must be an object"),{statusCode:400});
  return value;
}
