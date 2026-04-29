// public/js/api.js — 所有网易云请求通过服务端代理，避免 CORS

export const netease = {
  async search(keywords, limit = 20) {
    const res = await fetch(`/api/netease/search?keywords=${encodeURIComponent(keywords)}&limit=${limit}`);
    const data = await res.json();
    if (!data.result?.songs) return [];
    return data.result.songs.map(s => ({
      id: s.id.toString(),
      name: s.name,
      artist: s.ar.map(a => a.name).join('/'),
      album: s.al.name,
      cover: s.al.picUrl,
      duration: Math.floor(s.dt / 1000)
    }));
  },

  async getSongUrl(id) {
    const res = await fetch(`/api/netease/song/url?id=${id}&br=320000`);
    const data = await res.json();
    return data.data?.[0]?.url || null;
  },

  async getLyrics(id) {
    const res = await fetch(`/api/netease/lyric?id=${id}`);
    const data = await res.json();
    return {
      lrc: data.lrc?.lyric || '',
      tlyric: data.tlyric?.lyric || ''
    };
  },

  async getPersonalized(limit = 10) {
    const res = await fetch(`/api/netease/personalized?limit=${limit}`);
    const data = await res.json();
    return data.result || [];
  },

  async getLoginStatus() {
    const res = await fetch('/api/netease/login-status');
    return res.json();
  },

  async getMyLikes(limit = 300) {
    const res = await fetch(`/api/netease/me/likes?limit=${limit}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  },

  async getPlaylistDetail(id) {
    const res = await fetch(`/api/netease/playlist/detail?id=${id}`);
    const data = await res.json();
    const pl = data.playlist;
    if (!pl) return null;
    return {
      id: pl.id,
      name: pl.name,
      cover: pl.coverImgUrl,
      songs: pl.tracks.map(s => ({
        id: s.id.toString(),
        name: s.name,
        artist: s.ar.map(a => a.name).join('/'),
        album: s.al.name,
        cover: s.al.picUrl,
        duration: Math.floor(s.dt / 1000)
      }))
    };
  }
};

// Server API wrapper
export const server = {
  async get(url) {
    const res = await fetch(url);
    return res.json();
  },
  async post(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return res.json();
  },
  async put(url, body) {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return res.json();
  },
  async del(url) {
    const res = await fetch(url, { method: 'DELETE' });
    return res.json();
  }
};
