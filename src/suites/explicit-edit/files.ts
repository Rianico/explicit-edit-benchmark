import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** Materialize fixture files. The caller owns the destination directory. */
export async function writeFiles(
  directory: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(directory, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

/** Compare file bytes without following symlinks or ignoring extra files, including .git. */
export async function compareExplicitFiles(
  directory: string,
  expected: Readonly<Record<string, string>>,
) {
  const actual = new Set<string>();
  const differingFiles: string[] = [];
  const unexpectedFiles: string[] = [];
  const invalidEntries: string[] = [];
  async function visit(relative: string): Promise<void> {
    for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) {
        if (!Object.keys(expected).some((file) => file.startsWith(`${name}/`)))
          unexpectedFiles.push(`${name}/`);
        await visit(name);
      } else if (!entry.isFile()) {
        invalidEntries.push(name);
      } else {
        actual.add(name);
        const target = expected[name];
        if (target === undefined) unexpectedFiles.push(name);
        else if (!(await readFile(path.join(directory, name))).equals(Buffer.from(target)))
          differingFiles.push(name);
      }
    }
  }
  await visit("");
  const missingFiles = Object.keys(expected).filter((name) => !actual.has(name));
  return {
    exactMatch: [differingFiles, unexpectedFiles, missingFiles, invalidEntries].every(
      (files) => files.length === 0,
    ),
    differingFiles: differingFiles.sort(),
    unexpectedFiles: unexpectedFiles.sort(),
    missingFiles: missingFiles.sort(),
    invalidEntries: invalidEntries.sort(),
  };
}
