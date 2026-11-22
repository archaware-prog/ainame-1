import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SkipForward, Volume2, VolumeX } from 'lucide-react';
import type { BrandingSettings } from '../../types/streaming';

interface AnimeEntranceProps {
  open: boolean;
  siteName: string;
  branding?: BrandingSettings;
  reducedMotion?: boolean;
  onComplete: () => void;
}

const INTRO_VIDEO_SRC = '/assets/aistudio/AIname-Director-3D-Intro_70bf0bd6.mp4';

export function AnimeEntrance({
  open,
  siteName,
  branding,
  reducedMotion = false,
  onComplete,
}: AnimeEntranceProps) {
  const [splitting, setSplitting] = useState(false);
  const [muted, setMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const completedRef = useRef(false);
  const fadeTimerRef = useRef<number | null>(null);

  const finishIntro = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    setSplitting(true);
    if (fadeTimerRef.current !== null) {
      window.clearTimeout(fadeTimerRef.current);
    }
    fadeTimerRef.current = window.setTimeout(() => {
      onComplete();
    }, 450);
  }, [onComplete]);

  useEffect(() => {
    if (!open) {
      completedRef.current = false;
      setSplitting(false);
      if (fadeTimerRef.current !== null) {
        window.clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
      return;
    }

    completedRef.current = false;
    setSplitting(false);

    if (branding?.splashEnabled === false || reducedMotion) {
      onComplete();
      return;
    }

    const osReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (osReducedMotion) {
      onComplete();
      return;
    }

    const video = videoRef.current;
    if (video) {
      video.currentTime = 0;
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          // If autoplay is blocked even while muted, fall back to a brief timer
        });
      }
    }

    // Safety fallback in case media playback stalls or fails silently
    const safetyTimer = window.setTimeout(() => {
      finishIntro();
    }, 16000);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        finishIntro();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.clearTimeout(safetyTimer);
      window.removeEventListener('keydown', onKeyDown);
      if (fadeTimerRef.current !== null) {
        window.clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
    };
  }, [open, onComplete, finishIntro, branding?.splashEnabled, reducedMotion]);

  if (!open || branding?.splashEnabled === false || reducedMotion) return null;

  const splashBg =
    branding?.splashBgColor && branding.splashBgColor !== '#07070b'
      ? branding.splashBgColor
      : '#1a0704';

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center overflow-hidden select-none transition-opacity duration-500 ${
        splitting ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
      style={{ backgroundColor: splashBg }}
      role="dialog"
      aria-modal="true"
      aria-label={`${siteName || 'AIname'} opening intro`}
      onClick={finishIntro}
    >
      <video
        ref={videoRef}
        src={INTRO_VIDEO_SRC}
        autoPlay
        muted={muted}
        playsInline
        preload="auto"
        onEnded={finishIntro}
        onError={() => onComplete()}
        className={`h-full w-full object-contain md:object-cover transition-transform duration-500 ${
          splitting ? 'scale-105' : 'scale-100'
        }`}
      />

      {/* Top/Bottom subtle controls scrim */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-black/45 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

      {/* Audio & Skip Intro Controls */}
      {!splitting && (
        <div className="absolute right-5 bottom-6 z-20 flex items-center gap-2.5 sm:top-6 sm:bottom-auto">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMuted((prev) => {
                const next = !prev;
                if (videoRef.current) {
                  videoRef.current.muted = next;
                }
                return next;
              });
            }}
            aria-label={muted ? 'Unmute intro audio' : 'Mute intro audio'}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-white/25 bg-black/65 px-3 py-2 text-xs font-semibold text-white backdrop-blur-md transition-colors hover:bg-white/15"
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              finishIntro();
            }}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-white/25 bg-black/65 px-4 py-2 text-xs font-semibold text-white backdrop-blur-md transition-colors hover:bg-white/15"
          >
            <span>Skip Intro</span>
            <SkipForward className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
