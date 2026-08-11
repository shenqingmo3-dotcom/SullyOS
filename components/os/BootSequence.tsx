import React, { useEffect, useMemo, useRef, useState } from 'react';
import { trackEvent } from '../../utils/analytics';

const BOOT_SEEN_KEY = 'sullyos_boot_seen_session';

interface Props {
  dataReady: boolean;
  wallpaper?: string;
  onDone: () => void;
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined'
  && Boolean(window.matchMedia)
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const GLINTS = [
  { left: 12, top: 18, size: 3, delay: -1.8 },
  { left: 82, top: 16, size: 2, delay: -3.1 },
  { left: 74, top: 67, size: 3, delay: -0.7 },
  { left: 21, top: 76, size: 2, delay: -2.6 },
  { left: 91, top: 42, size: 2, delay: -4.1 },
  { left: 39, top: 11, size: 2, delay: -1.1 },
];

const BootSequence: React.FC<Props> = ({ dataReady, onDone }) => {
  const firstThisSession = useMemo(() => {
    try { return !sessionStorage.getItem(BOOT_SEEN_KEY); } catch { return true; }
  }, []);
  const reduced = useMemo(prefersReducedMotion, []);
  const cinematic = firstThisSession && !reduced;
  const holdMs = cinematic ? 1900 : 480;
  const exitMs = cinematic ? 620 : 260;
  const [phase, setPhase] = useState<'enter' | 'exit'>('enter');
  const startedAt = useRef(typeof performance !== 'undefined' ? performance.now() : Date.now());

  useEffect(() => {
    try { sessionStorage.setItem(BOOT_SEEN_KEY, '1'); } catch { /* session storage is optional */ }
  }, []);

  useEffect(() => {
    if (phase === 'exit') return;
    let frame = 0;
    const tick = () => {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (dataReady && now - startedAt.current >= holdMs) {
        setPhase('exit');
        const waited = now - startedAt.current;
        trackEvent('冷启动等待数据就绪', {
          等待档位: waited < 1000 ? '<1s' : waited < 3000 ? '1-3s' : waited < 8000 ? '3-8s' : '8s+',
          开场版本: cinematic ? '完整' : '精简',
        });
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [cinematic, dataReady, holdMs, phase]);

  useEffect(() => {
    if (phase !== 'exit') return;
    const timer = window.setTimeout(onDone, exitMs);
    return () => window.clearTimeout(timer);
  }, [exitMs, onDone, phase]);

  const skip = () => {
    if (phase === 'exit') return;
    setPhase('exit');
    trackEvent('跳过开机动画', {
      数据是否已就绪: dataReady ? '是' : '否',
      开场版本: cinematic ? '完整' : '精简',
    });
  };

  const exiting = phase === 'exit';

  return (
    <button
      type="button"
      onClick={skip}
      aria-label="进入 SharkOS"
      className="fixed inset-0 z-[9999] block w-full cursor-pointer overflow-hidden border-0 p-0 text-left select-none"
      style={{
        background: '#d8c79c',
        opacity: exiting ? 0 : 1,
        transition: `opacity ${exitMs}ms cubic-bezier(.4,0,.2,1)`,
      }}
    >
      <style>{`
        @keyframes sharkBootWash { from { opacity: 0; transform: scale(1.035) } to { opacity: 1; transform: scale(1) } }
        @keyframes sharkBootDrift { 0%,100% { transform: translate3d(0,0,0) rotate(-7deg) } 50% { transform: translate3d(8px,-12px,0) rotate(-4deg) } }
        @keyframes sharkBootGlint { 0%,100% { opacity: .15; transform: scale(.75) } 50% { opacity: .7; transform: scale(1.15) } }
        @keyframes sharkBootWord { from { opacity: 0; transform: translateY(12px); letter-spacing: .18em } to { opacity: 1; transform: translateY(0); letter-spacing: .08em } }
        @keyframes sharkBootHome { from { opacity: 0; transform: translateY(6px) } to { opacity: .78; transform: translateY(0) } }
        @keyframes sharkBootLine { from { opacity: 0; transform: scaleX(.2) } to { opacity: .7; transform: scaleX(1) } }
        @media (prefers-reduced-motion: reduce) {
          .shark-boot-motion { animation: none !important; transition-duration: 1ms !important; }
        }
      `}</style>

      <div
        className="shark-boot-motion absolute inset-0"
        style={{
          transform: exiting ? 'scale(1.045)' : 'scale(1)',
          transition: `transform ${exitMs}ms cubic-bezier(.2,.75,.25,1)`,
        }}
      >
        <div
          className="shark-boot-motion absolute inset-0"
          style={{
            animation: cinematic ? 'sharkBootWash 900ms cubic-bezier(.2,.8,.2,1) both' : undefined,
            background: [
              'radial-gradient(90% 62% at 58% 18%, rgba(255,252,239,.96) 0%, rgba(246,237,211,.78) 38%, transparent 72%)',
              'radial-gradient(72% 70% at 8% 96%, rgba(189,169,124,.5) 0%, transparent 70%)',
              'linear-gradient(155deg, #ece1c7 0%, #decea8 46%, #cbbb8e 100%)',
            ].join(','),
          }}
        />

        <div
          className="shark-boot-motion absolute -left-[18%] top-[6%] h-[42%] w-[64%] rounded-[48%] opacity-55 blur-3xl"
          style={{
            background: 'rgba(255,250,232,.78)',
            animation: cinematic ? 'sharkBootDrift 7s ease-in-out infinite' : undefined,
          }}
        />
        <div
          className="shark-boot-motion absolute -right-[18%] bottom-[7%] h-[38%] w-[62%] rounded-[50%] opacity-35 blur-3xl"
          style={{
            background: 'rgba(151,131,91,.44)',
            animation: cinematic ? 'sharkBootDrift 8.5s ease-in-out -2s infinite reverse' : undefined,
          }}
        />

        {cinematic && GLINTS.map((glint, index) => (
          <span
            key={index}
            className="shark-boot-motion absolute rounded-full bg-[#fffdf3]"
            style={{
              left: `${glint.left}%`,
              top: `${glint.top}%`,
              width: glint.size,
              height: glint.size,
              boxShadow: '0 0 12px rgba(255,250,224,.7)',
              animation: `sharkBootGlint 4.8s ease-in-out ${glint.delay}s infinite`,
            }}
          />
        ))}

        <div
          className="pointer-events-none absolute inset-0 opacity-[0.075]"
          style={{
            backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=%270 0 180 180%27 xmlns=%27http://www.w3.org/2000/svg%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%27.8%27 numOctaves=%272%27 stitchTiles=%27stitch%27/%3E%3C/filter%3E%3Crect width=%27100%25%27 height=%27100%25%27 filter=%27url(%23n)%27 opacity=%27.42%27/%3E%3C/svg%3E")',
          }}
        />

        <div className="absolute inset-0 flex items-center justify-center px-8 text-[#5f5646]">
          <div className="translate-y-[-1.5rem] text-center">
            <div
              className="shark-boot-motion text-[clamp(2.6rem,13vw,4.4rem)] font-semibold leading-none"
              style={{
                fontFamily: 'ui-rounded, "Avenir Next", "PingFang SC", sans-serif',
                letterSpacing: '.08em',
                textShadow: '0 2px 0 rgba(255,255,255,.28), 0 18px 45px rgba(100,82,47,.14)',
                animation: cinematic ? 'sharkBootWord 1100ms cubic-bezier(.16,1,.3,1) 180ms both' : 'sharkBootWord 480ms ease-out both',
              }}
            >
              Shark<span className="font-light">OS</span>
            </div>
            <div
              className="shark-boot-motion mx-auto mt-5 h-px w-24 origin-center"
              style={{
                background: 'linear-gradient(90deg, transparent, rgba(95,86,70,.62), transparent)',
                animation: cinematic ? 'sharkBootLine 650ms ease-out 650ms both' : undefined,
              }}
            />
            <p
              className="shark-boot-motion mt-4 text-[13px] font-medium tracking-[.34em]"
              style={{
                paddingLeft: '.34em',
                animation: cinematic ? 'sharkBootHome 700ms ease-out 760ms both' : 'sharkBootHome 420ms ease-out 120ms both',
              }}
            >
              欢迎回家
            </p>
          </div>
        </div>
      </div>

      {cinematic && !exiting && (
        <span className="absolute inset-x-0 bottom-[max(2rem,env(safe-area-inset-bottom))] text-center text-[10px] font-medium tracking-[.26em] text-[#6f634f]/55">
          轻触进入
        </span>
      )}
    </button>
  );
};

export default BootSequence;
