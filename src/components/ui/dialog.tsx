import * as React from "react"; const Ctx=React.createContext(false);
export function Dialog({open=false,onOpenChange,children}:{open?:boolean;onOpenChange?:(open:boolean)=>void;children:React.ReactNode}){return <Ctx.Provider value={open}>{children}</Ctx.Provider>}
export const DialogTrigger=({children}:{asChild?:boolean;children:React.ReactNode})=><>{children}</>;
export function DialogContent({children}:{children:React.ReactNode}){const open=React.useContext(Ctx);if(!open)return null;return <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"><div className="w-full max-w-lg">{children}</div></div>}
export const DialogHeader=({children}:{children:React.ReactNode})=><div className="mb-4">{children}</div>;
export const DialogTitle=({children}:{children:React.ReactNode})=><h2 className="text-xl font-semibold">{children}</h2>;