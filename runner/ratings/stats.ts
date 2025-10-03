import {BuildErrorType, BuildResultStatus} from '../workers/builder/builder-types.js';
import {UserFacingError} from '../utils/errors.js';
import {
  AggregatedRunStats,
  AssessmentResult,
  RuntimeStats,
  ScoreBucket,
} from '../shared-interfaces.js';

/** Possible buckets that scores can be categorized into. */
export const BUCKET_CONFIG = [
  {name: 'Excellent', min: 98, max: 100, id: 'excellent'},
  {name: 'Great', min: 85, max: 97, id: 'great'},
  {name: 'Good', min: 71, max: 84, id: 'good'},
  {name: 'Poor', min: 0, max: 70, id: 'poor'},
];

/**
 * Calculates build and check statistics from assessment results.
 *
 * @param assessments - An array of `AssessmentResult` objects.
 * @returns An object containing aggregated build and check statistics.
 */
export function calculateBuildAndCheckStats(assessments: AssessmentResult[]): AggregatedRunStats {
  let successfulInitialBuilds = 0;
  let successfulBuildsAfterRepair = 0;
  let failedBuilds = 0;
  let successfulInitialTests = 0;
  let successfulTestsAfterRepair = 0;
  let failedTests = 0;
  let noTestsRun = 0;
  let runtimeStats: RuntimeStats | undefined;
  let accessibilityStats:
    | {
        appsWithErrors: number;
        appsWithoutErrorsAfterRepair: number;
        appsWithoutErrors: number;
      }
    | undefined;
  let securityStats: {appsWithErrors: number; appsWithoutErrors: number} | undefined;
  const errorDistribution: Partial<Record<BuildErrorType, number>> = {};
  const buckets: ScoreBucket[] = BUCKET_CONFIG.map(b => ({
    name: b.name,
    nameWithLabels: `${b.name} (${b.min === b.max ? b.max : `${b.min}-${b.max}`}%)`,
    min: b.min,
    max: b.max,
    id: b.id,
    appsCount: 0,
  }));

  assessments.forEach(result => {
    if (result.finalAttempt.buildResult.status === BuildResultStatus.SUCCESS) {
      if (result.repairAttempts === 0) {
        successfulInitialBuilds++;
      } else {
        successfulBuildsAfterRepair++;
      }
    } else {
      failedBuilds++;
      if (result.finalAttempt.buildResult.errorType) {
        errorDistribution[result.finalAttempt.buildResult.errorType] =
          (errorDistribution[result.finalAttempt.buildResult.errorType] || 0) + 1;
      }
    }

    // Calculate test statistics
    if (result.testResult) {
      if (result.testResult.passed) {
        if ((result.testRepairAttempts || 0) === 0) {
          successfulInitialTests++;
        } else {
          successfulTestsAfterRepair++;
        }
      } else {
        failedTests++;
      }
    } else {
      noTestsRun++;
    }
    if (result.finalAttempt.serveTestingResult?.runtimeErrors != undefined) {
      runtimeStats ??= {appsWithErrors: 0, appsWithoutErrors: 0};
      if (result.finalAttempt.serveTestingResult.runtimeErrors.trim() != '') {
        runtimeStats.appsWithErrors++;
      }
    }
    if (result.finalAttempt.serveTestingResult?.axeViolations != undefined) {
      accessibilityStats ??= {
        appsWithErrors: 0,
        appsWithoutErrors: 0,
        appsWithoutErrorsAfterRepair: 0,
      };
      if (result.finalAttempt.serveTestingResult.axeViolations.length > 0) {
        accessibilityStats.appsWithErrors++;
      } else {
        if (result.axeRepairAttempts === 0) {
          accessibilityStats.appsWithoutErrors++;
        } else {
          accessibilityStats.appsWithoutErrorsAfterRepair++;
        }
      }
    }
    securityStats ??= {appsWithErrors: 0, appsWithoutErrors: 0};
    const {numCspViolations, numTrustedTypesViolations} = (
      result.finalAttempt.serveTestingResult?.cspViolations || []
    ).reduce(
      (acc, v) => {
        if (v['blocked-uri'] === 'trusted-types-sink') {
          acc.numTrustedTypesViolations++;
        } else {
          acc.numCspViolations++;
        }
        return acc;
      },
      {numCspViolations: 0, numTrustedTypesViolations: 0},
    );

    const hasSafetyViolations =
      (result.finalAttempt.buildResult.safetyWebReportJson?.[0]?.violations?.length ?? 0) > 0;
    // TODO: Consider numTrustedTypesViolations once we update autoCsp and re-enable the rating.
    if (hasSafetyViolations || numCspViolations > 0) {
      securityStats.appsWithErrors++;
    } else {
      securityStats.appsWithoutErrors++;
    }

    const scorePercentage = Math.floor(
      (result.score.totalPoints / result.score.maxOverallPoints) * 100,
    );
    const bucket = buckets.find(b => scorePercentage >= b.min && scorePercentage <= b.max);

    if (!bucket) {
      throw new UserFacingError(`Score ${scorePercentage} did not fit into any bucket`);
    }

    bucket.appsCount++;
  });

  return {
    builds: {
      successfulInitialBuilds,
      successfulBuildsAfterRepair,
      failedBuilds,
      errorDistribution: Object.keys(errorDistribution).length > 0 ? errorDistribution : undefined,
    },
    tests: {
      successfulInitialTests,
      successfulTestsAfterRepair,
      failedTests,
      noTestsRun,
    },
    buckets,
    runtime: runtimeStats
      ? {
          appsWithErrors: runtimeStats.appsWithErrors,
          appsWithoutErrors:
            successfulInitialBuilds + successfulBuildsAfterRepair - runtimeStats.appsWithErrors,
        }
      : undefined,
    accessibility: accessibilityStats,
    security: securityStats,
  };
}

/** Shared function that determines if a bucket's score is positive. */
export function isPositiveScore(bucket: ScoreBucket): boolean {
  return bucket.min >= 50;
}
