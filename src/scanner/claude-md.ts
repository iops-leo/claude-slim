import { countTokensCached } from '../tokenizer.js';

export function parseClaudeMdSections(
  content: string,
): Array<{ name: string; sizeBytes: number; tokens: number }> {
  const sections: Array<{ name: string; sizeBytes: number; tokens: number }> = [];
  const lines = content.split('\n');
  let currentName: string | null = null;
  let currentContent = '';

  for (const line of lines) {
    if (line.startsWith('# ')) {
      if (currentName !== null) {
        sections.push({
          name: currentName,
          sizeBytes: Buffer.byteLength(currentContent),
          tokens: countTokensCached(currentContent, `claude-md-section:${currentName}`),
        });
      } else if (currentContent.trim()) {
        sections.push({
          name: '(preamble)',
          sizeBytes: Buffer.byteLength(currentContent),
          tokens: countTokensCached(currentContent, 'claude-md-section:preamble'),
        });
      }
      currentName = line.slice(2).trim().slice(0, 60);
      currentContent = line + '\n';
    } else {
      currentContent += line + '\n';
    }
  }

  if (currentName !== null) {
    sections.push({
      name: currentName,
      sizeBytes: Buffer.byteLength(currentContent),
      tokens: countTokensCached(currentContent, `claude-md-section:${currentName}`),
    });
  } else if (currentContent.trim()) {
    sections.push({
      name: '(preamble)',
      sizeBytes: Buffer.byteLength(currentContent),
      tokens: countTokensCached(currentContent, 'claude-md-section:preamble'),
    });
  }

  return sections;
}
