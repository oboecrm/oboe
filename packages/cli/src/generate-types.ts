import path from "node:path";
import {
  type CompiledCollection,
  type CompiledSchema,
  compileSchema,
  type FieldConfig,
  type OboeConfig,
  resolveConfig,
  type SelectFieldOption,
} from "@oboe/core";

function toPascalCase(value: string) {
  return value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
    .join("");
}

function documentTypeName(slug: string) {
  return `${toPascalCase(slug)}Document`;
}

function inputTypeName(slug: string) {
  return `${toPascalCase(slug)}Input`;
}

function updateInputTypeName(slug: string) {
  return `${toPascalCase(slug)}UpdateInput`;
}

function propertyName(name: string) {
  return /^[$A-Z_a-z][$\w]*$/.test(name) ? name : JSON.stringify(name);
}

function relationType(field: FieldConfig) {
  if (!field.relationTo) {
    return "string";
  }

  return `string | ${documentTypeName(field.relationTo)}`;
}

function selectType(options?: SelectFieldOption[]) {
  if (!options || options.length === 0) {
    return "string";
  }

  return options.map((option) => JSON.stringify(option.value)).join(" | ");
}

function fieldType(field: FieldConfig) {
  switch (field.type) {
    case "boolean":
      return "boolean";
    case "date":
    case "email":
    case "text":
    case "textarea":
      return "string";
    case "json":
      return "unknown";
    case "number":
      return "number";
    case "relation":
    case "relationship":
      return relationType(field);
    case "select":
      return selectType(field.options);
    default:
      return "unknown";
  }
}

function lineForField(field: FieldConfig, typeName: string) {
  return `  ${propertyName(field.name)}${field.required ? "" : "?"}: ${typeName};`;
}

function documentFieldLines(collection: CompiledCollection) {
  return [
    "  id: string;",
    "  createdAt: string;",
    "  updatedAt: string;",
    ...collection.fields.map((field) =>
      lineForField(
        field,
        collection.upload && field.name === "file"
          ? "StoredFileData"
          : fieldType(field)
      )
    ),
  ];
}

function inputFieldLines(collection: CompiledCollection) {
  return collection.fields
    .filter((field) => !(collection.upload && field.name === "file"))
    .map((field) => lineForField(field, fieldType(field)));
}

function renderInterface(name: string, lines: string[]) {
  if (lines.length === 0) {
    return `export interface ${name} {}\n`;
  }

  return `${[`export interface ${name} {`, ...lines, `}`].join("\n")}\n`;
}

function renderCollections(schema: CompiledSchema) {
  return [...schema.collections.values()]
    .map((collection) => {
      const inputName = inputTypeName(collection.slug);
      const updateName = updateInputTypeName(collection.slug);

      return [
        renderInterface(
          documentTypeName(collection.slug),
          documentFieldLines(collection)
        ),
        renderInterface(inputName, inputFieldLines(collection)),
        `export type ${updateName} = Partial<${inputName}>;\n`,
      ].join("\n");
    })
    .join("\n");
}

function renderGlobals(schema: CompiledSchema) {
  return [...schema.globals.values()]
    .map((global) => {
      const baseName = toPascalCase(global.slug);
      const documentName = `${baseName}Global`;
      const updateName = `${baseName}GlobalInput`;
      const documentLines = [
        "  createdAt: string;",
        "  updatedAt: string;",
        ...global.fields.map((field) => lineForField(field, fieldType(field))),
      ];
      const updateLines = global.fields.map(
        (field) => `  ${propertyName(field.name)}?: ${fieldType(field)};`
      );

      return [
        renderInterface(documentName, documentLines),
        renderInterface(updateName, updateLines),
      ].join("\n");
    })
    .join("\n");
}

function taskInputTypeName(slug: string) {
  return `${toPascalCase(slug)}TaskInput`;
}

function taskOutputTypeName(slug: string) {
  return `${toPascalCase(slug)}TaskOutput`;
}

function renderTasks(config: OboeConfig) {
  return (config.jobs?.tasks ?? [])
    .map((task) => {
      const inputLines = (task.inputSchema ?? []).map((field) =>
        lineForField(field, fieldType(field))
      );
      const outputLines = (task.outputSchema ?? []).map((field) =>
        lineForField(field, fieldType(field))
      );

      return [
        renderInterface(taskInputTypeName(task.slug), inputLines),
        renderInterface(taskOutputTypeName(task.slug), outputLines),
      ].join("\n");
    })
    .join("\n");
}

function renderMaps(schema: CompiledSchema) {
  const collectionLines = [...schema.collections.keys()].map(
    (slug) => `  ${propertyName(slug)}: ${documentTypeName(slug)};`
  );
  const collectionInputLines = [...schema.collections.keys()].map(
    (slug) => `  ${propertyName(slug)}: ${inputTypeName(slug)};`
  );
  const globalLines = [...schema.globals.keys()].map(
    (slug) => `  ${propertyName(slug)}: ${toPascalCase(slug)}Global;`
  );
  const globalInputLines = [...schema.globals.keys()].map(
    (slug) => `  ${propertyName(slug)}: ${toPascalCase(slug)}GlobalInput;`
  );
  const taskInputLines = (schema.config.jobs?.tasks ?? []).map(
    (task) => `  ${propertyName(task.slug)}: ${taskInputTypeName(task.slug)};`
  );
  const taskOutputLines = (schema.config.jobs?.tasks ?? []).map(
    (task) => `  ${propertyName(task.slug)}: ${taskOutputTypeName(task.slug)};`
  );

  const globalsDefinition =
    schema.globals.size === 0
      ? "export type Globals = Record<string, never>;\n"
      : renderInterface("Globals", globalLines);
  const globalInputsDefinition =
    schema.globals.size === 0
      ? "export type GlobalInputs = Record<string, never>;\n"
      : renderInterface("GlobalInputs", globalInputLines);

  return [
    renderInterface("Collections", collectionLines),
    renderInterface("CollectionInputs", collectionInputLines),
    globalsDefinition,
    globalInputsDefinition,
    taskInputLines.length === 0
      ? "export type TaskInputs = Record<string, never>;\n"
      : renderInterface("TaskInputs", taskInputLines),
    taskOutputLines.length === 0
      ? "export type TaskOutputs = Record<string, never>;\n"
      : renderInterface("TaskOutputs", taskOutputLines),
  ].join("\n");
}

export function resolveTypesOutputPath(args: {
  config: OboeConfig;
  configPath: string;
}) {
  const resolved = resolveConfig(args.config);
  const outputFile =
    resolved.typescript?.outputFile ?? "./oboe-types.generated.ts";

  return path.resolve(path.dirname(args.configPath), outputFile);
}

export function generateTypesSource(config: OboeConfig) {
  const resolved = resolveConfig(config);
  const schema = compileSchema(resolved);
  const sections = [
    "// This file is auto-generated by `oboe generate:types`.",
    'import type { StoredFileData } from "@oboe/core";',
    renderCollections(schema),
    renderGlobals(schema),
    renderTasks(resolved),
    renderMaps(schema),
  ];

  if (resolved.typescript?.declare !== false) {
    sections.push(
      [
        'declare module "@oboe/core" {',
        "  interface GeneratedTypes {",
        "    collections: Collections;",
        "    collectionInputs: CollectionInputs;",
        "    globals: Globals;",
        "    globalInputs: GlobalInputs;",
        "    taskInputs: TaskInputs;",
        "    taskOutputs: TaskOutputs;",
        "  }",
        "}",
      ].join("\n")
    );
  }

  return `${sections
    .filter(Boolean)
    .map((section) => section.trimEnd())
    .join("\n\n")}\n`;
}
