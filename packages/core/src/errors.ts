/** Error codes used for CI-friendly exit codes. */
export type TestImpactErrorCode = 'CONFIG_INVALID' | 'CONFIG_NOT_FOUND' | 'GIT_ERROR' | 'INVALID_INPUT' | 'REPORT_NOT_FOUND';

export class TestImpactError extends Error {
  readonly code: TestImpactErrorCode;
  readonly details: string[];
  constructor(code: TestImpactErrorCode, message: string, details: string[] = []) {
    super(message);
    this.name = 'TestImpactError';
    this.code = code;
    this.details = details;
  }
}
