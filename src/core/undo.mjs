import { uid, now } from "./id.mjs";
export class CommandLog {
 constructor(){this.done=[];this.undone=[];}
 execute(command){const result=command.do();this.done.push({...command,id:uid("cmd"),executedAt:now(),result});this.undone=[];return result;}
 undo(){const command=this.done.pop();if(!command)return null;const result=command.undo?.();this.undone.push(command);return result;}
 redo(){const command=this.undone.pop();if(!command)return null;const result=command.do();this.done.push(command);return result;}
 history(){return this.done.map(({do:_,undo:__,...x})=>x);}
}