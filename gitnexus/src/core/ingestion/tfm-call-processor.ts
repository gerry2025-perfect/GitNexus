import fs from 'node:fs';
import path from 'node:path';
import { KnowledgeGraph } from '../graph/types.js';
import type { SymbolTable } from './symbol-table.js';
import type { ExtractedTfmCall, ExtractedTfmServiceDef } from './workers/parse-worker.js';
import { generateId } from '../../lib/utils.js';
import xml2js from 'xml2js';

const isDev = process.env.NODE_ENV === 'development';

export interface TfmProcessingResult {
  resolvedCalls: number;
  unresolvedCalls: number;
  xmlFilesFound: number;
}

/**
 * Process TFM service calls and generate CALLS relationships
 *
 * @param graph - Knowledge graph to add relationships
 * @param symbolTable - Symbol table for resolving Java classes/methods
 * @param tfmCalls - Extracted TFM calls from Java code
 * @param tfmServiceDefs - Extracted service definitions from XML (if parsing XML in workers)
 * @param roots - All indexed root directories (for multi-layer XML search)
 * @returns Processing statistics
 */
export async function processTfmCalls(
  graph: KnowledgeGraph,
  symbolTable: SymbolTable,
  tfmCalls: ExtractedTfmCall[],
  tfmServiceDefs: ExtractedTfmServiceDef[],
  roots: string[]
): Promise<TfmProcessingResult> {
  if (tfmCalls.length === 0) {
    return { resolvedCalls: 0, unresolvedCalls: 0, xmlFilesFound: 0 };
  }

  if (isDev) {
    console.log(`[TFM] Processing ${tfmCalls.length} TFM calls...`);
    console.log(`[TFM] Searching in ${roots.length} root(s): ${roots.join(', ')}`);
  }

  // Build service name → definition map from XML files
  const serviceMap = await buildServiceMap(roots);

  if (isDev) {
    console.log(`[TFM] Found ${serviceMap.size} XML service definitions`);
  }

  let resolvedCount = 0;
  let unresolvedCount = 0;

  for (const call of tfmCalls) {
    if (!call.serviceName) {
      unresolvedCount++;
      continue;
    }

    const serviceDef = serviceMap.get(call.serviceName);
    if (!serviceDef) {
      unresolvedCount++;
      if (isDev) {
        console.log(`[TFM] No XML found for service: ${call.serviceName}`);
      }
      continue;
    }

    // Resolve target class
    const targetClasses = symbolTable.findSymbolsByQualifiedName(serviceDef.targetClass);
    if (targetClasses.length === 0) {
      unresolvedCount++;
      if (isDev) {
        console.log(`[TFM] Class not found: ${serviceDef.targetClass}`);
      }
      continue;
    }

    // Apply layer priority: prefer definitions from earlier roots
    const prioritized = prioritizeByRoot(targetClasses, roots);
    const targetClassDef = prioritized[0];

    // Resolve target method
    const targetMethod = symbolTable.findMethodInClass(
      targetClassDef.nodeId,
      serviceDef.targetMethod
    );

    if (!targetMethod) {
      unresolvedCount++;
      if (isDev) {
        console.log(`[TFM] Method not found: ${serviceDef.targetClass}.${serviceDef.targetMethod}`);
      }
      continue;
    }

    // Generate CALLS relationship
    const relId = generateId('CALLS', `${call.sourceId}->${targetMethod.nodeId}-tfm`);
    graph.addRelationship({
      id: relId,
      sourceId: call.sourceId,
      targetId: targetMethod.nodeId,
      type: 'CALLS',
      confidence: 0.95,
      reason: 'tfm-service-resolution',
    });

    resolvedCount++;

    if (isDev) {
      console.log(`[TFM] Resolved: ${call.serviceName} → ${serviceDef.targetClass}.${serviceDef.targetMethod}`);
    }
  }

  return {
    resolvedCalls: resolvedCount,
    unresolvedCalls: unresolvedCount,
    xmlFilesFound: serviceMap.size,
  };
}

/**
 * Scan all roots for tfm_service/*.xml files and parse them
 */
async function buildServiceMap(roots: string[]): Promise<Map<string, ExtractedTfmServiceDef>> {
  const serviceMap = new Map<string, ExtractedTfmServiceDef>();
  const parser = new xml2js.Parser();

  for (const root of roots) {
    const tfmDir = path.join(root, 'tfm_service');

    try {
      const stat = await fs.promises.stat(tfmDir);
      if (!stat.isDirectory()) continue;
    } catch {
      continue; // tfm_service directory doesn't exist in this root
    }

    const xmlFiles = await fs.promises.readdir(tfmDir);

    for (const xmlFile of xmlFiles) {
      if (!xmlFile.endsWith('.xml')) continue;

      const serviceName = xmlFile.replace('.xml', '');

      // Skip if already found in higher-priority root
      if (serviceMap.has(serviceName)) continue;

      const xmlPath = path.join(tfmDir, xmlFile);

      try {
        const content = await fs.promises.readFile(xmlPath, 'utf-8');
        const parsed = await parser.parseStringPromise(content);

        const serviceDef = extractServiceDef(parsed, serviceName, root);
        if (serviceDef) {
          serviceMap.set(serviceName, serviceDef);
        }
      } catch (err) {
        if (isDev) {
          console.warn(`[TFM] Failed to parse ${xmlPath}:`, err);
        }
      }
    }
  }

  return serviceMap;
}

/**
 * Extract service definition from parsed XML
 * Handles 2-3 levels of nesting: data/tfm_service_cat/tfm_service_cat/service
 */
function extractServiceDef(
  parsed: any,
  serviceName: string,
  sourceRoot: string
): ExtractedTfmServiceDef | null {
  const findService = (obj: any): any => {
    if (!obj) return null;
    if (obj.service) return obj.service;
    if (obj.tfm_service_cat) {
      if (Array.isArray(obj.tfm_service_cat)) {
        for (const cat of obj.tfm_service_cat) {
          const found = findService(cat);
          if (found) return found;
        }
      } else {
        return findService(obj.tfm_service_cat);
      }
    }
    return null;
  };

  const service = findService(parsed.data || parsed);
  if (!service) return null;

  // Handle both array and single object
  const serviceObj = Array.isArray(service) ? service[0] : service;

  const targetClass = serviceObj.definition?.[0];
  const targetMethod = serviceObj.method_def?.[0] || 'perform';

  if (!targetClass) return null;

  return {
    serviceName,
    targetClass,
    targetMethod,
    sourceRoot,
  };
}

/**
 * Prioritize symbol definitions by root order
 * Earlier roots have higher priority (customization > common > product)
 */
function prioritizeByRoot(
  symbols: Array<{ filePath: string; [key: string]: any }>,
  roots: string[]
): Array<{ filePath: string; [key: string]: any }> {
  const withPriority = symbols.map(symbol => {
    let rootIndex = roots.length; // Default to lowest priority

    for (let i = 0; i < roots.length; i++) {
      // Check if symbol's file path starts with this root
      const normalizedPath = symbol.filePath.replace(/\\/g, '/');
      const normalizedRoot = roots[i].replace(/\\/g, '/');

      if (normalizedPath.startsWith(normalizedRoot)) {
        rootIndex = i;
        break;
      }
    }

    return { symbol, rootIndex };
  });

  // Sort by priority (lower index = higher priority)
  withPriority.sort((a, b) => a.rootIndex - b.rootIndex);

  return withPriority.map(item => item.symbol);
}
