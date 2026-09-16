#!/usr/bin/env node
/**
 * engine-contract.mjs
 *
 * Reads the boundary of src/engine out of the TypeScript source and writes it
 * to tests/conformance/contract/inventory.json. The Rust port is measured
 * against that file: a name the application imports from the engine is a name
 * the Rust adapter has to answer for, and a variant of an operation, an object
 * type, a value or a persisted AST is a case the Rust implementation has to
 * cover.
 *
 * The inventory is generated rather than written by hand, because a list of
 * four hundred names copied into a document goes stale the first time somebody
 * adds an export. The one part a person writes is the disposition of each
 * imported name, in dispositions.json beside it, which says what the Rust
 * boundary does with that name. The two files meet here: an export that no
 * production file imports takes a disposition from its shape, and an export
 * that one does imports its disposition from the hand written file.
 *
 *   node tools/engine-contract.mjs            # rewrites the inventory
 *   node tools/engine-contract.mjs --check    # compares, and fails on drift
 *
 * The --inventory and --dispositions options move either file somewhere else,
 * which is how the test drives the check against a copy that has been spoiled
 * on purpose without touching the committed pair.
 *
 * The check gives exit code 1 when the committed inventory disagrees with the
 * source, when an imported name has no disposition, or when a disposition
 * names an export that is gone. Each of those three is a change to the
 * boundary the port froze, so the port register reads the difference before
 * the change lands rather than after.
 *
 * Tooling code that runs under Node outside the application, so it reads the
 * TypeScript compiler directly and has no part in the browser bundle.
 */

import ts from "typescript";
import assert from "node:assert";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const ENGINE_PREFIX = "src/engine/";

const BARREL = "src/engine/index.ts";

const INVENTORY_PATH = "tests/conformance/contract/inventory.json";

const DISPOSITIONS_PATH = "tests/conformance/contract/dispositions.json";

/**
 * What the Rust boundary does with one engine export. A name carries exactly
 * one of these, and the port register holds the reason each family exists.
 *
 * core-operation      Rust owns it, and it changes or evaluates graph state.
 * host-query          Rust answers it, and it reads document state without
 *                     changing anything.
 * descriptor          Rust supplies it as plain data that no document state
 *                     enters, such as a slot path, a default or a limit.
 * type                A declaration with no runtime value of its own.
 * compatibility-helper A name that exists to bridge the two engines, and that
 *                     goes when the older one does.
 * unused-export       The barrel carries it and no production file imports it.
 *
 * The line between a query and a descriptor is whether an object reaches the
 * call. findSlotFormat takes a type and a path and reads a fixed table, so it
 * is a descriptor. resolveDerivedSlots takes an object, so it is a query, and
 * a Rust adapter has to carry that object across the boundary to answer it.
 */
const DISPOSITIONS = new Set([
  "core-operation",
  "host-query",
  "descriptor",
  "type",
  "compatibility-helper",
  "unused-export",
]);

/**
 * The type aliases whose members the port covers case by case. Each one is a
 * union, and the Rust implementation needs a branch for every member of it,
 * so the inventory records the members and a later package compares its own
 * coverage against them.
 */
const VARIANT_UNIONS = [
  "ObjectType",
  "ErrorCode",
  "Value",
  "Slot",
  "Operation",
  "FormulaAst",
  "BinaryOperator",
  "UnaryOperator",
  "MathAst",
  "MathLine",
  "MathBinaryOperator",
];

function toRelative(fileName) {
  return relative(ROOT, fileName).split("\\").join("/");
}

function createProgram() {
  const configPath = resolve(ROOT, "tsconfig.json");
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, "\n"));
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, ROOT);
  return ts.createProgram(parsed.fileNames, parsed.options);
}

/** The declaration form of a symbol, as one word for the inventory to carry. */
function declarationKind(symbol) {
  const declaration = symbol.declarations?.[0];
  if (declaration === undefined) {
    return "unknown";
  }
  switch (declaration.kind) {
    case ts.SyntaxKind.FunctionDeclaration:
      return "function";
    case ts.SyntaxKind.VariableDeclaration:
      return "variable";
    case ts.SyntaxKind.InterfaceDeclaration:
      return "interface";
    case ts.SyntaxKind.TypeAliasDeclaration:
      return "type-alias";
    case ts.SyntaxKind.ClassDeclaration:
      return "class";
    case ts.SyntaxKind.EnumDeclaration:
      return "enum";
    default:
      return ts.SyntaxKind[declaration.kind];
  }
}

/**
 * Every name the barrel passes outward, resolved back to the file and the
 * spelling that declares it. Two engine files both declare a function called
 * evaluate, and the barrel renames them to evaluateGraph and
 * evaluateFormulaAst, so the outward name and the declared name are recorded
 * separately and neither one hides the other.
 *
 * The second list holds any export of an engine file that the barrel leaves
 * behind. A name there is outside the boundary the port measures, so it is
 * recorded rather than dropped.
 */
function collectSurface(program, checker) {
  const declared = new Map();
  for (const file of program.getSourceFiles()) {
    const path = toRelative(file.fileName);
    if (!path.startsWith(ENGINE_PREFIX) || path.endsWith(".test.ts") || path === BARREL) {
      continue;
    }
    const moduleSymbol = checker.getSymbolAtLocation(file);
    if (moduleSymbol === undefined) {
      continue;
    }
    for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
      const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      const declaredIn = toRelative(resolved.declarations?.[0]?.getSourceFile().fileName ?? file.fileName);
      if (!declaredIn.startsWith(ENGINE_PREFIX)) {
        continue;
      }
      declared.set(`${declaredIn}#${resolved.getName()}`, {
        declaredAs: resolved.getName(),
        file: declaredIn,
        runtime: (resolved.flags & ts.SymbolFlags.Value) !== 0,
        declaration: declarationKind(resolved),
      });
    }
  }

  const barrelFile = program.getSourceFiles().find((candidate) => toRelative(candidate.fileName) === BARREL);
  assert.ok(barrelFile !== undefined, `${BARREL} is not in the program`);
  const barrelSymbol = checker.getSymbolAtLocation(barrelFile);
  assert.ok(barrelSymbol !== undefined, `${BARREL} has no module symbol`);

  const surface = [];
  const reached = new Set();
  for (const symbol of checker.getExportsOfModule(barrelSymbol)) {
    const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    const declaredIn = toRelative(resolved.declarations?.[0]?.getSourceFile().fileName ?? BARREL);
    const key = `${declaredIn}#${resolved.getName()}`;
    reached.add(key);
    surface.push({
      name: symbol.getName(),
      declaredAs: resolved.getName(),
      file: declaredIn,
      runtime: (resolved.flags & ts.SymbolFlags.Value) !== 0,
      declaration: declarationKind(resolved),
    });
  }

  const notInBarrel = [...declared.entries()]
    .filter(([key]) => !reached.has(key))
    .map(([, entry]) => ({ name: entry.declaredAs, file: entry.file }))
    .sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name));

  return {
    surface: surface.sort((a, b) => a.name.localeCompare(b.name)),
    notInBarrel,
  };
}

/**
 * Where an import statement points, as a repository path. The specifier of an
 * engine import carries the .ts suffix the bundler config allows, so resolving
 * it against the importing directory is enough and no module resolver runs.
 */
function importTarget(sourceFile, specifier) {
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  return toRelative(resolve(dirname(sourceFile.fileName), specifier));
}

/**
 * Every engine name that a production file imports, with the file that imports
 * it. A test file is left out, because a test reaches for internals that the
 * application never touches and the port boundary follows the application.
 */
function collectConsumers(program) {
  const consumers = [];
  for (const file of program.getSourceFiles()) {
    const path = toRelative(file.fileName);
    if (!path.startsWith("src/") || path.startsWith(ENGINE_PREFIX) || path.endsWith(".test.ts")) {
      continue;
    }
    const names = [];
    const typeOnly = [];
    let namespaceImport = false;
    for (const statement of file.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
        continue;
      }
      if (importTarget(file, statement.moduleSpecifier.text) !== BARREL) {
        continue;
      }
      const clause = statement.importClause;
      if (clause === undefined) {
        continue;
      }
      const bindings = clause.namedBindings;
      if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
        namespaceImport = true;
        continue;
      }
      if (bindings === undefined || !ts.isNamedImports(bindings)) {
        continue;
      }
      for (const element of bindings.elements) {
        const imported = (element.propertyName ?? element.name).text;
        names.push(imported);
        if (clause.isTypeOnly || element.isTypeOnly) {
          typeOnly.push(imported);
        }
      }
    }
    if (names.length === 0 && !namespaceImport) {
      continue;
    }
    consumers.push({
      file: path,
      namespaceImport,
      names: [...new Set(names)].sort((a, b) => a.localeCompare(b)),
      typeOnly: [...new Set(typeOnly)].sort((a, b) => a.localeCompare(b)),
    });
  }
  return consumers.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * The members of one union type. A member that carries a string literal under
 * kind or type is recorded by that literal, and so is a member that is a
 * string literal itself, because that literal is the tag a Rust enum and a
 * JSON document both use. Any other member is recorded by the text of its
 * type, which is how the shape of a value variant reaches the file.
 *
 * The true and false members collapse back into boolean. TypeScript splits
 * boolean into its two literals inside a union, and a Rust port has one
 * boolean branch rather than two.
 */
function unionMembers(type, checker) {
  const constituents = type.isUnion() ? type.types : [type];
  const members = constituents.map((constituent) => {
    if (constituent.isStringLiteral()) {
      return constituent.value;
    }
    for (const tag of ["kind", "type"]) {
      const property = constituent.getProperty(tag);
      if (property === undefined) {
        continue;
      }
      const propertyType = checker.getTypeOfSymbol(property);
      if (propertyType.isStringLiteral()) {
        return propertyType.value;
      }
    }
    return checker.typeToString(constituent);
  });
  const unique = new Set(members);
  if (unique.has("true") && unique.has("false")) {
    unique.delete("true");
    unique.delete("false");
    unique.add("boolean");
  }
  return [...unique].sort((a, b) => a.localeCompare(b));
}

function collectVariants(program, checker) {
  const aliases = new Map();
  for (const file of program.getSourceFiles()) {
    const path = toRelative(file.fileName);
    if (!path.startsWith(ENGINE_PREFIX) || path.endsWith(".test.ts")) {
      continue;
    }
    for (const statement of file.statements) {
      if (ts.isTypeAliasDeclaration(statement) && VARIANT_UNIONS.includes(statement.name.text)) {
        aliases.set(statement.name.text, statement);
      }
    }
  }
  const variants = {};
  for (const name of VARIANT_UNIONS) {
    const declaration = aliases.get(name);
    assert.ok(declaration !== undefined, `the union ${name} is no longer declared in the engine`);
    variants[name] = unionMembers(checker.getTypeAtLocation(declaration.name), checker);
  }
  return variants;
}

/** Each engine source file, and whether a test file sits beside it. */
function collectModules(program) {
  const sources = [];
  const tests = new Set();
  for (const file of program.getSourceFiles()) {
    const path = toRelative(file.fileName);
    if (!path.startsWith(ENGINE_PREFIX)) {
      continue;
    }
    if (path.endsWith(".test.ts")) {
      tests.add(path.replace(/\.test\.ts$/, ".ts"));
    } else {
      sources.push(path);
    }
  }
  return sources
    .sort((a, b) => a.localeCompare(b))
    .map((path) => ({ file: path, hasTest: tests.has(path) }));
}

/** The value of a --name=value option, or the default where it is absent. */
function option(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((argument) => argument.startsWith(prefix));
  return found === undefined ? fallback : found.slice(prefix.length);
}

function readDispositions(path) {
  const raw = JSON.parse(readFileSync(resolve(ROOT, path), "utf8"));
  return raw.dispositions ?? {};
}

/**
 * Builds the whole inventory. Every export takes a disposition: a hand written
 * one where a production file imports the name, and otherwise one its shape
 * decides, which is type for a declaration with no runtime value and
 * unused-export for the rest.
 */
function buildInventory(dispositions) {
  const program = createProgram();
  const checker = program.getTypeChecker();
  const { surface, notInBarrel } = collectSurface(program, checker);
  const consumers = collectConsumers(program);
  const consumed = new Set(consumers.flatMap((consumer) => consumer.names));

  const classified = surface.map((entry) => ({
    ...entry,
    consumed: consumed.has(entry.name),
    disposition:
      dispositions[entry.name] ?? (consumed.has(entry.name) ? "missing" : entry.runtime ? "unused-export" : "type"),
  }));

  return {
    note: "Generated by tools/engine-contract.mjs. Edit dispositions.json, never this file.",
    barrelModule: BARREL,
    counts: {
      exports: classified.length,
      runtimeExports: classified.filter((entry) => entry.runtime).length,
      consumerFiles: consumers.length,
      consumedNames: consumed.size,
      notInBarrel: notInBarrel.length,
    },
    modules: collectModules(program),
    variants: collectVariants(program, checker),
    notInBarrel,
    exports: classified,
    consumers,
  };
}

/**
 * The faults that make the committed inventory untrue: a consumed name with no
 * disposition, a disposition for a name the engine no longer exports, a
 * disposition outside the list, and a name whose hand written disposition
 * disagrees with the shape it has.
 */
function checkDispositions(inventory, dispositions) {
  const problems = [];
  const known = new Map(inventory.exports.map((entry) => [entry.name, entry]));
  for (const entry of inventory.exports) {
    if (entry.disposition === "missing") {
      problems.push(`"${entry.name}" is imported by a production file and has no disposition`);
    }
  }
  for (const [name, disposition] of Object.entries(dispositions)) {
    if (!DISPOSITIONS.has(disposition)) {
      problems.push(`"${name}" has the disposition "${disposition}", which is not one of the six`);
      continue;
    }
    const entry = known.get(name);
    if (entry === undefined) {
      problems.push(`"${name}" has a disposition and the engine no longer exports it`);
      continue;
    }
    if (!entry.consumed) {
      problems.push(`"${name}" has a hand written disposition and no production file imports it`);
    }
    if (disposition === "type" && entry.runtime) {
      problems.push(`"${name}" is recorded as a type and has a runtime value`);
    }
    if (disposition !== "type" && !entry.runtime) {
      problems.push(`"${name}" has no runtime value and is recorded as "${disposition}"`);
    }
  }
  return problems;
}

/** The first place two JSON values differ, as a path a reader can follow. */
function firstDifference(expected, actual, path = "") {
  if (JSON.stringify(expected) === JSON.stringify(actual)) {
    return undefined;
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const length = Math.max(expected.length, actual.length);
    for (let index = 0; index < length; index += 1) {
      const difference = firstDifference(expected[index], actual[index], `${path}[${index}]`);
      if (difference !== undefined) {
        return difference;
      }
    }
  }
  if (expected !== null && actual !== null && typeof expected === "object" && typeof actual === "object" && !Array.isArray(expected) && !Array.isArray(actual)) {
    for (const key of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) {
      const difference = firstDifference(expected[key], actual[key], path === "" ? key : `${path}.${key}`);
      if (difference !== undefined) {
        return difference;
      }
    }
  }
  return { path: path === "" ? "(root)" : path, expected, actual };
}

function serialize(inventory) {
  return `${JSON.stringify(inventory, null, 2)}\n`;
}

function main() {
  const check = process.argv.includes("--check");
  const inventoryPath = option("inventory", INVENTORY_PATH);
  const dispositionsPath = option("dispositions", DISPOSITIONS_PATH);
  const dispositions = readDispositions(dispositionsPath);
  const inventory = buildInventory(dispositions);
  const problems = checkDispositions(inventory, dispositions);
  const target = resolve(ROOT, inventoryPath);

  if (!check) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, serialize(inventory));
    console.log(`wrote ${inventoryPath}: ${inventory.counts.exports} exports, ${inventory.counts.consumedNames} of them imported by ${inventory.counts.consumerFiles} production files`);
    for (const problem of problems) {
      console.error(`  ${problem}`);
    }
    process.exit(problems.length === 0 ? 0 : 1);
  }

  let committed;
  try {
    committed = JSON.parse(readFileSync(target, "utf8"));
  } catch (error) {
    console.error(`${inventoryPath}: cannot read. ${error.message}`);
    process.exit(1);
  }
  const difference = firstDifference(committed, inventory);
  if (difference !== undefined) {
    console.error(`${inventoryPath} disagrees with the source at ${difference.path}`);
    console.error(`  committed: ${JSON.stringify(difference.expected)?.slice(0, 200)}`);
    console.error(`  source:    ${JSON.stringify(difference.actual)?.slice(0, 200)}`);
    console.error("  Run node tools/engine-contract.mjs to rewrite it.");
  }
  for (const problem of problems) {
    console.error(`  ${problem}`);
  }
  process.exit(difference === undefined && problems.length === 0 ? 0 : 1);
}

main();
