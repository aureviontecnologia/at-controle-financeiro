const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * Keeps release credentials outside the repository. The plugin is active only
 * when the four signing variables are present (for example, in GitHub Actions).
 */
module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (gradleConfig) => {
    const requiredVariables = [
      'AUREVION_RELEASE_KEYSTORE_PATH',
      'AUREVION_RELEASE_KEYSTORE_PASSWORD',
      'AUREVION_RELEASE_KEY_ALIAS',
      'AUREVION_RELEASE_KEY_PASSWORD',
    ];

    if (!requiredVariables.every((name) => process.env[name])) return gradleConfig;

    let source = gradleConfig.modResults.contents;
    const variables = `
def aurevionReleaseKeystorePath = System.getenv("AUREVION_RELEASE_KEYSTORE_PATH")
def aurevionReleaseKeystorePassword = System.getenv("AUREVION_RELEASE_KEYSTORE_PASSWORD")
def aurevionReleaseKeyAlias = System.getenv("AUREVION_RELEASE_KEY_ALIAS")
def aurevionReleaseKeyPassword = System.getenv("AUREVION_RELEASE_KEY_PASSWORD")

`;

    if (!source.includes('def aurevionReleaseKeystorePath')) {
      source = source.replace('android {', `${variables}android {`);
    }

    const releaseSigningConfig = `signingConfigs {
        release {
            storeFile file(aurevionReleaseKeystorePath)
            storePassword aurevionReleaseKeystorePassword
            keyAlias aurevionReleaseKeyAlias
            keyPassword aurevionReleaseKeyPassword
        }`;
    source = source.replace('signingConfigs {', releaseSigningConfig);

    const buildTypesIndex = source.indexOf('buildTypes {');
    const releaseIndex = source.indexOf('release {', buildTypesIndex);
    const debugSigningIndex = source.indexOf('signingConfig signingConfigs.debug', releaseIndex);
    if (debugSigningIndex === -1) {
      throw new Error('Não foi possível configurar a assinatura release no Gradle gerado.');
    }
    source =
      source.slice(0, debugSigningIndex) +
      'signingConfig signingConfigs.release' +
      source.slice(debugSigningIndex + 'signingConfig signingConfigs.debug'.length);

    gradleConfig.modResults.contents = source;
    return gradleConfig;
  });
};
