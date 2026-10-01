import { uid, now } from "./id.mjs";
export class KnowledgeBase {
 constructor(){this.documents=new Map();this.chunks=new Map();}
 addDocument(input={}){const d={id:input.id??uid("doc"),title:input.title??"Untitled",sourceId:input.sourceId??null,sourceClass:input.sourceClass??"unclassified",text:input.text??"",metadata:input.metadata??{},createdAt:now()};this.documents.set(d.id,d);return d;}
 chunk(documentId,size=1200){const d=this.documents.get(documentId);if(!d)throw new Error("Document not found");const out=[];for(let i=0;i<d.text.length;i+=size){const c={id:uid("chunk"),documentId,sourceId:d.sourceId,sourceClass:d.sourceClass,index:out.length,text:d.text.slice(i,i+size)};this.chunks.set(c.id,c);out.push(c)}return out;}
 search(q,limit=20){const s=String(q).toLowerCase();return [...this.chunks.values()].filter(c=>c.text.toLowerCase().includes(s)).slice(0,limit);}
 list(){return [...this.documents.values()];}
}
