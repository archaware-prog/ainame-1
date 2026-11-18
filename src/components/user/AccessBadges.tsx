import React from 'react';
import { Check, Crown, Gift, Lock, Play, Sparkles } from 'lucide-react';
import type {
  AdGlobalSettings,
  AdUnlockRecord,
  BadgeIconKind,
  EpisodeItem,
  MovieItem,
  SeriesEpisodeSummary,
  SubscriptionPlan,
  UserProfile,
} from '../../types/streaming';
import { resolveTitleBadges } from '../../utils/access';

interface AccessBadgesProps {
  movie: MovieItem;
  episode?: EpisodeItem | null;
  episodesSummary?: SeriesEpisodeSummary;
  user: UserProfile | null;
  plans?: SubscriptionPlan[];
  unlocksMap?: Record<string, AdUnlockRecord>;
  adSettings?: AdGlobalSettings;
  isMobile?: boolean;
  size?: 'sm' | 'md';
  maxBadges?: number;
  className?: string;
}

function renderBadgeIcon(icon: BadgeIconKind, className: string) {
  switch (icon) {
    case 'lock':
      return <Lock className={className} />;
    case 'play':
      return <Play className={`${className} fill-current`} />;
    case 'crown':
      return <Crown className={className} />;
    case 'gift':
      return <Gift className={className} />;
    case 'check':
      return <Check className={className} />;
    case 'sparkles':
      return <Sparkles className={className} />;
    default:
      return null;
  }
}

export const AccessBadges: React.FC<AccessBadgesProps> = ({
  movie,
  episode = null,
  episodesSummary,
  user,
  plans = [],
  unlocksMap = {},
  adSettings,
  isMobile = false,
  size = 'sm',
  maxBadges = 2,
  className = '',
}) => {
  const badges = resolveTitleBadges({
    movie,
    episode,
    episodesSummary,
    user,
    plans,
    unlocksMap,
    settings: adSettings,
    isMobile,
  }).slice(0, maxBadges);

  if (badges.length === 0) return null;

  const iconCls = size === 'md' ? 'h-3.5 w-3.5 shrink-0' : 'h-3 w-3 shrink-0';
  const textCls = size === 'md' ? 'text-xs px-2.5 py-1' : 'text-[10px] px-1.5 py-0.5';

  return (
    <div className={`inline-flex flex-wrap items-center gap-1.5 ${className}`}>
      {badges.map((badge) => {
        const isLightText = badge.id !== 'paid' && badge.id !== 'some_episodes_free';
        return (
          <span
            key={badge.id}
            title={badge.tooltip}
            aria-label={badge.tooltip}
            style={{ backgroundColor: badge.color }}
            className={`group/badge relative inline-flex items-center gap-1 rounded font-bold tracking-wide shadow-sm backdrop-blur-sm ${textCls} ${
              isLightText ? 'text-white' : 'text-zinc-950'
            }`}
          >
            {renderBadgeIcon(badge.icon, iconCls)}
            {!badge.compactOnly && <span className="whitespace-nowrap">{badge.label}</span>}
          </span>
        );
      })}
    </div>
  );
};
