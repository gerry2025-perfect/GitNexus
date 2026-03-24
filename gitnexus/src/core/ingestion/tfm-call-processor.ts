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
  roots: string[],
  tfmReport?: boolean
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

  // Categorize failures for detailed reporting
  const failuresByReason = {
    noServiceName: [] as ExtractedTfmCall[],
    noXmlMatch: [] as { call: ExtractedTfmCall; serviceName: string }[],
    classNotFound: [] as { call: ExtractedTfmCall; serviceName: string; targetClass: string }[],
    methodNotFound: [] as { call: ExtractedTfmCall; serviceName: string; targetClass: string; targetMethod: string }[],
  };

  for (const call of tfmCalls) {
    if (!call.serviceName) {
      unresolvedCount++;
      failuresByReason.noServiceName.push(call);
      continue;
    }

    const serviceDef = serviceMap.get(call.serviceName);
    if (!serviceDef) {
      unresolvedCount++;
      failuresByReason.noXmlMatch.push({ call, serviceName: call.serviceName });
      continue;
    }

    // Resolve target class
    const targetClasses = symbolTable.findSymbolsByQualifiedName(serviceDef.targetClass);
    if (targetClasses.length === 0) {
      unresolvedCount++;
      failuresByReason.classNotFound.push({
        call,
        serviceName: call.serviceName,
        targetClass: serviceDef.targetClass
      });
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
      failuresByReason.methodNotFound.push({
        call,
        serviceName: call.serviceName,
        targetClass: serviceDef.targetClass,
        targetMethod: serviceDef.targetMethod
      });
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
      serviceName: call.serviceName || serviceDef.serviceName, // TFM service name
    });

    resolvedCount++;
  }

  // Report detailed failure statistics
  if (isDev || tfmReport) {
    const reportLines: string[] = [];

    reportLines.push(`\n[TFM] ========== Resolution Summary ==========`);
    reportLines.push(`[TFM] Total calls: ${tfmCalls.length}`);
    reportLines.push(`[TFM] Resolved: ${resolvedCount} (${((resolvedCount / tfmCalls.length) * 100).toFixed(1)}%)`);
    reportLines.push(`[TFM] Unresolved: ${unresolvedCount} (${((unresolvedCount / tfmCalls.length) * 100).toFixed(1)}%)`);
    reportLines.push(`\n[TFM] Failure breakdown:`);
    reportLines.push(`[TFM]   1. No serviceName extracted: ${failuresByReason.noServiceName.length}`);
    reportLines.push(`[TFM]   2. No XML file found: ${failuresByReason.noXmlMatch.length}`);
    reportLines.push(`[TFM]   3. Target class not found: ${failuresByReason.classNotFound.length}`);
    reportLines.push(`[TFM]   4. Target method not found: ${failuresByReason.methodNotFound.length}`);

    // Detailed failure logs
    if (failuresByReason.noServiceName.length > 0) {
      reportLines.push(`\n[TFM] ========== 1. Failed to extract serviceName (${failuresByReason.noServiceName.length}) ==========`);
      failuresByReason.noServiceName.forEach((call, idx) => {
        reportLines.push(`[TFM]   ${idx + 1}. ${call.filePath}:${call.callSite.startLine + 1}`);
        reportLines.push(`[TFM]      Variable: ${call.paramVarName}`);
        reportLines.push(`[TFM]      SourceId: ${call.sourceId}`);
      });
    }

    if (failuresByReason.noXmlMatch.length > 0) {
      reportLines.push(`\n[TFM] ========== 2. No XML file found (${failuresByReason.noXmlMatch.length}) ==========`);
      failuresByReason.noXmlMatch.forEach(({ call, serviceName }, idx) => {
        reportLines.push(`[TFM]   ${idx + 1}. Service: "${serviceName}"`);
        reportLines.push(`[TFM]      Called from: ${call.filePath}:${call.callSite.startLine + 1}`);
        reportLines.push(`[TFM]      Hint: Check if XML file exists: tfm_service/**/${serviceName}.xml`);
      });
    }

    if (failuresByReason.classNotFound.length > 0) {
      reportLines.push(`\n[TFM] ========== 3. Target class not found (${failuresByReason.classNotFound.length}) ==========`);
      failuresByReason.classNotFound.forEach(({ call, serviceName, targetClass }, idx) => {
        reportLines.push(`[TFM]   ${idx + 1}. Service: "${serviceName}"`);
        reportLines.push(`[TFM]      Target class: ${targetClass}`);
        reportLines.push(`[TFM]      Called from: ${call.filePath}:${call.callSite.startLine + 1}`);
        reportLines.push(`[TFM]      Hint: Class may not be indexed or package name mismatch`);
      });
    }

    if (failuresByReason.methodNotFound.length > 0) {
      reportLines.push(`\n[TFM] ========== 4. Target method not found (${failuresByReason.methodNotFound.length}) ==========`);
      failuresByReason.methodNotFound.forEach(({ call, serviceName, targetClass, targetMethod }, idx) => {
        reportLines.push(`[TFM]   ${idx + 1}. Service: "${serviceName}"`);
        reportLines.push(`[TFM]      Target: ${targetClass}.${targetMethod}()`);
        reportLines.push(`[TFM]      Called from: ${call.filePath}:${call.callSite.startLine + 1}`);
        reportLines.push(`[TFM]      Hint: Method may have different name or not exist in class`);
      });
    }

    reportLines.push(`\n[TFM] ==========================================\n`);

    // Output to file if tfmReport is enabled
    if (tfmReport) {
      const reportPath = path.join(roots[0], 'tfm-resolution-report.log');
      fs.writeFileSync(reportPath, reportLines.join('\n'), 'utf-8');
      if (isDev) {
        console.log(`[TFM] Detailed report written to: ${reportPath}`);
      }
    } else {
      // Output to console in dev mode
      reportLines.forEach(line => console.log(line));
    }
  }

  return {
    resolvedCalls: resolvedCount,
    unresolvedCalls: unresolvedCount,
    xmlFilesFound: serviceMap.size,
  };
}

/**
 * Scan all roots for tfm_service and subdirectories for XML files
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

    // Recursively scan all XML files in tfm_service and subdirectories
    const xmlFiles = await scanXmlFiles(tfmDir);

    for (const xmlPath of xmlFiles) {
      const serviceName = path.basename(xmlPath, '.xml');

      // Skip if already found in higher-priority root
      if (serviceMap.has(serviceName)) continue;

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
 * Recursively scan for *.xml files in a directory
 */
async function scanXmlFiles(dir: string): Promise<string[]> {
  const xmlFiles: string[] = [];

  async function scan(currentDir: string) {
    try {
      const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          // Recursively scan subdirectories
          await scan(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.xml')) {
          xmlFiles.push(fullPath);
        }
      }
    } catch (err) {
      if (isDev) {
        console.warn(`[TFM] Failed to scan directory ${currentDir}:`, err);
      }
    }
  }

  await scan(dir);
  return xmlFiles;
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
