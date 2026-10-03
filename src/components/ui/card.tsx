import * as React from "react";
export const Card=({className="",...p}:React.HTMLAttributes<HTMLDivElement>)=><div className={"rounded-xl border bg-white shadow-sm "+className} {...p}/>;
export const CardHeader=({className="",...p}:React.HTMLAttributes<HTMLDivElement>)=><div className={"p-6 pb-3 "+className} {...p}/>;
export const CardContent=({className="",...p}:React.HTMLAttributes<HTMLDivElement>)=><div className={"p-6 pt-3 "+className} {...p}/>;
export const CardTitle=({className="",...p}:React.HTMLAttributes<HTMLHeadingElement>)=><h3 className={"text-lg font-semibold "+className} {...p}/>;