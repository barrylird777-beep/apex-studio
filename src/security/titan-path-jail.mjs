import path from "node:path";

export class TitanPathJail {
  constructor(workspaceRoot=process.cwd()) {
    const root=path.resolve(String(workspaceRoot));
    if(root===path.parse(root).root) throw new Error("TitanPathJail requires a non-root workspace");
    this.rootPath=root;
  }
  enforceStrictBoundary(requestedPath) {
    const requested=String(requestedPath||"");
    if(requested.includes("\0")) throw new Error("SECURITY_BREACH: Null bytes detected in path.");
    const target=path.resolve(this.rootPath,requested);
    const relative=path.relative(this.rootPath,target);
    if(relative===".."||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative)) throw new Error(`SECURITY_BREACH: Path traversal attempted. Target outside bounds: ${requested}`);
    return target;
  }
}
