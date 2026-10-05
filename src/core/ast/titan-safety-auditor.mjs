import ts from "typescript";
import path from "node:path";

export class TitanSafetyAuditor {
  constructor(workspaceRoot = process.cwd()) { this.workspaceRoot = path.resolve(workspaceRoot); }
  verifyPayloadSafety(targetFilePath, currentFileContent, payloadStatements) {
    if (typeof currentFileContent !== "string" || typeof payloadStatements !== "string") throw new TypeError("Titan payload inputs must be strings.");
    const relative = path.relative(this.workspaceRoot, path.resolve(this.workspaceRoot, targetFilePath));
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("AST_TARGET_OUTSIDE_WORKSPACE");
    const fileName = path.resolve(this.workspaceRoot, relative);
    const sourceText = currentFileContent + "\n// TITAN INJECTION\n" + payloadStatements;
    const options = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, noEmit: true, skipLibCheck: true };
    const source = ts.createSourceFile(fileName, sourceText, options.target, true);
    const syntactic = source.parseDiagnostics || [];
    if (syntactic.length) throw this.error("AST_PARSE_FAILURE", syntactic);
    const host = ts.createCompilerHost(options);
    const originalRead = host.readFile.bind(host);
    host.fileExists = f => path.resolve(f) === fileName || originalRead(f) !== undefined;
    host.readFile = f => path.resolve(f) === fileName ? sourceText : originalRead(f);
    host.getSourceFile = (f, languageVersion) => path.resolve(f) === fileName ? source : ts.createSourceFile(f, originalRead(f) || "", languageVersion, true);
    const program = ts.createProgram([fileName], options, host);
    const diagnostics = [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)];
    if (diagnostics.length) throw this.error("AST_CORRUPTION_DETECTED", diagnostics);
    return sourceText;
  }
  error(prefix, diagnostics) {
    const detail = ts.flattenDiagnosticMessageText(diagnostics.map(d => d.messageText).join(" | "), " ");
    return new Error(prefix + ": " + detail.slice(0, 4000));
  }
}
