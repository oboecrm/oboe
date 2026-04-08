import fs from "node:fs";
import path from "node:path";
import type tsModule from "typescript/lib/tsserverlibrary";

type TypeScriptModule = typeof tsModule;

interface PluginConfig {
  baseDir?: string;
}

interface ComponentReference {
  exportName?: string;
  path: string;
  sourceNode: tsModule.Node;
}

const LEGACY_COMPONENT_CODE = 81001;
const MISSING_EXPORT_CODE = 81002;
const UNRESOLVED_COMPONENT_CODE = 81003;
const SUPPORTED_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];

function init(modules: { typescript: TypeScriptModule }) {
  const ts = modules.typescript;

  function getPropertyName(name: tsModule.PropertyName) {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
      return name.text;
    }

    return null;
  }

  function findConfigBaseDir(
    fileName: string,
    config: PluginConfig,
    projectDir: string
  ) {
    if (config.baseDir) {
      return path.resolve(projectDir, config.baseDir);
    }

    let current = path.dirname(fileName);

    while (true) {
      if (fs.existsSync(path.join(current, "oboe.config.ts"))) {
        return current;
      }

      const parent = path.dirname(current);
      if (parent === current) {
        return projectDir;
      }
      current = parent;
    }
  }

  function tryResolveAbsolutePath(candidate: string) {
    for (const extension of SUPPORTED_EXTENSIONS) {
      if (fs.existsSync(`${candidate}${extension}`)) {
        return `${candidate}${extension}`;
      }
    }

    for (const extension of SUPPORTED_EXTENSIONS) {
      const indexPath = path.join(candidate, `index${extension}`);
      if (fs.existsSync(indexPath)) {
        return indexPath;
      }
    }

    return fs.existsSync(candidate) ? candidate : null;
  }

  function resolveReferencePath(args: {
    baseDir: string;
    compilerOptions: tsModule.CompilerOptions;
    containingFile: string;
    referencePath: string;
  }) {
    const { baseDir, compilerOptions, containingFile, referencePath } = args;

    if (referencePath.startsWith("/")) {
      return tryResolveAbsolutePath(path.resolve(baseDir, `.${referencePath}`));
    }

    if (referencePath.startsWith("./")) {
      return tryResolveAbsolutePath(path.resolve(baseDir, referencePath));
    }

    const resolved = ts.resolveModuleName(
      referencePath,
      containingFile,
      compilerOptions,
      ts.sys
    ).resolvedModule;

    return resolved?.resolvedFileName ?? null;
  }

  function readObjectReference(node: tsModule.ObjectLiteralExpression) {
    let exportName: string | undefined;
    let referencePath: string | undefined;

    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) {
        continue;
      }

      const name = getPropertyName(property.name);
      if (!name || !ts.isStringLiteralLike(property.initializer)) {
        continue;
      }

      if (name === "path") {
        referencePath = property.initializer.text;
      }

      if (name === "exportName") {
        exportName = property.initializer.text;
      }
    }

    if (!referencePath) {
      return null;
    }

    return {
      exportName,
      path: referencePath,
      sourceNode: node,
    } satisfies ComponentReference;
  }

  function readReference(node: tsModule.Expression): ComponentReference | null {
    if (ts.isStringLiteralLike(node)) {
      const [referencePath, exportName] = node.text.split("#");

      return {
        exportName,
        path: referencePath,
        sourceNode: node,
      };
    }

    if (ts.isObjectLiteralExpression(node)) {
      return readObjectReference(node);
    }

    return null;
  }

  function isLegacyReference(referencePath: string) {
    return (
      !referencePath.startsWith("/") &&
      !referencePath.startsWith("./") &&
      !referencePath.startsWith("@")
    );
  }

  function createDiagnostic(
    file: tsModule.SourceFile,
    node: tsModule.Node,
    category: tsModule.DiagnosticCategory,
    code: number,
    messageText: string
  ): tsModule.Diagnostic {
    return {
      category,
      code,
      file,
      length: node.getWidth(),
      messageText,
      start: node.getStart(),
    };
  }

  function getModuleExports(
    checker: tsModule.TypeChecker,
    sourceFile: tsModule.SourceFile
  ) {
    const symbol = checker.getSymbolAtLocation(sourceFile);

    if (!symbol) {
      return [];
    }

    return checker.getExportsOfModule(symbol);
  }

  function validateReference(args: {
    baseDir: string;
    checker: tsModule.TypeChecker;
    compilerOptions: tsModule.CompilerOptions;
    file: tsModule.SourceFile;
    program: tsModule.Program;
    reference: ComponentReference;
  }) {
    const { baseDir, checker, compilerOptions, file, program, reference } =
      args;

    if (isLegacyReference(reference.path)) {
      return [
        createDiagnostic(
          file,
          reference.sourceNode,
          ts.DiagnosticCategory.Warning,
          LEGACY_COMPONENT_CODE,
          `Legacy component reference "${reference.path}" is deprecated. Use a Payload-style path such as "@/components/Foo#Bar".`
        ),
      ];
    }

    const resolvedPath = resolveReferencePath({
      baseDir,
      compilerOptions,
      containingFile: file.fileName,
      referencePath: reference.path,
    });

    if (!resolvedPath) {
      return [
        createDiagnostic(
          file,
          reference.sourceNode,
          ts.DiagnosticCategory.Error,
          UNRESOLVED_COMPONENT_CODE,
          `Component path "${reference.path}" does not resolve to a file.`
        ),
      ];
    }

    if (!reference.exportName) {
      return [];
    }

    const sourceFile = program.getSourceFile(resolvedPath);

    if (!sourceFile) {
      return [];
    }

    const exports = getModuleExports(checker, sourceFile).map((entry) =>
      String(entry.escapedName)
    );

    if (exports.includes(reference.exportName)) {
      return [];
    }

    return [
      createDiagnostic(
        file,
        reference.sourceNode,
        ts.DiagnosticCategory.Error,
        MISSING_EXPORT_CODE,
        `Component export "${reference.exportName}" was not found in "${reference.path}".`
      ),
    ];
  }

  function collectDiagnostics(args: {
    checker: tsModule.TypeChecker;
    config: PluginConfig;
    file: tsModule.SourceFile;
    program: tsModule.Program;
    projectDir: string;
  }) {
    const diagnostics: tsModule.Diagnostic[] = [];
    const baseDir = findConfigBaseDir(
      args.file.fileName,
      args.config,
      args.projectDir
    );
    const compilerOptions = args.program.getCompilerOptions();

    function validateExpression(node: tsModule.Expression) {
      const reference = readReference(node);

      if (!reference) {
        return;
      }

      diagnostics.push(
        ...validateReference({
          baseDir,
          checker: args.checker,
          compilerOptions,
          file: args.file,
          program: args.program,
          reference,
        })
      );
    }

    function visit(node: tsModule.Node) {
      if (ts.isPropertyAssignment(node)) {
        const name = getPropertyName(node.name);

        if (name === "component") {
          validateExpression(node.initializer);
        }

        if (
          name === "components" &&
          ts.isObjectLiteralExpression(node.initializer)
        ) {
          for (const property of node.initializer.properties) {
            if (ts.isPropertyAssignment(property)) {
              validateExpression(property.initializer);
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(args.file);

    return diagnostics;
  }

  return {
    create(info: tsModule.server.PluginCreateInfo) {
      const pluginConfig = (info.config ?? {}) as PluginConfig;
      const proxy = new Proxy(info.languageService, {
        get(target, property, receiver) {
          if (property === "getSemanticDiagnostics") {
            return (fileName: string) => {
              const diagnostics = target.getSemanticDiagnostics(fileName);
              const program = target.getProgram();
              const sourceFile = program?.getSourceFile(fileName);

              if (!program || !sourceFile) {
                return diagnostics;
              }

              return diagnostics.concat(
                collectDiagnostics({
                  checker: program.getTypeChecker(),
                  config: pluginConfig,
                  file: sourceFile,
                  program,
                  projectDir: info.project.getCurrentDirectory(),
                })
              );
            };
          }

          return Reflect.get(target, property, receiver);
        },
      }) as tsModule.LanguageService;

      return proxy;
    },
  };
}

export = init;
