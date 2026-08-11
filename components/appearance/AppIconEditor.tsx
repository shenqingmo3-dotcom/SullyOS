import React, { useCallback, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { processImageToBlob } from '../../utils/file';
import { putImageBlob, useBlobRefUrl } from '../../utils/blobRef';
import { isStandaloneDisplayMode } from '../../utils/iosStandalone';
import { clearPwaIcon, injectPwaIcon, PWA_ICON_APP_ID } from '../../utils/appIcon';

type Mode = 'upload' | 'url';

const AppIconEditor: React.FC = () => {
  const { customIcons, setCustomIcon, addToast } = useOS();
  const currentValue = customIcons[PWA_ICON_APP_ID];
  const previewUrl = useBlobRefUrl(currentValue);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>('upload');
  const [urlInput, setUrlInput] = useState('');
  const [processing, setProcessing] = useState(false);

  const saveIcon = useCallback(async (value: string) => {
    await setCustomIcon(PWA_ICON_APP_ID, value);
    await injectPwaIcon(value);
    addToast('PWA 图标已更新', 'success');
  }, [addToast, setCustomIcon]);

  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setProcessing(true);
    try {
      const blob = await processImageToBlob(file, { maxWidth: 512, quality: 0.92 });
      await saveIcon(await putImageBlob(blob));
    } catch (error: any) {
      addToast(error?.message || '图片处理失败', 'error');
    } finally {
      setProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [addToast, saveIcon]);

  const handleUrlConfirm = useCallback(async () => {
    const value = urlInput.trim();
    if (!/^https?:\/\//i.test(value)) {
      addToast('请输入有效的 http/https 图片链接', 'error');
      return;
    }
    setProcessing(true);
    try {
      const response = await fetch(value, { mode: 'cors' });
      if (!response.ok) throw new Error(`图片服务器返回 ${response.status}`);
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) throw new Error('链接指向的不是图片');
      const source = await response.blob();
      const file = new File([source], 'pwa-icon', { type: source.type || 'image/png' });
      const blob = await processImageToBlob(file, { maxWidth: 512, quality: 0.92 });
      await saveIcon(await putImageBlob(blob));
      setUrlInput('');
    } catch (error: any) {
      addToast(error?.message || '获取图片失败', 'error');
    } finally {
      setProcessing(false);
    }
  }, [addToast, saveIcon, urlInput]);

  const resetIcon = useCallback(async () => {
    await setCustomIcon(PWA_ICON_APP_ID, undefined);
    clearPwaIcon();
    addToast('PWA 图标已恢复默认', 'info');
  }, [addToast, setCustomIcon]);

  return (
    <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-700">桌面 PWA 图标</h2>
          <p className="text-[10px] text-slate-400 mt-1">设置手机桌面上的 SullyOS 图标</p>
        </div>
        <div className="w-16 h-16 rounded-2xl overflow-hidden shadow-sm bg-slate-100 shrink-0">
          {previewUrl
            ? <img src={previewUrl} className="w-full h-full object-cover" alt="当前 PWA 图标" />
            : <div className="w-full h-full flex items-center justify-center text-2xl text-slate-300">✦</div>}
        </div>
      </div>

      <div className="flex bg-slate-100 rounded-xl p-1 gap-1">
        <button onClick={() => setMode('upload')} className={`flex-1 py-2 text-xs font-medium rounded-lg ${mode === 'upload' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400'}`}>上传图片</button>
        <button onClick={() => setMode('url')} className={`flex-1 py-2 text-xs font-medium rounded-lg ${mode === 'url' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400'}`}>图片链接</button>
      </div>

      {mode === 'upload' ? (
        <>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
          <button onClick={() => fileInputRef.current?.click()} disabled={processing} className="w-full py-3 border-2 border-dashed border-slate-200 rounded-xl text-sm text-slate-400 disabled:opacity-50">
            {processing ? '处理中…' : '选择图片'}
          </button>
        </>
      ) : (
        <div className="flex gap-2">
          <input type="url" value={urlInput} onChange={(event) => setUrlInput(event.target.value)} placeholder="https://example.com/icon.png" disabled={processing} className="min-w-0 flex-1 px-3 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50" />
          <button onClick={handleUrlConfirm} disabled={processing || !urlInput.trim()} className="px-4 py-2 text-sm font-medium bg-primary text-white rounded-xl disabled:opacity-40">确认</button>
        </div>
      )}

      {currentValue && <button onClick={resetIcon} disabled={processing} className="text-xs text-red-400">恢复默认图标</button>}

      {isStandaloneDisplayMode() ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-600 leading-relaxed">
          已安装的 PWA 不会自动换图标。需要先在“设置 → 备份”导出数据，再删除并重新添加到主屏幕。
        </div>
      ) : (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-600 leading-relaxed">
          图标会在下一次“添加到主屏幕”时生效。
        </div>
      )}
    </section>
  );
};

export default AppIconEditor;
