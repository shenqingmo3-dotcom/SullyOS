import React, { useEffect, useMemo, useRef, useState } from 'react';

// SharkOS 冷启动「世界入场」电影化序列 —— 取代传统黑屏 spinner。
// 目标：让人觉得「进入了一个小世界」，而不是「在等一个 App 加载完」。
//   · 深空大气场景 + 相机缓慢前推 + 漂浮尘埃/闪烁星点 + 核心柔光（呼吸）
//   · logo 从景深中浮现（远→近对焦），随后 tagline 与一道光线（UI 萌芽）
//   · 数据就绪 + 停留够时长后，整场景「推进穿过」并淡出，无缝交还给锁屏
// 设计取舍（呼应本项目对「动静过多反而显卡」的敏感）：
//   · 只在「本会话首次冷启动」播放完整版；同会话刷新走极短版，不反复占用用户
//   · 全程仅动 transform / opacity（GPU 友好）；数据没加载完就持续呼吸等待，绝不出现 spinner
//   · 可轻触跳过；尊重 prefers-reduced-motion
//   · 用内联 @keyframes 而非 Tailwind 自定义 animate-*（CDN 版 Tailwind 不可靠生成自定义动画类）

const BOOT_SEEN_KEY = 'sullyos_boot_seen_session';

interface Props {
  /** 数据是否已就绪（IndexedDB 加载完）。未就绪时场景持续呼吸等待，不退场。 */
  dataReady: boolean;
  /** 保留现有调用接口；SharkOS 开屏使用固定品牌背景，不受壁纸影响。 */
  wallpaper?: string;
  /** 退场动画播完后回调，交还控制权给 PhoneShell。 */
  onDone: () => void;
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const BootSequence: React.FC<Props> = ({ dataReady, onDone }) => {
  // 本会话是否首次看到开场：刷新页面仍属同 session → 走极短版。
  const firstThisSession = useMemo(() => {
    try { return !sessionStorage.getItem(BOOT_SEEN_KEY); } catch { return true; }
  }, []);
  const reduced = useMemo(() => prefersReducedMotion(), []);
  const cinematic = firstThisSession && !reduced;

  const HOLD = cinematic ? 2000 : 520; // 退场前最短停留（也是「等数据」的下限）
  const EXIT = cinematic ? 680 : 300;  // 推进式退场时长

  const [phase, setPhase] = useState<'enter' | 'exit'>('enter');
  const startRef = useRef(0);
  if (startRef.current === 0) {
    startRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  useEffect(() => {
    try { sessionStorage.setItem(BOOT_SEEN_KEY, '1'); } catch { /* ignore */ }
  }, []);

  // 「数据就绪 且 停留够 HOLD」→ 退场；否则一直呼吸等待。
  useEffect(() => {
    if (phase === 'exit') return;
    let raf = 0;
    const tick = () => {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (dataReady && now - startRef.current >= HOLD) { setPhase('exit'); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dataReady, phase, HOLD]);

  // 退场动画播完 → 交还控制权。
  useEffect(() => {
    if (phase !== 'exit') return;
    const t = setTimeout(onDone, EXIT);
    return () => clearTimeout(t);
  }, [phase, EXIT, onDone]);

  // 轻触跳过：进入平滑退场（非硬切）。
  const skip = () => { if (phase !== 'exit') setPhase('exit'); };

  // 漂浮尘埃（自下而上缓升）与闪烁星点（原地明灭）—— 仅完整版生成，只动 transform/opacity。
  const motes = useMemo(() =>
    cinematic ? Array.from({ length: 16 }, () => ({
      left: Math.random() * 100,
      size: 1.5 + Math.random() * 2.5,
      delay: -Math.random() * 12,
      dur: 11 + Math.random() * 9,
      sway: (Math.random() * 2 - 1) * 24,
      op: 0.25 + Math.random() * 0.45,
    })) : [], [cinematic]);
  const stars = useMemo(() =>
    cinematic ? Array.from({ length: 18 }, () => ({
      left: Math.random() * 100,
      top: Math.random() * 62,
      size: 1 + Math.random() * 1.8,
      delay: -Math.random() * 4,
      dur: 2.4 + Math.random() * 3,
      op: 0.4 + Math.random() * 0.5,
    })) : [], [cinematic]);

  const exiting = phase === 'exit';

  return (
    <div
      onClick={skip}
      aria-label="SharkOS"
      className="fixed inset-0 z-[9999] overflow-hidden select-none cursor-pointer"
      style={{
        background: '#d98d05',
        opacity: exiting ? 0 : 1,
        transition: `opacity ${EXIT}ms ease-in`,
      }}
    >
      <style>{`
        @keyframes bootSceneIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes bootCamera { from { transform: scale(1) } to { transform: scale(1.06) } }
        @keyframes bootBloom { 0%,100% { opacity:.55; transform: translate(-50%,-50%) scale(1) } 50% { opacity:.85; transform: translate(-50%,-50%) scale(1.08) } }
        @keyframes bootRise { from { transform: translateY(8vh) translateX(0) } to { transform: translateY(-112vh) translateX(var(--sway,0px)) } }
        @keyframes bootTwinkle { 0%,100% { opacity:.15 } 50% { opacity:1 } }
        @keyframes bootLogoIn { 0% { opacity:0; transform: translateY(10px) scale(1.14); filter: blur(10px) } 60% { opacity:1 } 100% { opacity:1; transform: translateY(0) scale(1); filter: blur(0) } }
        @keyframes bootSoftIn { from { opacity:0; transform: translateY(8px) } to { opacity:.8; transform: translateY(0) } }
        @keyframes bootLineIn { from { opacity:0; transform: scaleX(0) } to { opacity:.6; transform: scaleX(1) } }
        @keyframes bootHintIn { from { opacity:0 } to { opacity:.45 } }
      `}</style>

      {/* 退场推进层：退场时整体放大并随根层淡出，营造「相机穿过场景」 */}
      <div
        className="absolute inset-0"
        style={{
          transform: exiting ? 'scale(1.12)' : undefined,
          transition: exiting ? `transform ${EXIT}ms cubic-bezier(0.4,0,0.2,1)` : undefined,
          willChange: 'transform',
        }}
      >
        {/* 相机缓推层：完整版下场景缓慢前移 */}
        <div
          className="absolute inset-0"
          style={{ animation: cinematic ? 'bootCamera 6s ease-out forwards' : undefined, willChange: 'transform' }}
        >
          {/* 向日葵金色底：暖黄花心、金色花瓣与焦糖色边缘。 */}
          <div className="absolute inset-0" style={{
            animation: cinematic ? 'bootSceneIn 700ms ease-out both' : 'bootSceneIn 300ms ease-out both',
            background: 'radial-gradient(circle at 50% 42%, #fff7b0 0%, #ffdc55 16%, #f6b91c 40%, #df9208 72%, #8f4d00 100%)',
          }} />
          {/* 放射花瓣纹理：保持抽象，不引入额外图片资源。 */}
          <div className="absolute inset-0" style={{
            mixBlendMode: 'soft-light',
            background: 'repeating-conic-gradient(from -4deg at 50% 42%, rgba(255,249,186,0.58) 0deg 7deg, rgba(211,123,0,0.12) 7deg 14deg)',
          }} />
          {/* 核心柔光（呼吸）—— logo 所在处的光源 */}
          <div className="absolute" style={{
            left: '50%', top: '42%', width: '120vw', height: '120vw', maxWidth: 900, maxHeight: 900,
            transform: 'translate(-50%,-50%)',
            background: 'radial-gradient(circle, rgba(255,252,207,0.72) 0%, rgba(255,216,68,0.22) 32%, transparent 62%)',
            animation: cinematic ? 'bootBloom 5.5s ease-in-out infinite' : undefined,
            opacity: cinematic ? undefined : 0.6,
          }} />

          {/* 漂浮尘埃 */}
          {motes.map((p, i) => (
            <span key={`m${i}`} className="absolute rounded-full" style={{
              left: `${p.left}%`, bottom: 0, width: p.size, height: p.size,
              ['--sway' as any]: `${p.sway}px`,
              background: 'radial-gradient(circle, rgba(255,251,210,0.98), rgba(255,224,104,0) 70%)',
              opacity: p.op,
              animation: `bootRise ${p.dur}s linear ${p.delay}s infinite`,
              willChange: 'transform',
            }} />
          ))}
          {/* 闪烁星点 */}
          {stars.map((s, i) => (
            <span key={`s${i}`} className="absolute rounded-full" style={{
              left: `${s.left}%`, top: `${s.top}%`, width: s.size, height: s.size,
              background: 'rgba(255,252,218,0.98)',
              boxShadow: '0 0 7px rgba(255,237,139,0.9)',
              opacity: s.op,
              animation: `bootTwinkle ${s.dur}s ease-in-out ${s.delay}s infinite`,
            }} />
          ))}

          {/* 暗角，聚焦中心 */}
          <div className="absolute inset-0" style={{
            background: 'radial-gradient(125% 100% at 50% 44%, transparent 48%, rgba(92,45,0,0.52) 100%)',
          }} />
        </div>

        {/* 前景：logo 自景深浮现 + 光线 + tagline（UI 从场景中生长出来） */}
        <div className="absolute inset-0 flex flex-col items-center justify-center px-8 pointer-events-none">
          <div className="font-light" style={{
            color: '#633700',
            fontSize: 'clamp(38px, 12vw, 64px)',
            letterSpacing: '0.04em',
            textShadow: '0 1px 0 rgba(255,249,207,0.55), 0 5px 22px rgba(108,54,0,0.28)',
            animation: cinematic ? 'bootLogoIn 1400ms cubic-bezier(0.22,1,0.36,1) 250ms both' : 'bootLogoIn 600ms ease-out both',
          }}>
            Shark<span style={{ fontWeight: 500 }}>OS</span>
          </div>
          <div className="mt-3 h-px w-28" style={{
            background: 'linear-gradient(90deg, transparent, rgba(99,55,0,0.72), transparent)',
            transformOrigin: 'center',
            animation: cinematic ? 'bootLineIn 700ms ease-out 700ms both' : 'bootLineIn 400ms ease-out 200ms both',
          }} />
          <div className="mt-3 text-[12px]" style={{
            color: 'rgba(99,55,0,0.86)',
            letterSpacing: '0.3em',
            animation: cinematic ? 'bootSoftIn 800ms ease-out 850ms both' : 'bootSoftIn 500ms ease-out 250ms both',
          }}>
            欢迎回家！
          </div>
        </div>
      </div>

      {/* 轻触跳过提示（仅完整版、过 1.8s 后；极淡，不打扰） */}
      {cinematic && !exiting && (
        <div className="absolute bottom-10 left-0 right-0 text-center text-[10px] tracking-[0.3em]"
             style={{ color: 'rgba(99,55,0,0.48)', animation: 'bootHintIn 800ms ease-out 1800ms both' }}>
          轻触进入
        </div>
      )}
    </div>
  );
};

export default BootSequence;
