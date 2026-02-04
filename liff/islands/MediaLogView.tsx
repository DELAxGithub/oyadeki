import { useEffect, useState } from "preact/hooks";

interface MediaItem {
  id: string;
  media_type: string;
  title: string;
  subtitle: string | null;
  artist_or_cast: string | null;
  year: number | null;
  rating: number | null;
  watched_at: string;
  image_url: string | null;
}

interface MediaData {
  items: MediaItem[];
  totalCount: number;
  typeCounts: Record<string, number>;
}

interface MediaLogViewProps {
  userId: string;
}

const mediaTypeEmoji: Record<string, string> = {
  movie: "🎬",
  tv_show: "📺",
  anime: "🎌",
  sports: "⚽",
  music: "🎵",
  book: "📚",
  other: "📝",
};

const mediaTypeLabel: Record<string, string> = {
  movie: "映画",
  tv_show: "テレビ",
  anime: "アニメ",
  sports: "スポーツ",
  music: "音楽",
  book: "本",
  other: "その他",
};

function getExternalUrl(item: MediaItem): { url: string; label: string } | null {
  const q = encodeURIComponent(item.title);
  switch (item.media_type) {
    case "movie":
    case "tv_show":
      return { url: `https://www.themoviedb.org/search?query=${q}&language=ja`, label: "TMDB" };
    case "music": {
      const artist = item.artist_or_cast ? `+${encodeURIComponent(item.artist_or_cast)}` : "";
      return { url: `https://music.apple.com/jp/search?term=${q}${artist}`, label: "Apple Music" };
    }
    case "book":
      return { url: `https://www.amazon.co.jp/s?k=${q}&i=stripbooks`, label: "Amazon" };
    default:
      return null;
  }
}

export default function MediaLogView({ userId }: MediaLogViewProps) {
  const [data, setData] = useState<MediaData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleDelete = async (item: MediaItem) => {
    if (!confirm(`「${item.title}」の記録を消しますね。\nよろしいですか？`)) return;
    setDeleting(item.id);
    try {
      const res = await fetch(`/api/media/${userId}?id=${item.id}`, { method: "DELETE" });
      if (res.ok && data) {
        const newItems = data.items.filter((i) => i.id !== item.id);
        const typeCounts: Record<string, number> = {};
        for (const i of newItems) {
          typeCounts[i.media_type] = (typeCounts[i.media_type] || 0) + 1;
        }
        setData({ items: newItems, totalCount: newItems.length, typeCounts });
      }
    } catch (_e) {
      alert("うまく消せませんでした。もう一度試してみてください。");
    } finally {
      setDeleting(null);
    }
  };

  useEffect(() => {
    // Mock data for testing
    if (userId === "mock-user" || userId.startsWith("mock-")) {
      setData({
        items: [
          { id: "1", media_type: "anime", title: "機動戦士ガンダム", subtitle: "THE ORIGIN", artist_or_cast: "安彦良和", year: 2015, rating: 5, watched_at: new Date().toISOString(), image_url: null },
          { id: "2", media_type: "movie", title: "君の名は。", subtitle: null, artist_or_cast: "新海誠", year: 2016, rating: 4, watched_at: new Date(Date.now() - 86400000).toISOString(), image_url: null },
          { id: "3", media_type: "tv_show", title: "鬼滅の刃", subtitle: "柱稽古編", artist_or_cast: null, year: 2024, rating: 5, watched_at: new Date(Date.now() - 172800000).toISOString(), image_url: null },
          { id: "4", media_type: "music", title: "Lemon", subtitle: null, artist_or_cast: "米津玄師", year: 2018, rating: 4, watched_at: new Date(Date.now() - 259200000).toISOString(), image_url: null },
          { id: "5", media_type: "sports", title: "WBC 日本 vs アメリカ", subtitle: "決勝", artist_or_cast: null, year: 2023, rating: 5, watched_at: new Date(Date.now() - 345600000).toISOString(), image_url: null },
        ],
        totalCount: 5,
        typeCounts: { anime: 1, movie: 1, tv_show: 1, music: 1, sports: 1 },
      });
      setLoading(false);
      return;
    }

    async function fetchData() {
      try {
        const res = await fetch(`/api/media/${userId}`);
        if (!res.ok) {
          const errData = await res.json();
          setError(errData.error || "エラーが発生しました");
          return;
        }
        const mediaData = await res.json();
        setData(mediaData);
      } catch (_e) {
        setError("通信エラーが発生しました");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [userId]);

  if (loading) {
    return (
      <div class="flex flex-col gap-4 items-center justify-center min-h-screen bg-background-muted">
        <div class="animate-spin w-10 h-10 border-4 border-gray-200 border-t-primary rounded-full"></div>
        <p class="text-gray-500 font-medium">読み込み中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div class="flex flex-col gap-4 items-center justify-center min-h-screen bg-background-muted p-6 text-center">
        <div class="text-4xl">⚠️</div>
        <h2 class="text-xl font-bold text-gray-800">エラー</h2>
        <p class="text-gray-500">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  if (data.totalCount === 0) {
    return (
      <div class="flex flex-col gap-4 items-center justify-center min-h-screen bg-background-muted p-6 text-center">
        <div class="text-5xl">📭</div>
        <h2 class="text-lg font-bold text-gray-800">まだ何も記録していません</h2>
        <p class="text-gray-500 text-sm">テレビや映画の画面を写真で送ると、<br />見たものを記録できますよ！</p>
      </div>
    );
  }

  // 月ごとにグループ化
  const grouped: Record<string, MediaItem[]> = {};
  for (const item of data.items) {
    const d = new Date(item.watched_at);
    const key = `${d.getFullYear()}年${d.getMonth() + 1}月`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(item);
  }

  // 統計バッジ
  const statEntries = Object.entries(data.typeCounts)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div class="min-h-screen bg-background-muted font-sans pb-12">
      <div class="max-w-2xl mx-auto p-4 space-y-4">
        {/* Header */}
        <div class="bg-white rounded-xl border border-gray-200 p-6 text-center shadow-sm">
          <div class="flex items-center justify-center gap-2 mb-2">
            <span class="text-2xl">📖</span>
            <h1 class="text-lg font-bold text-gray-800">視聴記録</h1>
          </div>

          <div class="my-4">
            <div class="text-sm text-gray-500 mb-1">合計</div>
            <div class="text-4xl font-bold text-primary tracking-tight">
              {data.totalCount}<span class="text-lg font-normal text-gray-500 ml-1">件</span>
            </div>
          </div>

          <div class="flex flex-wrap justify-center gap-2">
            {statEntries.map(([type, count]) => (
              <span key={type} class="inline-flex items-center gap-1 px-2.5 py-1 bg-gray-100 rounded-full text-xs font-medium text-gray-700">
                {mediaTypeEmoji[type] || "📝"} {mediaTypeLabel[type] || type} {count}
              </span>
            ))}
          </div>
        </div>

        {/* Grouped List */}
        {Object.entries(grouped).map(([month, items]) => (
          <div key={month}>
            <div class="flex items-center gap-2 mb-2 mt-4">
              <div class="h-px flex-1 bg-gray-300"></div>
              <span class="text-xs font-bold text-gray-500 px-2">{month}</span>
              <div class="h-px flex-1 bg-gray-300"></div>
            </div>

            <div class="space-y-2">
              {items.map((item) => {
                const emoji = mediaTypeEmoji[item.media_type] || "📝";
                const stars = item.rating ? "⭐".repeat(item.rating) : "";
                const watchedDate = new Date(item.watched_at)
                  .toLocaleDateString("ja-JP", { month: "short", day: "numeric" });
                const extLink = getExternalUrl(item);

                return (
                  <div
                    key={item.id}
                    class="bg-white rounded-xl border border-gray-200 p-4 shadow-sm"
                  >
                    <div class="flex items-start gap-3">
                      <span class="text-xl mt-0.5">{emoji}</span>
                      <div class="flex-1 min-w-0">
                        <h3 class="font-bold text-gray-800 leading-tight">
                          {item.title}
                        </h3>
                        {item.subtitle && (
                          <p class="text-xs text-gray-500 mt-0.5">{item.subtitle}</p>
                        )}
                        {item.artist_or_cast && (
                          <p class="text-xs text-gray-500">{item.artist_or_cast}</p>
                        )}
                        <div class="flex items-center gap-2 mt-1.5">
                          {stars && <span class="text-sm">{stars}</span>}
                          {item.year && (
                            <span class="text-[11px] text-gray-400">({item.year})</span>
                          )}
                          {extLink && (
                            <a
                              href={extLink.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              class="text-[11px] text-blue-500 underline ml-auto"
                            >
                              {extLink.label} →
                            </a>
                          )}
                        </div>
                      </div>
                      <div class="flex flex-col items-end gap-1 mt-1">
                        <span class="text-[11px] text-gray-400 whitespace-nowrap">
                          {watchedDate}
                        </span>
                        <button
                          onClick={() => handleDelete(item)}
                          disabled={deleting === item.id}
                          class="text-[11px] text-red-400 hover:text-red-600"
                        >
                          {deleting === item.id ? "..." : "削除"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <div class="mt-8 text-center">
          <p class="text-xs text-gray-400">Powered by Oyadeki</p>
        </div>
      </div>
    </div>
  );
}
