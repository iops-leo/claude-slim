import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { countTokensCached } from '../tokenizer.js';
import { getProjectsDir } from '../paths.js';
import type { MemoryFile } from '../types.js';
import { safeReadFile, safeReaddir } from './fs-walk.js';
import {
  STALE_DAYS, MEMORY_INDEX_FILE, MEMORY_INDEX_MAX_LINES, MEMORY_INDEX_MAX_BYTES,
} from './constants.js';

export interface StaleProject {
  project: string;
  path: string;
  ageDays: number;
  fileCount: number;
  totalBytes: number;
}

export interface MemoryScanResult {
  memoryFiles: MemoryFile[];
  staleProjects: StaleProject[];
}

/**
 * The part of MEMORY.md a session actually receives: the first 200 lines or
 * the first 25KB, whichever ends sooner. Everything past that is on disk but
 * never in context — which is worth flagging, because an index that has
 * quietly stopped listing its newest entries defeats its purpose.
 */
export function memoryIndexStartupSlice(content: string): { text: string; truncated: boolean } {
  const lines = content.split('\n');
  // A trailing newline yields an empty final element, not an extra line.
  const lineCount = content.endsWith('\n') ? lines.length - 1 : lines.length;
  let text = content;
  let truncated = false;
  if (lineCount > MEMORY_INDEX_MAX_LINES) {
    text = lines.slice(0, MEMORY_INDEX_MAX_LINES).join('\n');
    truncated = true;
  }
  const bytes = Buffer.from(text);
  if (bytes.length > MEMORY_INDEX_MAX_BYTES) {
    // Back off to a character boundary so the slice does not end in a torn
    // multibyte sequence (a U+FFFD that was never in the file).
    let cut = MEMORY_INDEX_MAX_BYTES;
    while (cut > 0 && (bytes[cut] & 0xc0) === 0x80) cut--;
    text = bytes.subarray(0, cut).toString('utf-8');
    truncated = true;
  }
  return { text, truncated };
}

export async function scanMemoryFiles(): Promise<MemoryScanResult> {
  const memoryFiles: MemoryFile[] = [];
  const staleProjects: StaleProject[] = [];

  const projectsDir = getProjectsDir();
  const projectDirs = await safeReaddir(projectsDir);
  const now = Date.now();

  const scanPromises = projectDirs.map(async (project) => {
    const memDir = join(projectsDir, project, 'memory');
    const files = await safeReaddir(memDir);
    const mdFiles = files.filter((f) => f.endsWith('.md'));

    let newestMtime = 0;
    let totalBytes = 0;

    for (const file of mdFiles) {
      const filePath = join(memDir, file);
      const content = await safeReadFile(filePath);
      if (content !== null) {
        const sizeBytes = Buffer.byteLength(content);
        // Case-insensitive: on APFS `memory.md` is the file Claude Code loads.
        const isIndex = file.toLowerCase() === MEMORY_INDEX_FILE.toLowerCase();
        const tokens = countTokensCached(content, filePath);
        let startupTokens = 0;
        let truncated = false;
        if (isIndex) {
          const slice = memoryIndexStartupSlice(content);
          truncated = slice.truncated;
          startupTokens = truncated
            ? countTokensCached(slice.text, `${filePath}#startup`)
            : tokens;
        }
        memoryFiles.push({
          project,
          name: file,
          path: filePath,
          sizeBytes,
          tokens,
          isIndex,
          startupTokens,
          truncated,
        });
        totalBytes += sizeBytes;

        try {
          const s = await stat(filePath);
          if (s.mtimeMs > newestMtime) newestMtime = s.mtimeMs;
        } catch { /* skip */ }
      }
    }

    // Check for stale project (no files modified in 90+ days)
    if (mdFiles.length > 0 && newestMtime > 0) {
      const ageDays = Math.floor((now - newestMtime) / (1000 * 60 * 60 * 24));
      if (ageDays > STALE_DAYS) {
        staleProjects.push({ project, path: memDir, ageDays, fileCount: mdFiles.length, totalBytes });
      }
    }
  });

  await Promise.all(scanPromises);
  return { memoryFiles, staleProjects };
}
