import {LlmResponseFile} from '../shared-interfaces.js';

/**
 * Merges a set of new or updated files from a repair attempt into the
 * current set of files.
 * @param repairOutputFiles The array of new or updated files to merge.
 * @param finalFiles The array of files to be updated.
 */
export function mergeRepairFiles(
  repairOutputFiles: LlmResponseFile[],
  finalFiles: LlmResponseFile[],
) {
  // Merge the repair response into the original files. Otherwise we may end up dropping
  // files that were valid in the initial response and the LLM decided not to touch, because
  // they're still valid.
  for (const file of repairOutputFiles) {
    const existingFile = finalFiles.find(f => f.filePath === file.filePath);

    if (existingFile) {
      existingFile.code = file.code;
    } else {
      finalFiles.push(file);
    }
  }
}
