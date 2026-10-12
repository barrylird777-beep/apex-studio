export class CommandRouter {
  constructor(){this.commands=new Map();}
  register(name,handler,meta={}){this.commands.set(name,{name,handler,meta});return this;}
  names(){return [...this.commands.keys()];}
  async dispatch(name,args={}){const command=this.commands.get(name);if(!command)throw new Error("Command not found: "+name);return command.handler(args);}
}
