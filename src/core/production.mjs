export const STAGES=["concept","research","outline","script","storyboard","visuals","audio","edit","review","release"];
export class ProductionGraph {
  constructor(){this.nodes=new Map();this.edges=[];}
  addNode(node){const n={id:node.id??crypto.randomUUID(),stage:node.stage??"concept",status:"queued",...node};this.nodes.set(n.id,n);return n;}
  connect(from,to,type="depends_on"){this.edges.push({id:crypto.randomUUID(),from,to,type});}
  advance(id,status="ready"){const n=this.nodes.get(id);if(!n)throw new Error("Production node not found");n.status=status;n.updatedAt=new Date().toISOString();return n;}
  ready(stage){return [...this.nodes.values()].filter(n=>n.stage===stage&&["queued","ready"].includes(n.status));}
}
