import {executeCommand} from '../../utils/exec.js';
import {callWithTimeout} from '../../utils/timeout.js';
import {TestWorkerMessage} from './test-types.js';
import {TestResult} from '../../shared-interfaces.js';
import {cleanupBuildMessage} from '../builder/worker.js';

process.on('message', async (message: TestWorkerMessage) => {
  const {appName, directory, testCommand} = message;

  let output: string;
  let passed: boolean;

  try {
    // Run the test command inside the temporary project directory
    const stdout = await callWithTimeout(
      `Testing ${appName}`,
      abortSignal => executeCommand(testCommand, directory, undefined, {abortSignal}),
      4, // 4min. This is a safety boundary. Lots of parallelism can slow-down.
    );
    output = cleanupBuildMessage(stdout);
    passed = true;
  } catch (error: any) {
    output = error.message;
    passed = false;
  }

  const result: TestResult = {
    passed,
    output,
  };

  process.send!({
    type: 'test',
    payload: result,
  });
});
