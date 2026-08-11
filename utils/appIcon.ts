// 自定义 PWA 应用图标：启动时把 `_pwa_` 图标注入 apple-touch-icon / manifest。
// 图标只在“添加到主屏幕”时固化，已安装的 PWA 需要备份后重装才能换图标。

import { getBlobForRef, isBlobRef, blobToDataUrl } from './blobRef';

export const PWA_ICON_APP_ID = '_pwa_';

const ATI_SELECTOR = 'link[rel="apple-touch-icon"].sully-custom-pwa-icon';
const MANIFEST_SELECTOR = 'link[rel="manifest"]';

let originalManifestHref: string | null = null;
let dynamicManifestUrl: string | null = null;

export async function injectPwaIcon(value: string): Promise<void> {
  const dataUrl = await resolveIconValue(value);
  if (!dataUrl) return;

  injectAppleTouchIcon(dataUrl);
  await replaceManifest(dataUrl);
}

export function clearPwaIcon(): void {
  document.querySelector(ATI_SELECTOR)?.remove();

  const link = document.querySelector(MANIFEST_SELECTOR) as HTMLLinkElement | null;
  if (link && originalManifestHref) link.href = originalManifestHref;

  if (dynamicManifestUrl) {
    URL.revokeObjectURL(dynamicManifestUrl);
    dynamicManifestUrl = null;
  }
}

export async function initPwaIcon(customIcons: Record<string, string>): Promise<void> {
  const icon = customIcons[PWA_ICON_APP_ID];
  if (!icon) return;
  try {
    await injectPwaIcon(icon);
  } catch (error) {
    console.warn('[PWA Icon] 启动注入失败', error);
  }
}

async function resolveIconValue(value: string): Promise<string | null> {
  if (isBlobRef(value)) {
    const blob = await getBlobForRef(value);
    if (!blob) {
      console.warn('[PWA Icon] 图标资源不存在');
      return null;
    }
    return blobToDataUrl(blob);
  }
  if (value.startsWith('data:') || /^https?:\/\//i.test(value)) return value;
  return null;
}

function injectAppleTouchIcon(dataUrl: string): void {
  document.querySelector(ATI_SELECTOR)?.remove();
  const link = document.createElement('link');
  link.rel = 'apple-touch-icon';
  link.setAttribute('sizes', '180x180');
  link.href = dataUrl;
  link.classList.add('sully-custom-pwa-icon');
  document.head.appendChild(link);
}

async function replaceManifest(iconDataUrl: string): Promise<void> {
  const link = document.querySelector(MANIFEST_SELECTOR) as HTMLLinkElement | null;
  if (!link) return;
  if (!originalManifestHref) originalManifestHref = link.href;

  try {
    const response = await fetch(originalManifestHref || link.href);
    if (!response.ok) throw new Error(`Fetch manifest failed: ${response.status}`);
    const manifest = await response.json();
    const base = link.href;

    manifest.icons = [
      { src: iconDataUrl, sizes: '192x192', type: 'image/png' },
      { src: iconDataUrl, sizes: '512x512', type: 'image/png' },
      { src: iconDataUrl, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ];

    const toAbsolute = (path: string): string => {
      if (!path || path.startsWith('data:') || /^https?:\/\//i.test(path)) return path;
      return new URL(path, base).href;
    };
    if (manifest.start_url) manifest.start_url = toAbsolute(manifest.start_url);
    if (manifest.scope) manifest.scope = toAbsolute(manifest.scope);

    const blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' });
    if (dynamicManifestUrl) URL.revokeObjectURL(dynamicManifestUrl);
    dynamicManifestUrl = URL.createObjectURL(blob);
    link.href = dynamicManifestUrl;
  } catch (error) {
    console.warn('[PWA Icon] manifest 替换失败', error);
  }
}
