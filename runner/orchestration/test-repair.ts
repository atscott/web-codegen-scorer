import PQueue from 'p-queue';
import {
  AttemptDetails,
  LlmContextFile,
  LlmResponse,
  LlmResponseFile,
  RootPromptDefinition,
} from '../shared-interfaces.js';
import {Environment} from '../configuration/environment.js';
import {writeResponseFiles} from './file-system.js';
import {ProgressLogger} from '../progress/progress-logger.js';
import {EvalID, Gateway} from './gateway.js';
import {runTest} from './test-worker.js';
import {repairCodeWithAI} from './codegen.js';
import {BuildResultStatus} from '../workers/builder/builder-types.js';
import {mergeRepairFiles} from './repair.js';

/**
 * Calls the LLM to repair code, handles the response, and attempts to build the project again.
 *
 * @param evalID ID of the eval being executed.
 * @param gateway Gateway.
 * @param model The model name to use for the repair.
 * @param env The environment configuration.
 * @param directory The working directory.
 * @param finalOutputFiles The list of output files to be modified.
 * @param errorMessage The error message from the failed build.
 * @param errorContext Additional context for the error.
 * @param contextFiles A list of context files for the LLM.
 * @param abortSignal An AbortSignal to cancel the operation.
 * @param workerConcurrencyQueue The queue for managing worker concurrency.
 * @param attempts The current attempt number.
 * @returns A promise that resolves to the new BuildResult.
 */
export async function repairAndTest(
  evalID: EvalID,
  gateway: Gateway<Environment>,
  model: string,
  env: Environment,
  rootPromptDef: RootPromptDefinition,
  directory: string,
  finalOutputFiles: LlmResponseFile[],
  errorMessage: string,
  errorContext: string,
  contextFiles: LlmContextFile[],
  abortSignal: AbortSignal,
  workerConcurrencyQueue: PQueue,
  attempts: number,
  progress: ProgressLogger,
): Promise<AttemptDetails> {
  const repairResponse = await repairCodeWithAI(
    evalID,
    gateway.repairTest.bind(gateway),
    model,
    env,
    rootPromptDef,
    directory,
    finalOutputFiles,
    errorMessage,
    errorContext,
    contextFiles,
    abortSignal,
    progress,
  );

  return await handleRepairResponse(
    evalID,
    gateway,
    repairResponse,
    finalOutputFiles,
    env,
    rootPromptDef,
    directory,
    workerConcurrencyQueue,
    abortSignal,
    attempts,
    progress,
  );
}

/**
 * Processes an LLM repair response by merging the suggested file changes,
 * writing them to disk, rebuilding the application, and logging the outcome.
 */
async function handleRepairResponse(
  evalID: EvalID,
  gateway: Gateway<Environment>,
  repairResponse: LlmResponse,
  finalOutputFiles: LlmResponseFile[],
  env: Environment,
  rootPromptDef: RootPromptDefinition,
  directory: string,
  workerConcurrencyQueue: PQueue,
  abortSignal: AbortSignal,
  attempts: number,
  progress: ProgressLogger,
) {
  if (!repairResponse.success) {
    progress.log(
      rootPromptDef,
      'error',
      `AI failed to generate a response for repair attempt #${attempts + 1}`,
    );

    // Stop trying to repair if AI can't suggest a fix (API request fails)
    throw new Error(`Repair request failed: ${repairResponse.errors.join('\n')}`);
  }
  mergeRepairFiles(repairResponse.outputFiles, finalOutputFiles);
  writeResponseFiles(directory, finalOutputFiles, env, rootPromptDef.name);

  const testResult = await runTest(
    evalID,
    gateway,
    directory,
    env,
    rootPromptDef,
    abortSignal,
    workerConcurrencyQueue,
    progress,
  );

  return {
    // Log the `outputFiles` from the repair response specifically, because
    // we want a snapshot after the current API call, not the full file set.
    outputFiles: repairResponse.outputFiles,
    usage: repairResponse.usage,
    reasoning: repairResponse.reasoning,
    buildResult: {
      status: BuildResultStatus.SUCCESS,
      message: '',
    },
    testResult,
    serveTestingResult: null,
    attempt: attempts,
  };
}
