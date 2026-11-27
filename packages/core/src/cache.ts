import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ModuleInfo, ParseCache } from '@testimpact/dependency-analyzer';
import { VERSION } from './version.js';

interface CacheEntry {
  hash: string;
  mtimeMs: number;
  size: number;
  info: ModuleInfo;
}

interface CacheFile {
  format: 1;
  toolVersion: string;
  optionsKey: string;
  entries: Record<string, CacheEntry>;
}

/**
 * On-disk cache of parsed module information. Stored under the project's cache directory
 * (default `.testimpact/cache`), which TestImpact marks as ignored with its own .gitignore.
 * Entries are keyed by path and validated by size, mtime and content hash.
 */
export class DiskParseCache implements ParseCache {
  private entries = new Map<string, CacheEntry>();
  private dirty = false;
  private loaded = false;
  readonly file: string;

  constructor(
    private readonly directory: string,
    private readonly optionsKey: string,
  ) {
    this.file = path.join(directory, 'parse-cache.json');
  }

  static optionsKey(options: unknown): string {
    return createHash('sha1').update(JSON.stringify(options)).digest('hex').slice(0, 16);
  }

  async load(): Promise<number> {
    this.loaded = true;
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8')) as CacheFile;
      if (raw.format !== 1 || raw.toolVersion !== VERSION || raw.optionsKey !== this.optionsKey) return 0;
      this.entries = new Map(Object.entries(raw.entries));
    } catch {
      this.entries = new Map();
    }
    return this.entries.size;
  }

  get(file: string): CacheEntry | undefined {
    return this.entries.get(file);
  }

  set(file: string, entry: CacheEntry): void {
    this.entries.set(file, entry);
    this.dirty = true;
  }

  /** Drop entries for files that are no longer part of the project. */
  prune(keep: ReadonlySet<string>): void {
    for (const key of this.entries.keys()) {
      if (!keep.has(key)) {
        this.entries.delete(key);
        this.dirty = true;
      }
    }
  }

  get size(): number {
    return this.entries.size;
  }

  async save(): Promise<void> {
    if (!this.loaded || !this.dirty) return;
    await fs.mkdir(this.directory, { recursive: true });
    const top = path.dirname(this.directory);
    // Keep the cache out of version control without touching the project's own .gitignore.
    for (const dir of [this.directory, path.basename(top) === '.testimpact' ? top : undefined]) {
      if (!dir) continue;
      const ignore = path.join(dir, '.gitignore');
      try {
        await fs.access(ignore);
      } catch {
        await fs.writeFile(ignore, '*\n');
      }
    }
    const data: CacheFile = { format: 1, toolVersion: VERSION, optionsKey: this.optionsKey, entries: Object.fromEntries(this.entries) };
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data));
    await fs.rename(tmp, this.file);
    this.dirty = false;
  }
}
