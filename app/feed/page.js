'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Compass, Play, Plus, MapPin, Eye, Lock, Globe, Loader2, Sparkles } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getFlagEmoji } from '../../components/NavBar';
import { VerifiedBadge } from '../../components/VerifiedBadge';

export default function FeedPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadFeed() {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) {
        router.push('/auth');
        return;
      }
      setUser(currentUser);

      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) return;

      try {
        // Load profile info
        const profileRes = await fetch('/api/profile', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (profileRes.ok) {
          const currentProfile = await profileRes.json();
          setProfile(currentProfile);
        }

        // Fetch public videos
        const res = await fetch('/api/videos', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        const data = await res.json();
        setVideos(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Error fetching videos feed:', err);
      } finally {
        setLoading(false);
      }
    }

    loadFeed();
  }, [router]);

  function startWatchParty(videoKey) {
    const randomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const name = profile?.username || 'Host';
    router.push(`/room/${randomCode}?username=${encodeURIComponent(name)}&video=${encodeURIComponent(videoKey)}`);
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-12 bg-[#07070a] min-h-[90vh]">
        <div className="flex flex-col gap-2 mb-10">
          <div className="h-8 w-48 bg-zinc-900 animate-pulse rounded-lg" />
          <div className="h-4 w-72 bg-zinc-900/60 animate-pulse rounded-md" />
        </div>
        
        {/* Skeleton Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="rounded-2xl border border-zinc-800 bg-zinc-900/10 p-4 flex flex-col gap-3">
              <div className="aspect-video w-full bg-zinc-900 animate-pulse rounded-xl" />
              <div className="flex gap-3">
                <div className="w-9 h-9 bg-zinc-900 animate-pulse rounded-full" />
                <div className="flex-1 flex flex-col gap-1.5">
                  <div className="h-4 bg-zinc-900 animate-pulse rounded w-3/4" />
                  <div className="h-3 bg-zinc-900/60 animate-pulse rounded w-1/2" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-12 bg-[#07070a] min-h-[90vh]">
      {/* Header Area */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-10 pb-6 border-b border-zinc-900">
        <div>
          <h1 className="text-3xl font-black text-white flex items-center gap-2 tracking-tight">
            <Compass className="w-7 h-7 text-violet-400" />
            Explore Feed
          </h1>
          <p className="text-sm text-zinc-400 mt-1.5">
            Discover public uploads and start real-time synchronized video parties with friends
          </p>
        </div>

        {/* Upload Action on Right */}
        <button
          onClick={() => router.push('/upload')}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-white cursor-pointer active:scale-95 transition-all shadow-md"
        >
          <Plus className="w-4 h-4 text-violet-400" />
          <span>Upload New Video</span>
        </button>
      </div>

      {/* Grid List */}
      {videos.length === 0 ? (
        <div className="max-w-md mx-auto my-16 p-8 rounded-3xl bg-zinc-900/20 border border-zinc-900 text-center flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800/80 flex items-center justify-center text-2xl text-zinc-500 shadow-inner">
            📭
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Your Feed is Empty</h3>
            <p className="text-xs text-zinc-500 mt-1 max-w-[280px]">
              No public videos have been uploaded yet. Upload a clip to kick off the watch feed!
            </p>
          </div>
          <button 
            onClick={() => router.push('/upload')}
            className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-600 active:scale-98 text-white font-semibold text-xs cursor-pointer shadow-lg shadow-violet-900/10 transition-all"
          >
            Upload a Video
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {videos.map((video, idx) => (
            <div 
              key={video.key || idx} 
              className="group flex flex-col bg-zinc-900/20 border border-zinc-900 hover:border-zinc-800/80 rounded-2xl overflow-hidden hover:shadow-2xl hover:shadow-black/40 transition-all duration-300 relative"
            >
              {/* Thumbnail Container */}
              <div className="aspect-video w-full bg-zinc-950 relative overflow-hidden flex items-center justify-center">
                {/* Play Button Overlay */}
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all duration-300 z-10">
                  <button 
                    onClick={() => startWatchParty(video.key)}
                    className="w-12 h-12 rounded-full bg-violet-600 hover:bg-violet-500 active:scale-95 text-white flex items-center justify-center shadow-lg shadow-violet-900/35 transition-all cursor-pointer"
                  >
                    <Play className="w-5 h-5 fill-current ml-0.5" />
                  </button>
                </div>

                {video.thumbnailUrl ? (
                  <img 
                    src={video.thumbnailUrl} 
                    alt={video.name} 
                    className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-500" 
                  />
                ) : (
                  <div className="flex flex-col items-center gap-1.5">
                    <span className="text-3xl">🎬</span>
                    <span className="text-[10px] uppercase tracking-wider text-zinc-600 font-bold">Watch Party Clip</span>
                  </div>
                )}
              </div>

              {/* Card Details */}
              <div className="p-4 flex gap-3 items-start flex-1">
                {/* Avatar Icon */}
                <div className="flex-shrink-0">
                  {video.avatarUrl ? (
                    <img 
                      src={video.avatarUrl} 
                      alt={video.uploaderName} 
                      className="w-8 h-8 rounded-full border border-zinc-800 object-cover" 
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-400 border border-zinc-800 uppercase">
                      {video.uploaderName.charAt(0)}
                    </div>
                  )}
                </div>

                {/* Meta details */}
                <div className="flex-1 min-w-0 flex flex-col justify-between h-full">
                  <div>
                    <h3 
                      className="text-sm font-semibold text-zinc-200 truncate leading-snug hover:text-white transition-colors cursor-pointer"
                      onClick={() => startWatchParty(video.key)}
                      title={video.name}
                    >
                      {video.name}
                    </h3>

                    {/* Uploader Details */}
                    <div className="flex flex-col mt-1">
                      <span className="text-xs text-zinc-400 flex items-center gap-1 truncate font-medium">
                        {video.uploaderName}
                        {video.isVerified && <VerifiedBadge size={12} />}
                        {video.country && (
                          <span className="text-xs">{getFlagEmoji(video.country)}</span>
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Tag and Button row */}
                  <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-zinc-900/60">
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-zinc-500">
                      {video.isPrivate ? (
                        <>
                          <Lock className="w-2.5 h-2.5 text-zinc-500" />
                          <span>Friends Only</span>
                        </>
                      ) : (
                        <>
                          <Globe className="w-2.5 h-2.5 text-zinc-500" />
                          <span>Public</span>
                        </>
                      )}
                    </span>

                    <button
                      onClick={() => startWatchParty(video.key)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-800 text-zinc-300 hover:text-white text-[11px] font-bold border border-zinc-800/80 transition-all cursor-pointer active:scale-95"
                    >
                      <Sparkles className="w-2.5 h-2.5 text-violet-400" />
                      <span>Watch</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
