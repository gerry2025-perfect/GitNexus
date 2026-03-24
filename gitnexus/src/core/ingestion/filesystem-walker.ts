import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';
import { createIgnoreFilter } from '../../config/ignore-service.js';

export interface FileEntry {
  path: string;
  content: string;
}

/** Lightweight entry — path + size from stat, no content in memory */
export interface ScannedFile {
  path: string;
  size: number;
  root: string;  // Which root directory this file belongs to
}

/** Path-only reference (for type signatures) */
export interface FilePath {
  path: string;
}

const READ_CONCURRENCY = 32;

/** Skip files larger than 512KB — they're usually generated/vendored and crash tree-sitter */
const MAX_FILE_SIZE = 512 * 1024;

/**
 * Phase 1: Scan repository — stat files to get paths + sizes, no content loaded.
 * Memory: ~10MB for 100K files vs ~1GB+ with content.
 * Supports multi-directory indexing via array input.
 */
export const walkRepositoryPaths = async (
  repoPath: string | string[],
  onProgress?: (current: number, total: number, filePath: string) => void
): Promise<ScannedFile[]> => {
  const roots = Array.isArray(repoPath) ? repoPath : [repoPath];
  const allEntries: ScannedFile[] = [];
  let globalProcessed = 0;
  let globalTotal = 0;

  // First pass: count total files across all roots
  const rootFileCounts: number[] = [];
  for (const root of roots) {
    const ignoreFilter = await createIgnoreFilter(root);
    const filtered = await glob('**/*', {
      cwd: root,
      nodir: true,
      dot: false,
      ignore: ignoreFilter,
    });
    rootFileCounts.push(filtered.length);
    globalTotal += filtered.length;
  }

  // Second pass: scan each root
  for (let rootIdx = 0; rootIdx < roots.length; rootIdx++) {
    const root = roots[rootIdx];
    const ignoreFilter = await createIgnoreFilter(root);

    const filtered = await glob('**/*', {
      cwd: root,
      nodir: true,
      dot: false,
      ignore: ignoreFilter,
    });

    let skippedLarge = 0;

    for (let start = 0; start < filtered.length; start += READ_CONCURRENCY) {
      const batch = filtered.slice(start, start + READ_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async relativePath => {
          const fullPath = path.join(root, relativePath);
          const stat = await fs.stat(fullPath);
          if (stat.size > MAX_FILE_SIZE) {
            skippedLarge++;
            return null;
          }
          return {
            path: relativePath.replace(/\\/g, '/'),
            size: stat.size,
            root  // Track which root this file belongs to
          };
        })
      );

      for (const result of results) {
        globalProcessed++;
        if (result.status === 'fulfilled' && result.value !== null) {
          allEntries.push(result.value);
          onProgress?.(globalProcessed, globalTotal, result.value.path);
        } else {
          const failedPath = batch[results.indexOf(result)];
          onProgress?.(globalProcessed, globalTotal, failedPath);
        }
      }
    }

    if (skippedLarge > 0 && process.env.GITNEXUS_VERBOSE) {
      console.warn(`  [Root ${rootIdx + 1}/${roots.length}] Skipped ${skippedLarge} files > 512KB`);
    }
  }

  return allEntries;
};

/**
 * Phase 2: Read file contents for a specific set of relative paths.
 * Returns a Map for O(1) lookup. Silently skips files that fail to read.
 */
export const readFileContents = async (
  repoPath: string,
  relativePaths: string[],
): Promise<Map<string, string>> => {
  const contents = new Map<string, string>();

  for (let start = 0; start < relativePaths.length; start += READ_CONCURRENCY) {
    const batch = relativePaths.slice(start, start + READ_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async relativePath => {
        const fullPath = path.join(repoPath, relativePath);
        const content = await fs.readFile(fullPath, 'utf-8');
        return { path: relativePath, content };
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        contents.set(result.value.path, result.value.content);
      }
    }
  }

  return contents;
};

/**
 * Legacy API — scans and reads everything into memory.
 * Used by sequential fallback path only.
 */
export const walkRepository = async (
  repoPath: string,
  onProgress?: (current: number, total: number, filePath: string) => void
): Promise<FileEntry[]> => {
  const scanned = await walkRepositoryPaths(repoPath, onProgress);
  const contents = await readFileContents(repoPath, scanned.map(f => f.path));
  return scanned
    .filter(f => contents.has(f.path))
    .map(f => ({ path: f.path, content: contents.get(f.path)! }));
};
