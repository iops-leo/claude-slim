import { countTokensCached } from '../tokenizer.js';
export function parseClaudeMdSections(content) {
    const sections = [];
    const lines = content.split('\n');
    let currentName = null;
    let currentContent = '';
    for (const line of lines) {
        if (line.startsWith('# ')) {
            if (currentName !== null) {
                sections.push({
                    name: currentName,
                    sizeBytes: Buffer.byteLength(currentContent),
                    tokens: countTokensCached(currentContent, `claude-md-section:${currentName}`),
                });
            }
            else if (currentContent.trim()) {
                sections.push({
                    name: '(preamble)',
                    sizeBytes: Buffer.byteLength(currentContent),
                    tokens: countTokensCached(currentContent, 'claude-md-section:preamble'),
                });
            }
            currentName = line.slice(2).trim().slice(0, 60);
            currentContent = line + '\n';
        }
        else {
            currentContent += line + '\n';
        }
    }
    if (currentName !== null) {
        sections.push({
            name: currentName,
            sizeBytes: Buffer.byteLength(currentContent),
            tokens: countTokensCached(currentContent, `claude-md-section:${currentName}`),
        });
    }
    else if (currentContent.trim()) {
        sections.push({
            name: '(preamble)',
            sizeBytes: Buffer.byteLength(currentContent),
            tokens: countTokensCached(currentContent, 'claude-md-section:preamble'),
        });
    }
    return sections;
}
