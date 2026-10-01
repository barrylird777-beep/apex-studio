import crypto from "node:crypto";
export class LocalAuth {
 constructor(){this.users=new Map();this.sessions=new Map();}
 createUser(username,role="owner"){const id=crypto.randomUUID();const user={id,username,role,createdAt:new Date().toISOString()};this.users.set(id,user);return user;}
 createSession(userId){if(!this.users.has(userId))throw new Error("User not found");const token=crypto.randomBytes(32).toString("hex");this.sessions.set(token,{userId,createdAt:new Date().toISOString()});return token;}
 verify(token){const s=this.sessions.get(token);return s?this.users.get(s.userId)??null:null;}
 revoke(token){return this.sessions.delete(token);}
}