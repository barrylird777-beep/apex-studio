import { uid, now } from "./id.mjs";

export class UniverseScale {
  constructor(){
    this.units=new Map();
    this.links=new Map();
  }
  create(input={}){
    const unit={id:input.id??uid("cosmos"),kind:input.kind??"region",name:input.name??"Unnamed Region",parentId:input.parentId??null,scale:input.scale??"galactic",metadata:input.metadata??{},createdAt:now(),updatedAt:now()};
    this.units.set(unit.id,unit);
    if(unit.parentId){
      const children=this.links.get(unit.parentId)??[];
      children.push(unit.id);
      this.links.set(unit.parentId,children);
    }
    return unit;
  }
  get(id){return this.units.get(id)??null;}
  children(id){return (this.links.get(id)??[]).map(x=>this.get(x)).filter(Boolean);}
  list(){return [...this.units.values()];}
  seedMilkyWay(){
    if([...this.units.values()].some(x=>x.name==="Milky Way")) return this.list();
    const galaxy=this.create({kind:"galaxy",name:"Milky Way",scale:"galactic",metadata:{diameterLightYears:100000}});
    for(const name of ["Galactic Core","Orion Arm","Perseus Arm","Sagittarius Arm","Outer Disk","Stellar Halo"]){
      this.create({kind:"region",name,parentId:galaxy.id,scale:"stellar",metadata:{status:"mapped"}});
    }
    return this.list();
  }
}
