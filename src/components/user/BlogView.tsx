import React from 'react';
import { ArrowLeft, Calendar, Newspaper } from 'lucide-react';
import type { BlogPostItem } from '../../types/streaming';
import { sanitizeHtml } from '../../utils/customization';

interface BlogViewProps {
  posts: BlogPostItem[];
  activeSlug?: string;
  onSelectPost: (slug: string) => void;
  onBackToList: () => void;
}

export function BlogView({ posts, activeSlug, onSelectPost, onBackToList }: BlogViewProps) {
  const selected = activeSlug ? posts.find((p) => p.slug === activeSlug) : null;

  if (activeSlug && selected) {
    return (
      <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <button
          type="button"
          onClick={onBackToList}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to News &amp; Blog
        </button>

        {selected.coverUrl && (
          <img
            src={selected.coverUrl}
            alt={selected.title}
            referrerPolicy="no-referrer"
            className="mt-6 h-64 w-full rounded-2xl object-cover sm:h-80"
          />
        )}

        <div className="mt-6 flex items-center gap-2 text-xs text-zinc-500">
          <Calendar className="h-3.5 w-3.5" />
          <span>{(selected.publishedAt || selected.createdAt).slice(0, 10)}</span>
        </div>

        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-zinc-950 dark:text-white sm:text-4xl">
          {selected.title}
        </h1>
        <p className="mt-3 text-base leading-relaxed text-zinc-600 dark:text-zinc-300">
          {selected.excerpt}
        </p>

        <div
          className="prose prose-sm mt-8 max-w-none border-t border-zinc-200 pt-8 dark:prose-invert dark:border-zinc-800"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(selected.contentHtml) }}
        />
      </article>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="border-b border-zinc-200 pb-6 dark:border-zinc-800">
        <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--kv-accent,#e50914)]">
          <Newspaper className="h-4 w-4" />
          <span>Editorial Updates</span>
        </div>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-zinc-950 dark:text-white">
          News &amp; Announcements
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Simulcast schedules, curation notes, and platform announcements.
        </p>
      </div>

      {posts.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-zinc-200 bg-white p-12 text-center dark:border-zinc-800 dark:bg-[#13131c]">
          <Newspaper className="mx-auto h-10 w-10 text-zinc-400" />
          <h2 className="mt-3 font-display text-lg font-semibold">No articles published yet</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Check back soon for new announcements and release highlights.
          </p>
        </div>
      ) : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <button
              key={post.id}
              type="button"
              onClick={() => onSelectPost(post.slug)}
              className="group flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white text-left transition-colors hover:border-[var(--kv-accent,#e50914)] dark:border-zinc-800 dark:bg-[#13131c]"
            >
              {post.coverUrl && (
                <img
                  src={post.coverUrl}
                  alt={post.title}
                  referrerPolicy="no-referrer"
                  className="h-44 w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                />
              )}
              <div className="flex flex-1 flex-col justify-between p-5">
                <div>
                  <p className="font-mono-tabular text-[11px] text-zinc-500">
                    {(post.publishedAt || post.createdAt).slice(0, 10)}
                  </p>
                  <h2 className="mt-1 font-display text-base font-bold text-zinc-950 dark:text-white">
                    {post.title}
                  </h2>
                  <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                    {post.excerpt}
                  </p>
                </div>
                <span className="mt-4 text-xs font-semibold text-[var(--kv-accent,#e50914)]">
                  Read article →
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
