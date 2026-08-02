import { describe, it, expect } from 'vitest';
import { detectBackupArtifact } from '../scanner/backup-artifacts.js';

/**
 * The entire value of this detector rests on not crying wolf. A false positive
 * tells someone their working skill is disposable, which is worse than missing
 * a stale copy — so the negative cases below matter more than the positive ones.
 */

describe('detectBackupArtifact — real artifacts', () => {
  const artifacts: Array<[string, string]> = [
    ['humanize-korean.bak.20260711-100101', '.bak'],
    ['my-skill.bak', '.bak'],
    ['my-skill.backup', '.backup'],
    ['my-skill.orig', '.orig'],
    ['my-skill.old', '.old'],
    ['my-skill.save', '.save'],
    ['my-skill.disabled', '.disabled'],
    ['my-skill.20260711', 'timestamp suffix'],
    ['my-skill.20260711-100101', 'timestamp suffix'],
    ['my-skill-2026-07-11', 'dated suffix'],
    ['my-skill~', 'editor backup'],
    ['my-skill copy', 'copy suffix'],
    ['my-skill-copy', 'copy suffix'],
    ['my-skill (copy)', 'copy suffix'],
    ['Copy of my-skill', 'copy-of prefix'],
    ['my-skill (1)', 'numbered duplicate'],
  ];

  for (const [name, label] of artifacts) {
    it(`flags ${name}`, () => {
      expect(detectBackupArtifact(name)?.label).toBe(label);
    });
  }
});

describe('detectBackupArtifact — legitimate skills it must never flag', () => {
  const legitimate = [
    // The words appear, but as topic vocabulary rather than artifact markers.
    'backup-manager',
    'backup',
    'db-backup-runner',
    'test-engineer',
    'old-school-linter',
    'oldest-first',
    'copywriter',
    'copy-editor',
    'photocopy-ocr',
    'save-the-date',
    'savepoint-tool',
    'disabled-plugin-finder',
    'original-research',
    'baker',
    'bakery-api',
    // Ordinary names with digits or punctuation that must not read as dates.
    'gpt-5',
    'claude-3-opus',
    'v2-migration',
    'skill-2000',
    'ipv6-checker',
    'utf-8-fixer',
    'humanize-korean',
    'ask-gemini',
    'code-review',
  ];

  for (const name of legitimate) {
    it(`leaves ${name} alone`, () => {
      expect(detectBackupArtifact(name)).toBeNull();
    });
  }
});

describe('detectBackupArtifact — boundaries', () => {
  it('requires .bak to be its own dotted segment', () => {
    expect(detectBackupArtifact('foo.bak')).not.toBeNull();
    expect(detectBackupArtifact('foo.bak.1')).not.toBeNull();
    // "bakery" starts with bak but is not a .bak segment.
    expect(detectBackupArtifact('foo.bakery')).toBeNull();
  });

  it('requires copy to be trailing, not embedded', () => {
    expect(detectBackupArtifact('report-copy')).not.toBeNull();
    expect(detectBackupArtifact('copy-machine-driver')).toBeNull();
  });

  it('requires a full 8-digit date, not any run of digits', () => {
    expect(detectBackupArtifact('skill.20260711')).not.toBeNull();
    expect(detectBackupArtifact('skill.2026')).toBeNull();
    expect(detectBackupArtifact('skill.123')).toBeNull();
  });

  it('is case-insensitive for word markers', () => {
    expect(detectBackupArtifact('Skill.BAK')).not.toBeNull();
    expect(detectBackupArtifact('Skill.Backup')).not.toBeNull();
  });

  it('handles empty and odd input without throwing', () => {
    expect(detectBackupArtifact('')).toBeNull();
    expect(detectBackupArtifact('.')).toBeNull();
    expect(detectBackupArtifact('...')).toBeNull();
  });
});
