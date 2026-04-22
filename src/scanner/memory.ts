import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { countTokensCached } from '../tokenizer.js';
import { getProjectsDir } from '../paths.js';
import type { MemoryFile } from '../types.js';
import { safeReadFile, safeReaddir } from './fs-walk.js';
import { STALE_DAYS } from './constants.js';

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
        memoryFiles.push({
          project,
          name: file,
          path: filePath,
          sizeBytes,
          tokens: countTokensCached(content, filePath),
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
