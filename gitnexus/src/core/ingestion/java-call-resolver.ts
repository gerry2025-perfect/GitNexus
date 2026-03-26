/**
 * Java Call Resolver
 *
 * Specialized call resolution for Java files implementing 6 precise call types:
 * 1. this - Current class method call (confidence: 0.9)
 * 2. static - Static method call (confidence: 0.95)
 * 3. methodInstance - Method-local object call (confidence: 0.95)
 * 4. classInstance - Class field call (confidence: 0.9)
 * 5. super - Parent class method call (confidence: 0.85)
 * 6. interface - Interface method call (confidence: 0.85)
 *
 * Performance: Optimized with O(1) class lookup using GitNexus node ID conventions
 */

import type { KnowledgeGraph } from '../graph/types.js';
import type { SymbolTable, SymbolDefinition } from './symbol-table.js';
import type { ASTCache } from './ast-cache.js';
import type Parser from 'tree-sitter';
import type { ImportMap } from './resolution-context.js';

// ── Edge Index Cache ────────────────────────────────────────────────

/**
 * Edge index for O(1) relationship lookup by sourceId and type.
 * Replaces O(E) Array.from(graph.iterRelationships()).filter(...) pattern.
 */
interface EdgeIndex {
  bySource: Map<string, Array<{ type: string; targetId: string }>>;
}

/**
 * WeakMap cache: graph → EdgeIndex
 * Automatically garbage collected when graph is released.
 */
const edgeIndexCache = new WeakMap<KnowledgeGraph, EdgeIndex>();

/**
 * Track whether edge index has been refreshed for EXTENDS edges for each graph.
 * EXTENDS edges are added by heritage-processor after initial index build,
 * so we need to refresh the cache once when super-call resolution starts.
 */
const edgeIndexRefreshed = new WeakSet<KnowledgeGraph>();

/**
 * Build or retrieve cached edge index for a graph.
 * Cost: O(E) once per graph, then O(1) lookups.
 */
function getEdgeIndex(graph: KnowledgeGraph): EdgeIndex {
  let index = edgeIndexCache.get(graph);
  if (index) return index;

  const start = performance.now();
  const bySource = new Map<string, Array<{ type: string; targetId: string }>>();

  let totalEdges = 0;
  let extendsEdges = 0;
  for (const rel of graph.iterRelationships()) {
    totalEdges++;
    if (rel.type === 'EXTENDS') extendsEdges++;

    if (!bySource.has(rel.sourceId)) {
      bySource.set(rel.sourceId, []);
    }
    bySource.get(rel.sourceId)!.push({ type: rel.type, targetId: rel.targetId });
  }

  index = { bySource };
  edgeIndexCache.set(graph, index);

  const elapsed = performance.now() - start;
  if (process.env.GITNEXUS_DEBUG_JAVA) {
    console.log(`[Java Performance] Edge index built: ${bySource.size} nodes indexed, ${totalEdges} total edges (${extendsEdges} EXTENDS) in ${elapsed.toFixed(0)}ms`);
  }

  return index;
}

// ── Performance Tracking ────────────────────────────────────────────

interface PerformanceStats {
  totalCalls: number;
  resolvedCalls: number;
  unresolvedCalls: number;
  typeBreakdown: {
    methodInstance: { count: number; time: number };
    classInstance: { count: number; time: number };
    static: { count: number; time: number };
    this: { count: number; time: number };
    super: { count: number; time: number };
    interface: { count: number; time: number };
  };
  helperBreakdown: {
    findEnclosingClass: { count: number; time: number };
    findFieldInClass: { count: number; time: number };
    extractLocalVariables: { count: number; time: number };
    findClassByTypeName: { count: number; time: number };
    findMethodInClass: { count: number; time: number };
    traverseInheritance: { count: number; time: number };
  };
}

let perfStats: PerformanceStats | null = null;

export function initJavaResolverStats(): void {
  perfStats = {
    totalCalls: 0,
    resolvedCalls: 0,
    unresolvedCalls: 0,
    typeBreakdown: {
      methodInstance: { count: 0, time: 0 },
      classInstance: { count: 0, time: 0 },
      static: { count: 0, time: 0 },
      this: { count: 0, time: 0 },
      super: { count: 0, time: 0 },
      interface: { count: 0, time: 0 },
    },
    helperBreakdown: {
      findEnclosingClass: { count: 0, time: 0 },
      findFieldInClass: { count: 0, time: 0 },
      extractLocalVariables: { count: 0, time: 0 },
      findClassByTypeName: { count: 0, time: 0 },
      findMethodInClass: { count: 0, time: 0 },
      traverseInheritance: { count: 0, time: 0 },
    },
  };
}

export function getJavaResolverStats(): PerformanceStats | null {
  return perfStats;
}

export function resetJavaResolverStats(): void {
  perfStats = null;
}

export function printJavaResolverStats(): void {
  if (!perfStats) {
    console.log('[Java Performance] Stats not initialized');
    return;
  }

  const totalTime = Object.values(perfStats.typeBreakdown).reduce((sum, t) => sum + t.time, 0);
  const avgPerCall = perfStats.totalCalls > 0 ? totalTime / perfStats.totalCalls : 0;

  console.log('\n' + '='.repeat(80));
  console.log('[Java Performance Breakdown]');
  console.log('='.repeat(80));
  console.log(`  Total calls processed: ${perfStats.totalCalls}`);
  console.log(`  Resolved: ${perfStats.resolvedCalls} (${((perfStats.resolvedCalls / perfStats.totalCalls) * 100).toFixed(1)}%)`);
  console.log(`  Unresolved: ${perfStats.unresolvedCalls} (${((perfStats.unresolvedCalls / perfStats.totalCalls) * 100).toFixed(1)}%)`);
  console.log(`  Total processing time: ${totalTime.toFixed(0)}ms`);
  console.log(`  Avg per call: ${avgPerCall.toFixed(2)}ms`);

  console.log('\n  Resolve Type Breakdown:');
  for (const [type, stats] of Object.entries(perfStats.typeBreakdown)) {
    if (stats.count > 0) {
      const avgTime = stats.time / stats.count;
      const pct = totalTime > 0 ? (stats.time / totalTime * 100).toFixed(1) : '0.0';
      console.log(`    ${type.padEnd(16)}: ${stats.time.toFixed(0).padStart(6)}ms (${pct.padStart(5)}%) - ${stats.count} calls, avg ${avgTime.toFixed(2)}ms/call`);
    }
  }

  const helperTotalTime = Object.values(perfStats.helperBreakdown).reduce((sum, h) => sum + h.time, 0);
  console.log('\n  Helper Function Breakdown:');
  for (const [helper, stats] of Object.entries(perfStats.helperBreakdown)) {
    if (stats.count > 0) {
      const avgTime = stats.time / stats.count;
      const pct = helperTotalTime > 0 ? (stats.time / helperTotalTime * 100).toFixed(1) : '0.0';
      console.log(`    ${helper.padEnd(24)}: ${stats.time.toFixed(0).padStart(6)}ms (${pct.padStart(5)}%) - ${stats.count} calls, avg ${avgTime.toFixed(2)}ms/call`);
    }
  }
  console.log('='.repeat(80) + '\n');
}

function trackTime<T>(category: keyof PerformanceStats['helperBreakdown'], fn: () => T): T {
  if (!perfStats) return fn();

  const start = performance.now();
  const result = fn();
  const elapsed = performance.now() - start;

  perfStats.helperBreakdown[category].count++;
  perfStats.helperBreakdown[category].time += elapsed;

  return result;
}

// ── Interfaces ──────────────────────────────────────────────────────

/**
 * Java-specific resolve result with file path for cross-language check
 */
export interface JavaResolveResult {
  nodeId: string;
  confidence: number;
  reason: 'this' | 'static' | 'methodInstance' | 'classInstance' | 'super' | 'interface';
  filePath: string;
  returnType?: string;
}

/**
 * Extracted call site information for Java calls
 */
export interface JavaCallSite {
  calledName: string;
  objectName: string | null; // Receiver object (e.g., 'obj' in 'obj.method()')
  objectTypeName?: string; // Pre-extracted type name (e.g., 'UserService' for obj: UserService)
  currentFile: string;
  enclosingFunctionId: string | null;
  callNode?: Parser.SyntaxNode;
}

// ── Main Resolution Function ────────────────────────────────────────

/**
 * Java-specific call resolution entry point.
 * Tries 6 resolution strategies in priority order.
 *
 * @param call - Call site information
 * @param graph - Knowledge graph for traversing relationships
 * @param symbolTable - Symbol table for looking up definitions
 * @param importMap - Import map for import-resolved symbols
 * @param astCache - AST cache for parsing method bodies
 * @returns Resolved target with reason and confidence, or null if unresolved
 */
export const resolveJavaCallTarget = (
  call: JavaCallSite,
  graph: KnowledgeGraph,
  symbolTable: SymbolTable,
  importMap: ImportMap,
  astCache: ASTCache,
): JavaResolveResult | null => {
  const { calledName, objectName, objectTypeName, currentFile, enclosingFunctionId } = call;

  if (perfStats) {
    perfStats.totalCalls++;
  }

  // Debug logging
  const debug = process.env.GITNEXUS_DEBUG_JAVA;
  if (debug) {
    console.log(`\n[Java Resolver] ${objectName ? objectName + '.' : ''}${calledName} in ${currentFile.split('/').pop()}`);
    console.log(`  enclosingFunctionId: ${enclosingFunctionId || 'null'}`);
    console.log(`  astCache available: ${!!astCache}`);
    console.log(`  objectTypeName (pre-extracted): ${objectTypeName || 'null'}`);
  }

  // Optimized resolution order:
  // 1. static - if objectName is capitalized (e.g., Utils.format())
  // 2. methodInstance (fast path) - if has pre-extracted type and not capitalized
  // 3. classInstance - fallback when fast path fails (class field lookup)
  // 4. methodInstance (slow path) - AST fallback when no pre-extracted type
  //
  // Performance optimization: Use fast path first (zero cost) before expensive
  // classInstance lookup (findEnclosingClass + findFieldInClass + inheritance chain).
  // This avoids 100k+ unnecessary field lookups.

  if (objectName) {
    // 1. static: ClassName.method() or full.path.ClassName.method()
    if (isCapitalized(objectName)) {
      const start = performance.now();
      const result = resolveStaticCall(calledName, objectName, currentFile, graph, symbolTable, importMap);
      const elapsed = performance.now() - start;

      if (perfStats) {
        perfStats.typeBreakdown.static.time += elapsed;
      }

      if (result) {
        if (perfStats) {
          perfStats.typeBreakdown.static.count++;
          perfStats.resolvedCalls++;
        }
        if (debug) console.log(`  ✓ Resolved as static (${elapsed.toFixed(2)}ms)`);
        return result;
      } else if (debug) {
        console.log(`  ✗ static failed (${elapsed.toFixed(2)}ms)`);
      }
    }

    // 2. methodInstance (fast path): use pre-extracted type if available (zero AST cost)
    // Skip if capitalized (handled by static above)
    if (!isCapitalized(objectName) && objectTypeName) {
      const start = performance.now();
      const result = resolveMethodInstanceByType(calledName, objectTypeName, currentFile, symbolTable, importMap);
      const elapsed = performance.now() - start;

      if (perfStats) {
        perfStats.typeBreakdown.methodInstance.time += elapsed;
      }

      if (result) {
        if (perfStats) {
          perfStats.typeBreakdown.methodInstance.count++;
          perfStats.resolvedCalls++;
        }
        if (debug) console.log(`  ✓ Resolved as methodInstance (pre-extracted type, ${elapsed.toFixed(2)}ms)`);
        return result;
      } else if (debug) {
        console.log(`  ✗ methodInstance fast path failed (pre-extracted type, ${elapsed.toFixed(2)}ms)`);
      }
    }

    // 3. classInstance: obj.method() - obj is a class field
    // Only checked when fast path fails (field might not have type annotation)
    const start2 = performance.now();
    const classInstanceResult = resolveClassInstance(calledName, objectName, currentFile, enclosingFunctionId, graph, symbolTable, importMap);
    const elapsed2 = performance.now() - start2;

    if (perfStats) {
      perfStats.typeBreakdown.classInstance.time += elapsed2;
    }

    if (classInstanceResult) {
      if (perfStats) {
        perfStats.typeBreakdown.classInstance.count++;
        perfStats.resolvedCalls++;
      }
      if (debug) console.log(`  ✓ Resolved as classInstance (${elapsed2.toFixed(2)}ms)`);
      return classInstanceResult;
    } else if (debug) {
      console.log(`  ✗ classInstance failed (${elapsed2.toFixed(2)}ms)`);
    }

    // 4. methodInstance (slow path): parse AST if available (fallback)
    if (astCache) {
      const start = performance.now();
      const result = resolveMethodInstance(calledName, objectName, currentFile, enclosingFunctionId, graph, symbolTable, importMap, astCache);
      const elapsed = performance.now() - start;

      if (perfStats) {
        perfStats.typeBreakdown.methodInstance.time += elapsed;
      }

      if (result) {
        if (perfStats) {
          perfStats.typeBreakdown.methodInstance.count++;
          perfStats.resolvedCalls++;
        }
        if (debug) console.log(`  ✓ Resolved as methodInstance (AST parse, ${elapsed.toFixed(2)}ms)`);
        return result;
      } else if (debug) {
        console.log(`  ✗ methodInstance slow path failed (AST parse, ${elapsed.toFixed(2)}ms)`);
      }
    } else if (!objectTypeName && !astCache && debug) {
      console.log(`  ⊘ methodInstance skipped (no pre-extracted type, no AST cache)`);
    }
  }

  // 4. this: method() - current class method
  if (!objectName) {
    const start = performance.now();
    const result = resolveThisCall(calledName, currentFile, enclosingFunctionId, graph, symbolTable);
    const elapsed = performance.now() - start;

    if (perfStats) {
      perfStats.typeBreakdown.this.time += elapsed;
    }

    if (result) {
      if (perfStats) {
        perfStats.typeBreakdown.this.count++;
        perfStats.resolvedCalls++;
      }
      if (debug) console.log(`  ✓ Resolved as this (${elapsed.toFixed(2)}ms)`);
      return result;
    } else if (debug) {
      console.log(`  ✗ this failed (${elapsed.toFixed(2)}ms)`);
    }
  }

  // 5. super: method() - parent class method
  if (!objectName) {
    const start = performance.now();
    const result = resolveSuperCall(calledName, currentFile, enclosingFunctionId, graph, symbolTable, importMap);
    const elapsed = performance.now() - start;

    if (perfStats) {
      perfStats.typeBreakdown.super.time += elapsed;
    }

    if (result) {
      if (perfStats) {
        perfStats.typeBreakdown.super.count++;
        perfStats.resolvedCalls++;
      }
      if (debug) console.log(`  ✓ Resolved as super (${elapsed.toFixed(2)}ms)`);
      return result;
    } else if (debug) {
      console.log(`  ✗ super failed (${elapsed.toFixed(2)}ms)`);
    }
  }

  // 6. interface: method() - interface method
  if (!objectName) {
    const start = performance.now();
    const result = resolveInterfaceCall(calledName, currentFile, enclosingFunctionId, graph, symbolTable);
    const elapsed = performance.now() - start;

    if (perfStats) {
      perfStats.typeBreakdown.interface.time += elapsed;
    }

    if (result) {
      if (perfStats) {
        perfStats.typeBreakdown.interface.count++;
        perfStats.resolvedCalls++;
      }
      if (debug) console.log(`  ✓ Resolved as interface (${elapsed.toFixed(2)}ms)`);
      return result;
    } else if (debug) {
      console.log(`  ✗ interface failed (${elapsed.toFixed(2)}ms)`);
    }
  }

  // Unable to resolve - return null
  if (perfStats) {
    perfStats.unresolvedCalls++;
  }
  if (debug) {
    console.log(`  ✗ ALL TYPES FAILED`);
  }
  return null;
};

// ── Resolution Strategies ───────────────────────────────────────────

/**
 * 1a. methodInstance (fast path): Resolve using pre-extracted type from worker.
 * Zero AST parsing cost - worker already extracted the type during initial parse.
 *
 * Example: UserService service = ...; service.validateUser();
 * Worker extracts: objectName='service', objectTypeName='UserService'
 * This function: lookup 'UserService' class, find 'validateUser' method
 */
const resolveMethodInstanceByType = (
  calledName: string,
  typeName: string,
  currentFile: string,
  symbolTable: SymbolTable,
  importMap: ImportMap,
): JavaResolveResult | null => {
  const debug = process.env.GITNEXUS_DEBUG_JAVA;

  if (debug) console.log(`    [methodInstance-fast] Type: ${typeName}`);

  // Find class by type name
  const classDef = trackTime('findClassByTypeName', () =>
    findClassByTypeName(typeName, currentFile, symbolTable, importMap)
  );

  if (!classDef) {
    if (debug) console.log(`    [methodInstance-fast] FAIL: Class '${typeName}' not found`);
    return null;
  }

  if (debug) console.log(`    [methodInstance-fast] Found class: ${classDef.nodeId}`);

  // Find method in class
  const methodDef = trackTime('findMethodInClass', () =>
    symbolTable.findMethodInClass(classDef.nodeId, calledName)
  );

  if (!methodDef) {
    if (debug) console.log(`    [methodInstance-fast] FAIL: Method '${calledName}' not found in class`);
    return null;
  }

  if (debug) console.log(`    [methodInstance-fast] SUCCESS: Found method ${methodDef.nodeId}`);

  return {
    nodeId: methodDef.nodeId,
    confidence: 0.95,
    reason: 'methodInstance',
    filePath: methodDef.filePath,
    returnType: methodDef.returnType,
  };
};

/**
 * 1b. methodInstance (slow path): Resolve by parsing AST to extract local variables.
 * Example: UserService service = new UserService(); service.validateUser();
 *
 * Resolution strategy:
 * A. Parse enclosing method AST to extract local variables and parameters
 * B. Find variable matching objectName
 * C. Extract variable type name
 * D. Find class by type name
 * E. Find method in that class
 */
const resolveMethodInstance = (
  calledName: string,
  objectName: string,
  currentFile: string,
  enclosingFunctionId: string | null,
  graph: KnowledgeGraph,
  symbolTable: SymbolTable,
  importMap: ImportMap,
  astCache: ASTCache,
): JavaResolveResult | null => {
  const debug = process.env.GITNEXUS_DEBUG_JAVA;

  if (!enclosingFunctionId) {
    if (debug) console.log(`    [methodInstance] FAIL: No enclosing function ID`);
    return null;
  }

  // Get method AST from cache
  const tree = astCache.get(currentFile);
  if (!tree) {
    if (debug) console.log(`    [methodInstance] FAIL: No AST tree for file`);
    return null;
  }

  // Extract local variables from method body
  const locals = trackTime('extractLocalVariables', () =>
    extractLocalVariables(tree.rootNode, enclosingFunctionId, currentFile)
  );

  if (debug) {
    console.log(`    [methodInstance] Extracted ${locals.length} local variables/parameters:`);
    locals.forEach(v => console.log(`      - ${v.name}: ${v.typeName}`));
  }

  // Find variable matching objectName
  const variable = locals.find(v => v.name === objectName);
  if (!variable) {
    if (debug) console.log(`    [methodInstance] FAIL: Variable '${objectName}' not found in locals`);
    return null;
  }

  if (debug) console.log(`    [methodInstance] Found variable: ${variable.name}: ${variable.typeName}`);

  // Find class by type name
  const classDef = trackTime('findClassByTypeName', () =>
    findClassByTypeName(variable.typeName, currentFile, symbolTable, importMap)
  );

  if (!classDef) {
    if (debug) console.log(`    [methodInstance] FAIL: Class '${variable.typeName}' not found`);
    return null;
  }

  if (debug) console.log(`    [methodInstance] Found class: ${classDef.nodeId}`);

  // Find method in class
  const methodDef = trackTime('findMethodInClass', () =>
    symbolTable.findMethodInClass(classDef.nodeId, calledName)
  );

  if (!methodDef) {
    if (debug) console.log(`    [methodInstance] FAIL: Method '${calledName}' not found in class`);
    return null;
  }

  if (debug) console.log(`    [methodInstance] SUCCESS: Found method ${methodDef.nodeId}`);

  return {
    nodeId: methodDef.nodeId,
    confidence: 0.95,
    reason: 'methodInstance',
    filePath: methodDef.filePath,
    returnType: methodDef.returnType,
  };
};

// ── AST Parsing Helpers for methodInstance ─────────────────────────

interface LocalVariable {
  name: string;
  typeName: string;
}

/**
 * Extract local variables and parameters from a method's AST.
 * Walks the AST to find:
 * - local_variable_declaration nodes (e.g., "UserService service = ...")
 * - formal_parameter nodes (e.g., method parameters)
 */
const extractLocalVariables = (
  rootNode: Parser.SyntaxNode,
  enclosingFunctionId: string,
  currentFile: string,
): LocalVariable[] => {
  const debug = process.env.GITNEXUS_DEBUG_JAVA;
  const locals: LocalVariable[] = [];

  // Extract method name from enclosingFunctionId
  // Format can be either:
  // - "Method:filePath:methodName" (2 colons)
  // - "Method:filePath:className:methodName" (3 colons)
  const parts = enclosingFunctionId.split(':');
  const methodName = parts.length >= 3 ? parts[parts.length - 1] : null;

  if (!methodName) {
    if (debug) console.log(`      [extractLocalVariables] FAIL: Cannot extract method name from ${enclosingFunctionId}`);
    return locals;
  }

  if (debug) console.log(`      [extractLocalVariables] Looking for method: ${methodName} (from ID: ${enclosingFunctionId})`);

  // Find the method declaration node
  const methodNode = findMethodNode(rootNode, methodName);
  if (!methodNode) {
    if (debug) console.log(`      [extractLocalVariables] FAIL: Method node not found in AST`);
    return locals;
  }

  if (debug) console.log(`      [extractLocalVariables] Found method node type: ${methodNode.type}`);

  // Walk AST to find local variable declarations and parameters
  const walkNode = (node: Parser.SyntaxNode) => {
    // Extract local variable declarations
    if (node.type === 'local_variable_declaration') {
      const varDecl = parseLocalVariableDeclaration(node);
      if (varDecl) {
        locals.push(varDecl);
        if (debug) console.log(`      [extractLocalVariables] Found local var: ${varDecl.name}: ${varDecl.typeName}`);
      }
    }

    // Extract formal parameters
    if (node.type === 'formal_parameter') {
      const param = parseFormalParameter(node);
      if (param) {
        locals.push(param);
        if (debug) console.log(`      [extractLocalVariables] Found parameter: ${param.name}: ${param.typeName}`);
      }
    }

    // Recurse into children
    for (const child of node.children) {
      walkNode(child);
    }
  };

  walkNode(methodNode);

  if (debug) console.log(`      [extractLocalVariables] Total found: ${locals.length}`);
  return locals;
};

/**
 * Find a method declaration node by method name
 */
const findMethodNode = (rootNode: Parser.SyntaxNode, methodName: string): Parser.SyntaxNode | null => {
  const walk = (node: Parser.SyntaxNode): Parser.SyntaxNode | null => {
    if (node.type === 'method_declaration' || node.type === 'constructor_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode && nameNode.text === methodName) return node;
    }

    for (const child of node.children) {
      const result = walk(child);
      if (result) return result;
    }
    return null;
  };

  return walk(rootNode);
};

/**
 * Parse local variable declaration node.
 * Example: "UserService service = new UserService();"
 * AST structure: (local_variable_declaration type: (type_identifier) declarator: (variable_declarator name: (identifier)))
 */
const parseLocalVariableDeclaration = (node: Parser.SyntaxNode): LocalVariable | null => {
  const typeNode = node.childForFieldName('type');
  const declaratorNode = node.children.find(c => c.type === 'variable_declarator');

  if (!typeNode || !declaratorNode) return null;

  const typeName = extractTypeName(typeNode);
  const nameNode = declaratorNode.childForFieldName('name');

  if (!typeName || !nameNode) return null;

  return { name: nameNode.text, typeName };
};

/**
 * Parse formal parameter node.
 * Example: "UserService service" in method signature
 * AST structure: (formal_parameter type: (type_identifier) name: (identifier))
 */
const parseFormalParameter = (node: Parser.SyntaxNode): LocalVariable | null => {
  const typeNode = node.childForFieldName('type');
  const nameNode = node.childForFieldName('name');

  if (!typeNode || !nameNode) return null;

  const typeName = extractTypeName(typeNode);
  if (!typeName) return null;

  return { name: nameNode.text, typeName };
};

/**
 * Extract type name from a type node, handling generics.
 * Examples:
 * - "UserService" → "UserService"
 * - "List<User>" → "List"
 * - "Map<String, User>" → "Map"
 */
const extractTypeName = (typeNode: Parser.SyntaxNode): string | null => {
  // Handle generic types
  if (typeNode.type === 'generic_type') {
    const typeIdentifier = typeNode.children.find(c => c.type === 'type_identifier');
    return typeIdentifier ? typeIdentifier.text : null;
  }

  // Handle simple types
  if (typeNode.type === 'type_identifier') {
    return typeNode.text;
  }

  // Fallback: use first type_identifier child
  const typeIdentifier = typeNode.children.find(c => c.type === 'type_identifier');
  return typeIdentifier ? typeIdentifier.text : null;
};

/**
 * Find a class definition by type name.
 * Searches in current file first, then in imported files, then globally.
 */
const findClassByTypeName = (
  typeName: string,
  currentFile: string,
  symbolTable: SymbolTable,
  importMap?: ImportMap,
): SymbolDefinition | null => {
  // Try same-file lookup first
  const localDef = symbolTable.lookupExactFull(currentFile, typeName);
  if (localDef && (localDef.type === 'Class' || localDef.type === 'Interface' || localDef.type === 'Enum')) {
    return localDef;
  }

  // Try fuzzy lookup across all files
  const allDefs = symbolTable.lookupFuzzy(typeName);
  const classDefs = allDefs.filter(def => def.type === 'Class' || def.type === 'Interface' || def.type === 'Enum');

  if (classDefs.length === 0) return null;

  // If only one match, return it
  if (classDefs.length === 1) return classDefs[0];

  // Multiple matches - use import resolution to disambiguate
  if (importMap) {
    const importedFiles = importMap.get(currentFile);
    if (importedFiles) {
      const importedDef = classDefs.find(def => importedFiles.has(def.filePath));
      if (importedDef) return importedDef;
    }
  }

  // Fallback: return first match (ambiguous, but better than null)
  return classDefs[0];
};

/**
 * 2. classInstance: Resolve calls to methods on class fields.
 * Example: private UserService userService; ... userService.validateUser();
 *
 * Resolution strategy:
 * A. Find enclosing class
 * B. Search for field in current class using SymbolTable
 * C. Search in parent classes (inheritance chain)
 * D. Extract field type name
 * E. Find class by type name
 * F. Find method in that class
 */
const resolveClassInstance = (
  calledName: string,
  objectName: string,
  currentFile: string,
  enclosingFunctionId: string | null,
  graph: KnowledgeGraph,
  symbolTable: SymbolTable,
  importMap: ImportMap,
): JavaResolveResult | null => {
  const debug = process.env.GITNEXUS_DEBUG_JAVA;

  // Find the enclosingclass
  const enclosingClass = trackTime('findEnclosingClass', () =>
    findEnclosingClass(enclosingFunctionId, currentFile, graph)
  );

  if (!enclosingClass) {
    if (debug) console.log(`    [classInstance] FAIL: No enclosing class found`);
    return null;
  }

  if (debug) console.log(`    [classInstance] Enclosing class: ${enclosingClass.id}`);

  // Find field in class (supports inheritance)
  const fieldDef = trackTime('findFieldInClass', () =>
    findFieldInClass(enclosingClass.id, objectName, graph, symbolTable)
  );

  if (!fieldDef) {
    if (debug) console.log(`    [classInstance] FAIL: Field '${objectName}' not found in class or parents`);
    return null;
  }

  if (debug) console.log(`    [classInstance] Found field: ${fieldDef.nodeId}, type: ${fieldDef.declaredType}`);

  if (!fieldDef.declaredType) {
    if (debug) console.log(`    [classInstance] FAIL: Field has no declaredType`);
    return null;
  }

  // Extract type name from declared type (strip generics if present)
  const typeName = extractTypeNameFromString(fieldDef.declaredType);
  if (!typeName) {
    if (debug) console.log(`    [classInstance] FAIL: Cannot extract type name from '${fieldDef.declaredType}'`);
    return null;
  }

  if (debug) console.log(`    [classInstance] Extracted type name: ${typeName}`);

  // Find class by type name
  const classDef = trackTime('findClassByTypeName', () =>
    findClassByTypeName(typeName, currentFile, symbolTable, importMap)
  );

  if (!classDef) {
    if (debug) console.log(`    [classInstance] FAIL: Class '${typeName}' not found`);
    return null;
  }

  if (debug) console.log(`    [classInstance] Found class: ${classDef.nodeId}`);

  // Find method in class
  const methodDef = trackTime('findMethodInClass', () =>
    symbolTable.findMethodInClass(classDef.nodeId, calledName)
  );

  if (!methodDef) {
    if (debug) console.log(`    [classInstance] FAIL: Method '${calledName}' not found in class ${classDef.nodeId}`);
    return null;
  }

  if (debug) console.log(`    [classInstance] SUCCESS: Found method ${methodDef.nodeId}`);

  return {
    nodeId: methodDef.nodeId,
    confidence: 0.9,
    reason: 'classInstance',
    filePath: methodDef.filePath,
    returnType: methodDef.returnType,
  };
};

// ── Field Lookup Helpers for classInstance ─────────────────────────

/**
 * Find a field in a class, searching current class and parent classes.
 * Uses SymbolTable's lookupFieldByOwner for O(1) lookup.
 * Uses edge index for O(1) inheritance traversal (replaces O(E) iterRelationships).
 */
const findFieldInClass = (
  classId: string,
  fieldName: string,
  graph: KnowledgeGraph,
  symbolTable: SymbolTable,
): SymbolDefinition | null => {
  // Try current class first
  const fieldDef = symbolTable.lookupFieldByOwner(classId, fieldName);
  if (fieldDef) return fieldDef;

  // Get edge index for O(1) relationship lookup
  const edgeIndex = getEdgeIndex(graph);

  // Search in parent classes
  const visited = new Set<string>();
  const queue: string[] = [classId];

  while (queue.length > 0) {
    const currentClassId = queue.shift()!;

    // Cycle detection
    if (visited.has(currentClassId)) continue;
    visited.add(currentClassId);

    // Find EXTENDS edges using index (O(1) vs O(E))
    const edges = edgeIndex.bySource.get(currentClassId) || [];
    const extendsEdges = edges.filter(e => e.type === 'EXTENDS');

    for (const edge of extendsEdges) {
      const parentClassId = edge.targetId;

      // Try to find field in parent class
      const parentFieldDef = symbolTable.lookupFieldByOwner(parentClassId, fieldName);
      if (parentFieldDef) return parentFieldDef;

      // Continue searching in grandparent classes
      queue.push(parentClassId);
    }
  }

  return null;
};

/**
 * Extract simple type name from a type string (strip generics).
 * Examples:
 * - "UserService" → "UserService"
 * - "List<User>" → "List"
 * - "Map<String, User>" → "Map"
 */
const extractTypeNameFromString = (typeStr: string): string | null => {
  if (!typeStr) return null;

  // Strip generics: "List<User>" → "List"
  const match = typeStr.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
  return match ? match[1] : null;
};

/**
 * 3. static: Resolve static method calls.
 * Example: Utils.format() or com.example.Utils.format()
 *
 * Resolution strategy:
 * A. Simple class name (e.g., "Utils") - lookup in imports
 * B. Fully qualified name (e.g., "com.example.Utils") - direct package path match
 */
const resolveStaticCall = (
  calledName: string,
  objectName: string,
  currentFile: string,
  graph: KnowledgeGraph,
  symbolTable: SymbolTable,
  importMap: ImportMap,
): JavaResolveResult | null => {
  const debug = process.env.GITNEXUS_DEBUG_JAVA;
  let classCandidates: SymbolDefinition[] = [];

  // Case A: Simple class name (e.g., "Utils")
  if (!objectName.includes('.')) {
    // Check if class is imported
    const importedFiles = importMap.get(currentFile);
    if (debug) {
      console.log(`    [static] Simple class name: ${objectName}`);
      console.log(`    [static] Imported files count: ${importedFiles?.size || 0}`);
    }

    if (importedFiles) {
      // Lookup class in imported files
      const allClasses = symbolTable.lookupFuzzy(objectName);
      if (debug) console.log(`    [static] lookupFuzzy('${objectName}') found ${allClasses.length} candidates`);

      classCandidates = allClasses.filter(def =>
        (def.type === 'Class' || def.type === 'Interface' || def.type === 'Enum') &&
        importedFiles.has(def.filePath)
      );

      if (debug) console.log(`    [static] After import filter: ${classCandidates.length} candidates`);
    } else if (debug) {
      console.log(`    [static] No imports found for file`);
    }

    // Fallback: check same-package classes (no import required in Java)
    if (classCandidates.length === 0) {
      if (debug) console.log(`    [static] Trying same-package fallback...`);
      const allClasses = symbolTable.lookupFuzzy(objectName);
      if (debug) console.log(`    [static] lookupFuzzy('${objectName}') found ${allClasses.length} total candidates`);

      // Find classes in the same directory (same package)
      const currentDir = currentFile.substring(0, currentFile.lastIndexOf('/'));
      if (debug) console.log(`    [static] Current dir: ${currentDir}`);

      classCandidates = allClasses.filter(def => {
        if (def.type !== 'Class' && def.type !== 'Interface' && def.type !== 'Enum') return false;
        const defDir = def.filePath.substring(0, def.filePath.lastIndexOf('/'));
        const isSamePackage = defDir === currentDir;
        if (debug && isSamePackage) console.log(`    [static] Same-package match: ${def.filePath}`);
        return isSamePackage;
      });

      if (debug) console.log(`    [static] After same-package filter: ${classCandidates.length} candidates`);
    }
  }
  // Case B: Fully qualified name (e.g., "com.example.Utils")
  else {
    if (debug) console.log(`    [static] Fully qualified name: ${objectName}`);
    classCandidates = symbolTable.findSymbolsByQualifiedName(objectName);
    if (debug) console.log(`    [static] findSymbolsByQualifiedName found ${classCandidates.length} candidates`);
  }

  // No class found
  if (classCandidates.length === 0) {
    if (debug) console.log(`    [static] FAIL: No class candidates`);
    return null;
  }

  // Try to find the method in each candidate class
  for (const classDef of classCandidates) {
    if (debug) console.log(`    [static] Trying class: ${classDef.nodeId}`);

    const methodDef = trackTime('findMethodInClass', () =>
      symbolTable.findMethodInClass(classDef.nodeId, calledName)
    );

    if (methodDef) {
      if (debug) console.log(`    [static] SUCCESS: Found method ${calledName} in ${classDef.nodeId}`);
      return {
        nodeId: methodDef.nodeId,
        confidence: 0.95,
        reason: 'static',
        filePath: methodDef.filePath,
        returnType: methodDef.returnType,
      };
    } else if (debug) {
      console.log(`    [static] Method ${calledName} not found in ${classDef.nodeId}`);
    }
  }

  if (debug) console.log(`    [static] FAIL: Method not found in any candidate class`);
  return null;
};

/**
 * 4. this: Resolve calls to current class methods.
 * Example: validate(); // Current class method
 *
 * Resolution strategy:
 * A. Find enclosing class using optimized O(1) lookup
 * B. Find method in that class using symbolTable.findMethodInClass
 */
const resolveThisCall = (
  calledName: string,
  currentFile: string,
  enclosingFunctionId: string | null,
  graph: KnowledgeGraph,
  symbolTable: SymbolTable,
): JavaResolveResult | null => {
  const debug = process.env.GITNEXUS_DEBUG_JAVA;

  // Find the enclosing class
  const enclosingClass = trackTime('findEnclosingClass', () =>
    findEnclosingClass(enclosingFunctionId, currentFile, graph)
  );

  if (!enclosingClass) {
    if (debug) console.log(`    [this] FAIL: No enclosing class found`);
    return null;
  }

  if (debug) console.log(`    [this] Enclosing class: ${enclosingClass.id}`);

  // Find method in current class
  const methodDef = trackTime('findMethodInClass', () =>
    symbolTable.findMethodInClass(enclosingClass.id, calledName)
  );

  if (!methodDef) {
    if (debug) console.log(`    [this] FAIL: Method '${calledName}' not found in class`);
    return null;
  }

  if (debug) console.log(`    [this] SUCCESS: Found method ${methodDef.nodeId}`);

  return {
    nodeId: methodDef.nodeId,
    confidence: 0.9,
    reason: 'this',
    filePath: methodDef.filePath,
    returnType: methodDef.returnType,
  };
};

/**
 * 5. super: Resolve calls to parent class methods.
 * Example: init(); // Parent class method
 *
 * Resolution strategy:
 * A. Find enclosing class
 * B. Traverse EXTENDS edges to find parent classes
 * C. Search for method in each parent class
 * D. Support multi-level inheritance with cycle detection
 */
const resolveSuperCall = (
  calledName: string,
  currentFile: string,
  enclosingFunctionId: string | null,
  graph: KnowledgeGraph,
  symbolTable: SymbolTable,
  importMap: ImportMap,
): JavaResolveResult | null => {
  const debug = process.env.GITNEXUS_DEBUG_JAVA;

  // Find the enclosing class
  const enclosingClass = trackTime('findEnclosingClass', () =>
    findEnclosingClass(enclosingFunctionId, currentFile, graph)
  );

  if (!enclosingClass) {
    if (debug) console.log(`    [super] FAIL: No enclosingclass found`);
    return null;
  }

  if (debug) console.log(`    [super] Enclosing class: ${enclosingClass.id}`);

  // Traverse parent class chain using EXTENDS edges
  return trackTime('traverseInheritance', () => {
    // Refresh edge index once per graph to ensure EXTENDS edges are included
    // (Heritage processor adds EXTENDS edges after initial index build, but we only
    // need to refresh once, not on every super-call - massive performance improvement)
    if (!edgeIndexRefreshed.has(graph)) {
      edgeIndexCache.delete(graph);
      edgeIndexRefreshed.add(graph);
    }
    const edgeIndex = getEdgeIndex(graph);

    const visited = new Set<string>();
    const queue: string[] = [enclosingClass.id];

    if (debug) console.log(`    [super] Starting inheritance traversal from ${enclosingClass.id}`);

    while (queue.length > 0) {
      const currentClassId = queue.shift()!;

      // Cycle detection
      if (visited.has(currentClassId)) continue;
      visited.add(currentClassId);

      if (debug) console.log(`    [super] Checking class: ${currentClassId}`);

      // Find EXTENDS edges using index (O(1) vs O(E))
      const edges = edgeIndex.bySource.get(currentClassId) || [];
      const extendsEdges = edges.filter(e => e.type === 'EXTENDS');

      if (debug) console.log(`    [super] Found ${extendsEdges.length} EXTENDS edges from index`);

      // Fallback: If no EXTENDS edges found in index, extract from node properties
      // (This happens when heritage-processor hasn't run yet during parallel indexing)
      if (extendsEdges.length === 0) {
        const currentNode = graph.getNode(currentClassId);
        const parentClassName = (currentNode?.properties as any)?.superClassName as string | undefined;

        if (parentClassName && debug) {
          console.log(`    [super] Fallback: Found parent class name '${parentClassName}' from node properties`);
        }

        if (parentClassName) {
          // Find parent class by name
          const parentClass = findClassByTypeName(parentClassName, currentFile, symbolTable, importMap);

          if (parentClass && debug) {
            console.log(`    [super] Fallback: Resolved parent class to ${parentClass.nodeId}`);
          }

          if (parentClass) {
            // Try to find method in parent class
            const methodDef = trackTime('findMethodInClass', () =>
              symbolTable.findMethodInClass(parentClass.nodeId, calledName)
            );

            if (methodDef) {
              if (debug) console.log(`    [super] SUCCESS: Found method ${methodDef.nodeId} via fallback`);
              return {
                nodeId: methodDef.nodeId,
                confidence: 0.85,
                reason: 'super' as const,
                filePath: methodDef.filePath,
                returnType: methodDef.returnType,
              };
            } else if (debug) {
              console.log(`    [super] Method '${calledName}' not found in ${parentClass.nodeId}`);
            }

            // Continue searching in grandparent classes
            queue.push(parentClass.nodeId);
          }
        }
      } else {
        // Use EXTENDS edges from index (normal path)
        for (const edge of extendsEdges) {
          const parentClassId = edge.targetId;

          if (debug) console.log(`    [super] Checking parent: ${parentClassId}`);

          // Try to find method in parent class
          const methodDef = trackTime('findMethodInClass', () =>
            symbolTable.findMethodInClass(parentClassId, calledName)
          );
          if (methodDef) {
            if (debug) console.log(`    [super] SUCCESS: Found method ${methodDef.nodeId}`);
            return {
              nodeId: methodDef.nodeId,
              confidence: 0.85,
              reason: 'super' as const,
              filePath: methodDef.filePath,
              returnType: methodDef.returnType,
            };
          } else if (debug) {
            console.log(`    [super] Method '${calledName}' not found in ${parentClassId}`);
          }

          // Continue searching in grandparent classes
          queue.push(parentClassId);
        }
      }
    }

    if (debug) console.log(`    [super] FAIL: No method found in inheritance chain`);
    return null;
  });
};

/**
 * 6. interface: Resolve calls to interface methods.
 * Example: processRequest(); // Interface method implementation
 *
 * Resolution strategy:
 * A. Find enclosing class
 * B. Traverse IMPLEMENTS edges to find interfaces
 * C. Search for method in each interface
 * D. Support multi-level interface inheritance with cycle detection
 */
const resolveInterfaceCall = (
  calledName: string,
  currentFile: string,
  enclosingFunctionId: string | null,
  graph: KnowledgeGraph,
  symbolTable: SymbolTable,
): JavaResolveResult | null => {
  // Find the enclosing class
  const enclosingClass = trackTime('findEnclosingClass', () =>
    findEnclosingClass(enclosingFunctionId, currentFile, graph)
  );
  if (!enclosingClass) return null;

  // Traverse interface chain
  return trackTime('traverseInheritance', () => {
    // Get edge index for O(1) relationship lookup
    const edgeIndex = getEdgeIndex(graph);

    const visited = new Set<string>();
    const queue: string[] = [enclosingClass.id];

    while (queue.length > 0) {
      const currentClassId = queue.shift()!;

      // Cycle detection
      if (visited.has(currentClassId)) continue;
      visited.add(currentClassId);

      // Find IMPLEMENTS edges using index (O(1) vs O(E))
      const edges = edgeIndex.bySource.get(currentClassId) || [];
      const implementsEdges = edges.filter(e => e.type === 'IMPLEMENTS');

      for (const edge of implementsEdges) {
        const interfaceId = edge.targetId;

        // Try to find method in interface
        const methodDef = trackTime('findMethodInClass', () =>
          symbolTable.findMethodInClass(interfaceId, calledName)
        );
        if (methodDef) {
          return {
            nodeId: methodDef.nodeId,
            confidence: 0.85,
            reason: 'interface' as const,
            filePath: methodDef.filePath,
            returnType: methodDef.returnType,
          };
        }

        // Continue searching in parent interfaces (interfaces can extend other interfaces)
        queue.push(interfaceId);
      }
    }

    return null;
  });
};

// ── Helper Functions ────────────────────────────────────────────────

/**
 * Find the enclosing class of a method (O(1) optimized version).
 * Uses GitNexus node ID naming convention for direct hash lookup.
 *
 * Node ID format:
 * - File: "File:{filePath}"
 * - Class: "Class:{filePath}:{className}"
 * - Method: "Method:{filePath}:{className}:{methodName}"
 *
 * Java convention: Single class per file, className = filename without extension
 *
 * Performance: O(1) hash lookup vs O(E) edge traversal (92B operations → 100K lookups)
 */
const findEnclosingClass = (
  methodId: string | null,
  currentFile: string,
  graph: KnowledgeGraph,
): { id: string; properties: any } | null => {
  // Get file node
  const fileNode = graph.getNode(`File:${currentFile}`);
  if (!fileNode || !fileNode.properties?.name) return null;

  // Extract class name from file name (remove .java extension)
  const fileName = fileNode.properties.name;
  const className = fileName.replace(/\.java$/, '');

  // Direct class node lookup using ID convention
  const classId = `Class:${currentFile}:${className}`;
  return graph.getNode(classId);
};

/**
 * Check if a string starts with an uppercase letter (Java class naming convention)
 */
const isCapitalized = (name: string): boolean => {
  return /^[A-Z]/.test(name);
};
