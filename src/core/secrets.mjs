import crypto from "node:crypto";

export function createSecretStore(){
  const secrets=new Map();
  return {
    set(name,value){secrets.set(name,String(value));return {name,stored:true};},
    has(name){return secrets.has(name);},
    get(name){return secrets.get(name)??null;},
    remove(name){return secrets.delete(name);},
    names(){return [...secrets.keys()];},
    exportRedacted(){return Object.fromEntries([...secrets.keys()].map(k=>[k,"[REDACTED]"]));}
  };
}

export function deriveKey(passphrase,salt=crypto.randomBytes(16)){
  return {salt:salt.toString("base64"),key:crypto.scryptSync(String(passphrase),salt,32).toString("base64")};
}