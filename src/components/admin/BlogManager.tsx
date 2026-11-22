import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import {
  CheckCircle2,
  Edit3,
  Newspaper,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
} from 'lucide-react';
import {
  deleteBlogPostBatch,
  fetchBlogPostsPage,
  saveBlogPostBatch,
} from '../../lib/ordersFirebase';
import type { BlogPostItem, BlogPostStatus } from '../../types/streaming';
import { formatRelativeTime, slugify } from '../../utils/catalog';
import { validateBlogPostDraft } from '../../utils/orders';
import { ConfirmDialog, Modal } from '../ui/Modal';
import { RichHtmlEditorBox } from './RichPageEditor';

interface BlogManagerProps {
  adminUid: string;
  onMutateSuccess: () => void;
  onNotify: (message: string, type: 'success' | 'error' | 'info') => void;
}

export function BlogManager({ adminUid, onMutateSuccess, onNotify }: BlogManagerProps) {
  const [posts, setPosts] = useState<BlogPostItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [statusFilter, setStatusFilter] = useState<BlogPostStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState<QueryDocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(false);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<BlogPostItem | null>(null);
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugDirty, setSlugDirty] = useState(false);
  const [excerpt, setExcerpt] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [status, setStatus] = useState<BlogPostStatus>('draft');
  const [contentHtml, setContentHtml] = useState('<h2>Article Heading</h2><p>Write your post...</p>');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Publish & delete confirms
  const [publishingPost, setPublishingPost] = useState<BlogPostItem | null>(null);
  const [deletingPost, setDeletingPost] = useState<BlogPostItem | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const loadPosts = useCallback(async () => {
    setLoading(true);
    try {
      const page = await fetchBlogPostsPage({ statusFilter, cursor: null, pageSize: 25 });
      setPosts(page.items);
      setCursor(page.lastDoc);
      setHasMore(page.hasMore);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not load blog posts.', 'error');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, onNotify]);

  useEffect(() => {
    void loadPosts();
  }, [loadPosts]);

  const handleLoadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchBlogPostsPage({ statusFilter, cursor, pageSize: 25 });
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...page.items.filter((p) => !seen.has(p.id))];
      });
      setCursor(page.lastDoc);
      setHasMore(page.hasMore);
    } finally {
      setLoadingMore(false);
    }
  };

  const openEditor = (post: BlogPostItem | null) => {
    setEditingPost(post);
    if (!post) {
      setTitle('');
      setSlug('');
      setSlugDirty(false);
      setExcerpt('');
      setCoverUrl('');
      setStatus('draft');
      setContentHtml('<h2>Announcement</h2><p>Share updates with your viewers here.</p>');
    } else {
      setTitle(post.title);
      setSlug(post.slug);
      setSlugDirty(true);
      setExcerpt(post.excerpt);
      setCoverUrl(post.coverUrl ?? '');
      setStatus(post.status);
      setContentHtml(post.contentHtml);
    }
    setErrors({});
    setModalOpen(true);
  };

  const filteredPosts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return posts;
    return posts.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.slug.toLowerCase().includes(q) ||
        p.excerpt.toLowerCase().includes(q)
    );
  }, [posts, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter articles..."
              className="rounded-lg border border-zinc-300 bg-white py-2 pl-8 pr-3 text-xs dark:border-zinc-700 dark:bg-[#13131c]"
            />
          </div>
          <select
            aria-label="Filter posts by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as BlogPostStatus | 'all')}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs dark:border-zinc-700 dark:bg-[#13131c]"
          >
            <option value="all">All Posts</option>
            <option value="published">Published</option>
            <option value="draft">Drafts</option>
          </select>
          <button
            type="button"
            onClick={() => void loadPosts()}
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>

        <button
          type="button"
          onClick={() => openEditor(null)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--kv-accent,#e50914)] px-4 py-2 text-xs font-semibold text-white hover:opacity-90"
        >
          <Plus className="h-3.5 w-3.5" />
          New Blog Post
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#13131c]">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="p-3">Article</th>
              <th className="p-3">Slug</th>
              <th className="p-3">Status</th>
              <th className="p-3">Updated</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {loading ? (
              Array.from({ length: 3 }).map((_, idx) => (
                <tr key={idx}>
                  <td colSpan={5} className="p-4">
                    <div className="h-4 w-full animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
                  </td>
                </tr>
              ))
            ) : filteredPosts.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-8 text-center text-zinc-500">
                  <Newspaper className="mx-auto mb-2 h-6 w-6 text-zinc-400" />
                  No blog posts yet. Click &ldquo;New Blog Post&rdquo; to publish news or release notes.
                </td>
              </tr>
            ) : (
              filteredPosts.map((post) => (
                <tr key={post.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                  <td className="p-3">
                    <p className="font-semibold">{post.title}</p>
                    <p className="mt-0.5 line-clamp-1 max-w-md text-[11px] text-zinc-500">
                      {post.excerpt}
                    </p>
                  </td>
                  <td className="font-mono p-3 text-zinc-500">/blog/{post.slug}</td>
                  <td className="p-3">
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                        post.status === 'published'
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                          : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      {post.status}
                    </span>
                  </td>
                  <td className="font-mono-tabular p-3 text-zinc-500">
                    {formatRelativeTime(post.updatedAt)}
                  </td>
                  <td className="p-3 text-right">
                    <div className="inline-flex items-center gap-1.5">
                      {post.status === 'draft' && (
                        <button
                          type="button"
                          onClick={() => setPublishingPost(post)}
                          className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500"
                        >
                          <Send className="h-3 w-3" />
                          Publish
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openEditor(post)}
                        aria-label={`Edit post ${post.title}`}
                        className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-white"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingPost(post)}
                        aria-label={`Delete post ${post.title}`}
                        className="rounded p-1.5 text-zinc-500 hover:text-rose-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <div className="flex justify-center pt-1">
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => void handleLoadMore()}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-xs font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {loadingMore ? 'Loading...' : 'Load More Posts'}
          </button>
        </div>
      )}

      {/* Create / Edit Blog Post Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingPost ? 'Edit Blog Post' : 'Create Blog Post'}
        maxWidthClass="max-w-3xl"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const nowIso = new Date().toISOString();
            const cleanSlug = slugify(slug || title);
            const candidate: BlogPostItem = {
              id: editingPost?.id ?? `post-${cleanSlug}-${Date.now().toString(36)}`,
              title: title.trim(),
              slug: cleanSlug,
              excerpt: excerpt.trim(),
              contentHtml,
              coverUrl: coverUrl.trim() || null,
              status,
              authorUid: editingPost?.authorUid ?? adminUid,
              createdAt: editingPost?.createdAt ?? nowIso,
              updatedAt: nowIso,
              publishedAt:
                status === 'published' ? editingPost?.publishedAt ?? nowIso : null,
            };

            const validation = validateBlogPostDraft(candidate);
            if (Object.keys(validation).length > 0) {
              setErrors(validation);
              return;
            }

            setSaving(true);
            setErrors({});
            try {
              const saved = await saveBlogPostBatch({
                post: candidate,
                isNew: !editingPost,
                adminUid,
              });
              setPosts((prev) =>
                editingPost
                  ? prev.map((p) => (p.id === saved.id ? saved : p))
                  : [saved, ...prev]
              );
              setModalOpen(false);
              onMutateSuccess();
              onNotify(
                editingPost ? `Updated "${saved.title}"` : `Created "${saved.title}"`,
                'success'
              );
            } catch (err) {
              onNotify(err instanceof Error ? err.message : 'Failed to save blog post.', 'error');
            } finally {
              setSaving(false);
            }
          }}
          className="space-y-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="post-title" className="mb-1 block text-xs text-zinc-500">
                Post Title *
              </label>
              <input
                id="post-title"
                type="text"
                required
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (!slugDirty) setSlug(slugify(e.target.value));
                }}
                className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
              />
              {errors.title && <p className="mt-1 text-xs text-rose-500">{errors.title}</p>}
            </div>
            <div>
              <label htmlFor="post-slug" className="mb-1 block text-xs text-zinc-500">
                URL Slug (#/blog/...) *
              </label>
              <input
                id="post-slug"
                type="text"
                required
                value={slug}
                onChange={(e) => {
                  setSlugDirty(true);
                  setSlug(slugify(e.target.value));
                }}
                className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 font-mono text-xs dark:border-zinc-700"
              />
              {errors.slug && <p className="mt-1 text-xs text-rose-500">{errors.slug}</p>}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label htmlFor="post-cover" className="mb-1 block text-xs text-zinc-500">
                Cover Image URL (optional)
              </label>
              <input
                id="post-cover"
                type="url"
                value={coverUrl}
                onChange={(e) => setCoverUrl(e.target.value)}
                placeholder="https://..."
                className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-xs dark:border-zinc-700"
              />
            </div>
            <div>
              <label htmlFor="post-status" className="mb-1 block text-xs text-zinc-500">
                Status
              </label>
              <select
                id="post-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as BlogPostStatus)}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-900"
              >
                <option value="draft">Draft</option>
                <option value="published">Published</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="post-excerpt" className="mb-1 block text-xs text-zinc-500">
              Excerpt *
            </label>
            <textarea
              id="post-excerpt"
              rows={2}
              required
              value={excerpt}
              onChange={(e) => setExcerpt(e.target.value)}
              placeholder="Brief summary shown on the blog index..."
              className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-xs dark:border-zinc-700"
            />
            {errors.excerpt && <p className="mt-1 text-xs text-rose-500">{errors.excerpt}</p>}
          </div>

          <div>
            <p className="mb-1 text-xs text-zinc-500">Article Content *</p>
            <RichHtmlEditorBox value={contentHtml} onChange={setContentHtml} rows={9} />
            {errors.contentHtml && (
              <p className="mt-1 text-xs text-rose-500">{errors.contentHtml}</p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-xs font-semibold dark:border-zinc-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--kv-accent,#e50914)] px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {saving ? 'Saving...' : editingPost ? 'Save Post' : 'Create Post'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Publish Draft Confirm */}
      <ConfirmDialog
        open={Boolean(publishingPost)}
        title="Publish Blog Post"
        message={`Publish "${publishingPost?.title}" so it becomes visible to all signed-in and signed-out visitors?`}
        confirmLabel="Publish Now"
        loading={actionBusy}
        onCancel={() => setPublishingPost(null)}
        onConfirm={async () => {
          if (!publishingPost) return;
          setActionBusy(true);
          try {
            const saved = await saveBlogPostBatch({
              post: { ...publishingPost, status: 'published' },
              isNew: false,
              adminUid,
            });
            setPosts((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
            setPublishingPost(null);
            onMutateSuccess();
            onNotify(`Published "${saved.title}"`, 'success');
          } catch (err) {
            onNotify(err instanceof Error ? err.message : 'Failed to publish post.', 'error');
          } finally {
            setActionBusy(false);
          }
        }}
      />

      {/* Delete Blog Post Confirm */}
      <ConfirmDialog
        open={Boolean(deletingPost)}
        title="Delete Blog Post"
        message={`Are you sure you want to permanently delete "${deletingPost?.title}"?`}
        confirmLabel="Delete"
        danger
        loading={actionBusy}
        onCancel={() => setDeletingPost(null)}
        onConfirm={async () => {
          if (!deletingPost) return;
          setActionBusy(true);
          try {
            await deleteBlogPostBatch({ postId: deletingPost.id, adminUid });
            setPosts((prev) => prev.filter((p) => p.id !== deletingPost.id));
            setDeletingPost(null);
            onMutateSuccess();
            onNotify(`Deleted "${deletingPost.title}"`, 'success');
          } catch (err) {
            onNotify(err instanceof Error ? err.message : 'Failed to delete post.', 'error');
          } finally {
            setActionBusy(false);
          }
        }}
      />
    </div>
  );
}
