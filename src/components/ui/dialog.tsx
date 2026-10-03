import * as React from "react";
export function Dialog({open,onOpenChange,children}:{open?:boolean;onOpenChange?:(open:boolean)=>void;children:React.ReactNode}){return <>{children}</>}
export const DialogTrigger=({children}:{asChild?:boolean;children:React.ReactNode})=><>{children}</>;
export function DialogContent({children}:{children:React.ReactNode}){return <>{children}</>}
export const DialogHeader=({children}:{children:React.ReactNode})=><div>{children}</div>;
export const DialogTitle=({children}:{children:React.ReactNode})=><h2>{children}</h2>;