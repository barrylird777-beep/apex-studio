export const GARDEN_OF_APEX=Object.freeze({
  id:'GardenOfApex',
  type:'living_world',
  collective:'Jesus Freaks',
  scope:['world_simulation','research','knowledge','scripture','culture','civilization','creative_discovery']
});

export function createGarden({store=new Map()}={}) {
  const worlds=store;
  function put(id,value){if(!id)throw new TypeError('id is required');worlds.set(String(id),structuredClone(value));return worlds.get(String(id));}
  function get(id){const value=worlds.get(String(id));return value===undefined?null:structuredClone(value);}
  function list(){return [...worlds.keys()].sort();}
  function snapshot(){return {meta:GARDEN_OF_APEX,items:list().map(id=>({id,value:get(id)}))};}
  return {put,get,list,snapshot};
}
