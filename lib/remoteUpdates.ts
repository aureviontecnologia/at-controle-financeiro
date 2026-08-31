import * as Application from 'expo-application';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { Linking, Platform } from 'react-native';

import { isVersionNewer, normalizeVersion } from './version';

const RELEASES_API_URL = 'https://api.github.com/repos/aureviontecnologia/at-controle-financeiro/releases/latest';
const APK_MIME_TYPE = 'application/vnd.android.package-archive';
const MAX_APK_SIZE_BYTES = 150 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 12_000;
const FLAG_GRANT_READ_URI_PERMISSION = 1;

type GitHubReleaseAsset = {
  browser_download_url: string;
  content_type: string;
  digest?: string | null;
  name: string;
  size: number;
};

type GitHubRelease = {
  assets: GitHubReleaseAsset[];
  body?: string | null;
  draft: boolean;
  html_url: string;
  name?: string | null;
  prerelease: boolean;
  published_at?: string | null;
  tag_name: string;
};

export type AvailableUpdate = {
  apkName: string;
  apkUrl: string;
  currentVersion: string;
  digest: string;
  notes: string;
  publishedAt: string | null;
  releaseUrl: string;
  size: number;
  version: string;
};

export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export const currentAppVersion = isExpoGo
  ? Constants.expoConfig?.version ?? '0.0.0'
  : Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '0.0.0';

function isTrustedGitHubUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com';
  } catch {
    return false;
  }
}

function getSha256(digest: string | null | undefined) {
  const match = digest?.toLowerCase().match(/^sha256:([a-f0-9]{64})$/);
  return match?.[1] ?? null;
}

function chooseApkAsset(assets: GitHubReleaseAsset[]) {
  return assets.find(
    (asset) =>
      asset.name.endsWith('-arm64.apk') &&
      asset.size > 0 &&
      asset.size <= MAX_APK_SIZE_BYTES &&
      isTrustedGitHubUrl(asset.browser_download_url) &&
      Boolean(getSha256(asset.digest)),
  );
}

export async function checkForRemoteUpdate(): Promise<AvailableUpdate | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(RELEASES_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: controller.signal,
    });

    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub respondeu com HTTP ${response.status}.`);

    const release = (await response.json()) as GitHubRelease;
    if (release.draft || release.prerelease || !isTrustedGitHubUrl(release.html_url)) return null;

    const version = normalizeVersion(release.tag_name);
    if (!/^\d+\.\d+\.\d+$/.test(version) || !isVersionNewer(version, currentAppVersion)) return null;

    const apk = chooseApkAsset(release.assets);
    const digest = getSha256(apk?.digest);
    if (!apk || !digest) throw new Error('A versão publicada não possui um APK ARM64 verificável.');

    return {
      apkName: apk.name,
      apkUrl: apk.browser_download_url,
      currentVersion: currentAppVersion,
      digest,
      notes: release.body?.trim().slice(0, 500) || 'Melhorias e correções de segurança.',
      publishedAt: release.published_at ?? null,
      releaseUrl: release.html_url,
      size: apk.size,
      version,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function arrayBufferToHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function downloadAndOpenInstaller(
  update: AvailableUpdate,
  onProgress?: (progress: number) => void,
) {
  if (Platform.OS !== 'android' || isExpoGo) {
    await Linking.openURL(update.releaseUrl);
    return;
  }

  const updatesDirectory = new Directory(Paths.cache, 'secure-updates');
  updatesDirectory.create({ idempotent: true, intermediates: true });
  const destination = new File(updatesDirectory, update.apkName);
  onProgress?.(0.05);
  const downloaded = await File.downloadFileAsync(update.apkUrl, destination, {
    idempotent: true,
  });
  onProgress?.(0.9);

  if (downloaded.size !== update.size) {
    downloaded.delete();
    throw new Error('O tamanho do APK baixado não confere com a publicação.');
  }

  const actualDigest = arrayBufferToHex(
    await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, await downloaded.bytes()),
  );
  if (actualDigest !== update.digest) {
    downloaded.delete();
    throw new Error('A assinatura SHA-256 do APK não confere. O arquivo foi descartado.');
  }

  onProgress?.(1);
  const contentUri = await FileSystemLegacy.getContentUriAsync(downloaded.uri);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    flags: FLAG_GRANT_READ_URI_PERMISSION,
    type: APK_MIME_TYPE,
  });
}
