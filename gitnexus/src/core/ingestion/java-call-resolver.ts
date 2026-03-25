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
 * Build or retrieve cached edge index for a graph.
 * Cost: O(E) once per graph, then O(1) lookups.
 */
function getEdgeIndex(graph: KnowledgeGraph): EdgeIndex {
  let index = edgeIndexCache.get(graph);
  if (index) return index;

  const start = performance.now();
  const bySource = new Map<string, Array<{ type: string; targetId: string }>>();

  for (const rel of graph.iterRelationships()) {
    if (!bySource.has(rel.sourceId)) {
      bySource.set(rel.sourceId, []);
    }
    bySource.get(rel.sourceId)!.push({ type: rel.type, targetId: rel.targetId });
  }

  index = { bySource };
  edgeIndexCache.set(graph, index);

  const elapsed = performance.now() - start;
  if (process.env.GITNEXUS_DEBUG_JAVA) {
    console.log(`[Java Performance] Edge index built: ${bySource.size} nodes indexed in ${elapsed.toFixed(0)}ms`);
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
  const { calledName, objectName, currentFile, enclosingFunctionId } = call;

  if (perfStats) {
    perfStats.totalCalls++;
  }

  // Debug logging
  if (process.env.GITNEXUS_DEBUG_JAVA) {
    console.log(`[Java Resolver] Processing call: ${objectName ? objectName + '.' : ''}${calledName} in ${currentFile}`);
  }

  // 1. methodInstance: obj.method() - obj is a local variable/parameter
  // Requires AST parsing - skip if AST not available
  if (objectName && astCache) {
    const start = performance.now();
    const result = resolveMethodInstance(calledName, objectName, currentFile, enclosingFunctionId, graph, symbolTable, astCache);
    const elapsed = performance.now() - start;

    if (perfStats) {
      perfStats.typeBreakdown.methodInstance.time += elapsed;
    }

    if (result) {
      if (perfStats) {
        perfStats.typeBreakdown.methodInstance.count++;
        perfStats.resolvedCalls++;
      }
      if (process.env.GITNEXUS_DEBUG_JAVA) console.log(`  ✓ Resolved as methodInstance (${elapsed.toFixed(2)}ms)`);
      return result;
    }
  }

  // 2. classInstance: obj.method() - obj is a class field
  if (objectName) {
    const start = performance.now();
    const result = resolveClassInstance(calledName, objectName, currentFile, enclosingFunctionId, graph, symbolTable);
    const elapsed = performance.now() - start;

    if (perfStats) {
      perfStats.typeBreakdown.classInstance.time += elapsed;
    }

    if (result) {
      if (perfStats) {
        perfStats.typeBreakdown.classInstance.count++;
        perfStats.resolvedCalls++;
      }
      if (process.env.GITNEXUS_DEBUG_JAVA) console.log(`  ✓ Resolved as classInstance (${elapsed.toFixed(2)}ms)`);
      return result;
    }
  }

  // 3. static: ClassName.method() or full.path.ClassName.method()
  if (objectName && isCapitalized(objectName)) {
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
      if (process.env.GITNEXUS_DEBUG_JAVA) console.log(`  ✓ Resolved as static (${elapsed.toFixed(2)}ms)`);
      return result;
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
      if (process.env.GITNEXUS_DEBUG_JAVA) console.log(`  ✓ Resolved as this (${elapsed.toFixed(2)}ms)`);
      return result;
    }
  }

  // 5. super: method() - parent class method
  if (!objectName) {
    const start = performance.now();
    const result = resolveSuperCall(calledName, currentFile, enclosingFunctionId, graph, symbolTable);
    const elapsed = performance.now() - start;

    if (perfStats) {
      perfStats.typeBreakdown.super.time += elapsed;
    }

    if (result) {
      if (perfStats) {
        perfStats.typeBreakdown.super.count++;
        perfStats.resolvedCalls++;
      }
      if (process.env.GITNEXUS_DEBUG_JAVA) console.log(`  ✓ Resolved as super (${elapsed.toFixed(2)}ms)`);
      return result;
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
      if (process.env.GITNEXUS_DEBUG_JAVA) console.log(`  ✓ Resolved as interface (${elapsed.toFixed(2)}ms)`);
      return result;
    }
  }

  // Unable to resolve - return null
  if (perfStats) {
    perfStats.unresolvedCalls++;
  }
  if (process.env.GITNEXUS_DEBUG_JAVA) {
    console.log(`  ✗ Unable to resolve`);
  }
  return null;
};

// ── Resolution Strategies ───────────────────────────────────────────

/**
 * 1. methodInstance: Resolve calls to methods on local variables/parameters.
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
  astCache: ASTCache,
): JavaResolveResult | null => {
  if (!enclosingFunctionId) return null;

  // Get method AST from cache
  const tree = astCache.get(currentFile);
  if (!tree) return null;

  // Extract local variables from method body
  const locals = trackTime('extractLocalVariables', () =>
    extractLocalVariables(tree.rootNode, enclosingFunctionId, currentFile)
  );

  // Find variable matching objectName
  const variable = locals.find(v => v.name === objectName);
  if (!variable) return null;

  // Find class by type name
  const classDef = trackTime('findClassByTypeName', () =>
    findClassByTypeName(variable.typeName, currentFile, symbolTable)
  );
  if (!classDef) return null;

  // Find method in class
  const methodDef = trackTime('findMethodInClass', () =>
    symbolTable.findMethodInClass(classDef.nodeId, calledName)
  );
  if (!methodDef) return null;

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
  const locals: LocalVariable[] = [];

  // Extract method name from enclosingFunctionId (format: "Method:filePath:className:methodName")
  const parts = enclosingFunctionId.split(':');
  const methodName = parts.length >= 4 ? parts[3] : null;
  if (!methodName) return locals;

  // Find the method declaration node
  const methodNode = findMethodNode(rootNode, methodName);
  if (!methodNode) return locals;

  // Walk AST to find local variable declarations and parameters
  const walkNode = (node: Parser.SyntaxNode) => {
    // Extract local variable declarations
    if (node.type === 'local_variable_declaration') {
      const varDecl = parseLocalVariableDeclaration(node);
      if (varDecl) locals.push(varDecl);
    }

    // Extract formal parameters
    if (node.type === 'formal_parameter') {
      const param = parseFormalParameter(node);
      if (param) locals.push(param);
    }

    // Recurse into children
    for (const child of node.children) {
      walkNode(child);
    }
  };

  walkNode(methodNode);
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
 * Searches in current file first, then in imported files.
 */
const findClassByTypeName = (
  typeName: string,
  currentFile: string,
  symbolTable: SymbolTable,
): SymbolDefinition | null => {
  // Try same-file lookup first
  const localDef = symbolTable.lookupExactFull(currentFile, typeName);
  if (localDef && (localDef.type === 'Class' || localDef.type === 'Interface' || localDef.type === 'Enum')) {
    return localDef;
  }

  // Try fuzzy lookup across all files
  const allDefs = symbolTable.lookupFuzzy(typeName);
  const classDefs = allDefs.filter(def => def.type === 'Class' || def.type === 'Interface' || def.type === 'Enum');

  // Return first match (could be improved with import resolution)
  return classDefs.length > 0 ? classDefs[0] : null;
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
): JavaResolveResult | null => {
  // Find the enclosing class
  const enclosingClass = trackTime('findEnclosingClass', () =>
    findEnclosingClass(enclosingFunctionId, currentFile, graph)
  );
  if (!enclosingClass) return null;

  // Find field in class (supports inheritance)
  const fieldDef = trackTime('findFieldInClass', () =>
    findFieldInClass(enclosingClass.id, objectName, graph, symbolTable)
  );
  if (!fieldDef || !fieldDef.declaredType) return null;

  // Extract type name from declared type (strip generics if present)
  const typeName = extractTypeNameFromString(fieldDef.declaredType);
  if (!typeName) return null;

  // Find class by type name
  const classDef = trackTime('findClassByTypeName', () =>
    findClassByTypeName(typeName, currentFile, symbolTable)
  );
  if (!classDef) return null;

  // Find method in class
  const methodDef = trackTime('findMethodInClass', () =>
    symbolTable.findMethodInClass(classDef.nodeId, calledName)
  );
  if (!methodDef) return null;

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
  let classCandidates: SymbolDefinition[] = [];

  // Case A: Simple class name (e.g., "Utils")
  if (!objectName.includes('.')) {
    // Check if class is imported
    const importedFiles = importMap.get(currentFile);
    if (importedFiles) {
      // Lookup class in imported files
      const allClasses = symbolTable.lookupFuzzy(objectName);
      classCandidates = allClasses.filter(def =>
        (def.type === 'Class' || def.type === 'Interface' || def.type === 'Enum') &&
        importedFiles.has(def.filePath)
      );
    }
  }
  // Case B: Fully qualified name (e.g., "com.example.Utils")
  else {
    classCandidates = symbolTable.findSymbolsByQualifiedName(objectName);
  }

  // No class found
  if (classCandidates.length === 0) return null;

  // Try to find the method in each candidate class
  for (const classDef of classCandidates) {
    const methodDef = trackTime('findMethodInClass', () =>
      symbolTable.findMethodInClass(classDef.nodeId, calledName)
    );
    if (methodDef) {
      return {
        nodeId: methodDef.nodeId,
        confidence: 0.95,
        reason: 'static',
        filePath: methodDef.filePath,
        returnType: methodDef.returnType,
      };
    }
  }

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
  // Find the enclosing class
  const enclosingClass = trackTime('findEnclosingClass', () =>
    findEnclosingClass(enclosingFunctionId, currentFile, graph)
  );
  if (!enclosingClass) return null;

  // Find method in current class
  const methodDef = trackTime('findMethodInClass', () =>
    symbolTable.findMethodInClass(enclosingClass.id, calledName)
  );
  if (!methodDef) return null;

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
): JavaResolveResult | null => {
  // Find the enclosing class
  const enclosingClass = trackTime('findEnclosingClass', () =>
    findEnclosingClass(enclosingFunctionId, currentFile, graph)
  );
  if (!enclosingClass) return null;

  // Traverse parent class chain
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

      // Find EXTENDS edges using index (O(1) vs O(E))
      const edges = edgeIndex.bySource.get(currentClassId) || [];
      const extendsEdges = edges.filter(e => e.type === 'EXTENDS');

      for (const edge of extendsEdges) {
        const parentClassId = edge.targetId;

        // Try to find method in parent class
        const methodDef = trackTime('findMethodInClass', () =>
          symbolTable.findMethodInClass(parentClassId, calledName)
        );
        if (methodDef) {
          return {
            nodeId: methodDef.nodeId,
            confidence: 0.85,
            reason: 'super' as const,
            filePath: methodDef.filePath,
            returnType: methodDef.returnType,
          };
        }

        // Continue searching in grandparent classes
        queue.push(parentClassId);
      }
    }

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
