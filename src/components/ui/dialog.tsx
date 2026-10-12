import * as React from "react";
export function Dialog({open,onOpenChange,children}:{open?:boolean;onOpenChange?:(open:boolean)=>void;children:React.ReactNode}) {
  return <div data-open={open ? "true" : "false"}>{open ? children : null}</div>;
}
export const DialogTrigger=({children}:{asChild?:boolean;children:React.ReactNode})=><>{children}</>;
export function DialogContent({children}:{children:React.ReactNode}) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
    <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-xl bg-white p-6 shadow-xl">{children}</div>
  </div>;
}
export const DialogHeader=({children}:{children:React.ReactNode})=><div className="mb-4">{children}</div>;
export const DialogTitle=({children}:{children:React.ReactNode})=><h2 className="text-xl font-semibold">{children}</h2>;