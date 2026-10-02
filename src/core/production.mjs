import crypto from "node:crypto";

export const STAGES=Object.freeze(["concept","research","outline","script","storyboard","visuals","audio","edit","review","release"]);

export class ProductionGraph {
  constructor(){this.nodes=new Map();this.edges=[];}

  addNode(node={}) {
    if(node.stage&&!STAGES.includes(node.stage)) throw new Error("Unknown production stage: "+node.stage);
    const n={id:node.id??crypto.randomUUID(),stage:node.stage??"concept",status:node.status??"queued",...node,updatedAt:new Date().toISOString()};
    this.nodes.set(n.id,n);
    return n;
  }

  connect(from,to,type="depends_on"){
    if(!this.nodes.has(from)||!this.nodes.has(to)) throw new Error("Production node not found");
    const edge={id:crypto.randomUUID(),from,to,type};
    this.edges.push(edge);
    return edge;
  }

  advance(id,status="ready"){
    const n=this.nodes.get(id);if(!n)throw new Error("Production node not found");
    n.status=status;n.updatedAt=new Date().toISOString();return n;
  }

  ready(stage){
    if(!STAGES.includes(stage)) throw new Error("Unknown production stage: "+stage);
    return [...this.nodes.values()].filter(n=>n.stage===stage&&["queued","ready"].includes(n.status));
  }

  snapshot(){return {nodes:[...this.nodes.values()],edges:structuredClone(this.edges)};}
  restore(snapshot={}){this.nodes.clear();this.edges=structuredClone(snapshot.edges??[]);for(const n of snapshot.nodes??[])this.nodes.set(n.id,n);return this;}
}
