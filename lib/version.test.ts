import { describe, expect, it } from 'vitest';

import { compareVersions, isVersionNewer, normalizeVersion } from './version';

describe('version helpers', () => {
  it('normalizes tags and prerelease suffixes', () => {
    expect(normalizeVersion('v1.2.3-beta.1')).toBe('1.2.3');
  });

  it('compares versions numerically', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.9.9', '1.0.0')).toBe(-1);
  });

  it('detects only newer releases', () => {
    expect(isVersionNewer('v1.0.1', '1.0.0')).toBe(true);
    expect(isVersionNewer('v1.0.0', '1.0.0')).toBe(false);
  });
});
