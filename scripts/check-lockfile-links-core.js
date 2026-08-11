import path from 'node:path';

export function findExternalLinks(lockfileText) {
  const violations = [];
  let inImporters = false;
  let currentImporter = '.';

  lockfileText.split('\n').forEach((line, index) => {
    if (/^importers:\s*$/.test(line)) {
      inImporters = true;
      currentImporter = '.';
      return;
    }
    if (inImporters && /^[^\s#]/.test(line)) inImporters = false;
    if (!inImporters) return;

    const importerMatch = line.match(/^ {2}(\S.*?):\s*$/);
    if (importerMatch) {
      currentImporter = importerMatch[1].replace(/['"]/g, '');
      return;
    }

    const linkMatch = line.match(/link:(\S+)/);
    if (!linkMatch) return;

    const target = linkMatch[1].replace(/['"]/g, '');
    const resolved = path.posix.normalize(path.posix.join(currentImporter, target));
    if (resolved.startsWith('..')) {
      violations.push({
        line: index + 1,
        importer: currentImporter,
        target,
        raw: line.trim(),
      });
    }
  });

  return violations;
}
