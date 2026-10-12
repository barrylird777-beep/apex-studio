import { uid, now } from "../core/id.mjs";
export class SessionManager {
 constructor(){this.sessions=new Map();}
 create(input={}){const s={id:uid("sess"),projectId:input.projectId??null,userId:input.userId??"local",createdAt:now(),updatedAt:now(),context:input.context??{}};this.sessions.set(s.id,s);return s;}
 get(id){return this.sessions.get(id)??null;}
 touch(id,patch={}){const s=this.get(id);if(!s)throw new Error("Session not found");Object.assign(s,patch,{updatedAt:now()});return s;}
 list(){return [...this.sessions.values()];}
}
