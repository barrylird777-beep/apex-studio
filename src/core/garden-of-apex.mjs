export const GARDEN_OF_APEX=Object.freeze({
  id:'GardenOfApex',
  type:'living_world',
  collective:'Jesus Freaks',
  scope:Object.freeze(['world_simulation','research','knowledge','scripture','culture','civilization','creative_discovery'])
});

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;

function validateId(id){
  const value=String(id ?? '').trim();
  if(!SAFE_ID.test(value)) throw new TypeError('Garden id is invalid or too long');
  return value;
}

export function createGarden({store=new Map()}={}){
  if(!store || typeof store.set!=='function' || typeof store.get!=='function') throw new TypeError('Garden store must implement Map-like get/set');
  const worlds=store;
  function put(id,value){
    const key=validateId(id);
    if(value===undefined) throw new TypeError('Garden value is required');
    const cloned=structuredClone(value);
    worlds.set(key,cloned);
    return structuredClone(cloned);
  }
  function get(id){
    const key=validateId(id);
    const value=worlds.get(key);
    return value===undefined?null:structuredClone(value);
  }
  function list(){return [...worlds.keys()].sort();}
  function snapshot(){return {meta:GARDEN_OF_APEX,items:list().map(id=>({id,value:get(id)}))};}
  return Object.freeze({put,get,list,snapshot});
}
