import {ChildProcess, fork} from 'node:child_process';
import {
  BuildResult,
  BuildWorkerMessage,
  BuildWorkerResponseMessage,
} from '../../workers/builder/builder-types.js';
import {LlmGenerateFilesContext, LlmRunner} from '../../codegen/llm-runner.js';
import {
  RootPromptDefinition,
  LlmContextFile,
  LlmResponse,
  LlmResponseFile,
  TestResult,
} from '../../shared-interfaces.js';
import {generateCodeWithAI} from '../codegen.js';
import {EvalID, Gateway} from '../gateway.js';
import path from 'node:path';
import {killChildProcessGracefully} from '../../utils/kill-gracefully.js';
import {ProgressLogger} from '../../progress/progress-logger.js';
import {serveApp} from '../../workers/serve-testing/serve-app.js';
import {LocalEnvironment} from '../../configuration/environment-local.js';
import PQueue from 'p-queue';

let uniqueIDs = 0;

export class LocalGateway implements Gateway<LocalEnvironment> {
  constructor(private llm: LlmRunner) {}

  async initializeEval(): Promise<EvalID> {
    return `${uniqueIDs++}` as EvalID;
  }

  async generateInitialFiles(
    _id: EvalID,
    requestCtx: LlmGenerateFilesContext,
    model: string,
    contextFiles: LlmContextFile[],
    abortSignal: AbortSignal,
  ): Promise<LlmResponse> {
    return await generateCodeWithAI(this.llm, model, requestCtx, contextFiles, abortSignal);
  }

  async repairBuild(
    _id: EvalID,
    requestCtx: LlmGenerateFilesContext,
    model: string,
    errorMessage: string,
    appFiles: LlmResponseFile[],
    contextFiles: LlmContextFile[],
    abortSignal: AbortSignal,
  ): Promise<LlmResponse> {
    return await generateCodeWithAI(this.llm, model, requestCtx, contextFiles, abortSignal);
  }

  async repairTest(
    _id: EvalID,
    requestCtx: LlmGenerateFilesContext,
    model: string,
    errorMessage: string,
    appFiles: LlmResponseFile[],
    contextFiles: LlmContextFile[],
    abortSignal: AbortSignal,
  ): Promise<LlmResponse> {
    return await generateCodeWithAI(this.llm, model, requestCtx, contextFiles, abortSignal);
  }

  tryBuild(
    _id: EvalID,
    env: LocalEnvironment,
    appDirectoryPath: string,
    rootPromptDef: RootPromptDefinition,
    workerConcurrencyQueue: PQueue,
    abortSignal: AbortSignal,
    progress: ProgressLogger,
  ): Promise<BuildResult> {
    const buildParams: BuildWorkerMessage = {
      directory: appDirectoryPath,
      appName: rootPromptDef.name,
      buildCommand: env.buildCommand,
    };

    return workerConcurrencyQueue.add(
      () =>
        new Promise<BuildResult>((resolve, reject) => {
          const child: ChildProcess = fork(
            path.resolve(import.meta.dirname, '../../workers/builder/worker.js'),
            {signal: abortSignal},
          );
          child.send(buildParams);

          child.on('message', async (result: BuildWorkerResponseMessage) => {
            await killChildProcessGracefully(child);
            resolve(result.payload);
          });
          child.on('error', async err => {
            await killChildProcessGracefully(child);
            reject(err);
          });
        }),
      {throwOnTimeout: true},
    );
  }

  tryTest(
    _id: EvalID,
    env: LocalEnvironment,
    appDirectoryPath: string,
    rootPromptDef: RootPromptDefinition,
    workerConcurrencyQueue: PQueue,
    abortSignal: AbortSignal,
    progress: ProgressLogger,
  ): Promise<TestResult> {
    const testParams = {
      directory: appDirectoryPath,
      appName: rootPromptDef.name,
      testCommand: env.testCommand,
    };

    return workerConcurrencyQueue.add(
      () =>
        new Promise<TestResult>((resolve, reject) => {
          const child: ChildProcess = fork(
            path.resolve(import.meta.dirname, '../../workers/test/worker.js'),
            {signal: abortSignal},
          );
          child.send(testParams);

          child.on('message', async (result: any) => {
            await killChildProcessGracefully(child);
            resolve(result.payload);
          });
          child.on('error', async err => {
            await killChildProcessGracefully(child);
            reject(err);
          });
        }),
      {throwOnTimeout: true},
    );
  }

  async serveBuild<T>(
    _id: EvalID,
    env: LocalEnvironment,
    appDirectoryPath: string,
    rootPromptDef: RootPromptDefinition,
    progress: ProgressLogger,
    logicWhileServing: (serveUrl: string) => Promise<T>,
  ): Promise<T> {
    return await serveApp(
      env.serveCommand,
      rootPromptDef,
      appDirectoryPath,
      progress,
      logicWhileServing,
    );
  }

  shouldRetryFailedBuilds(): boolean {
    return this.llm.hasBuiltInRepairLoop === false;
  }

  shouldRetryFailedTests(): boolean {
    return this.llm.hasBuiltInRepairLoop === false;
  }

  async finalizeEval(_id: EvalID): Promise<void> {}
}
