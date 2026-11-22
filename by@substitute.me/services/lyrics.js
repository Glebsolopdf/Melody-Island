import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

const API_URL = 'https://lrclib.net/api';
const CACHE_LIMIT = 32;
const LYRICS_LIMIT = 32_000;
const LYRICS_TTL = 10 * 60 * GLib.USEC_PER_SEC;
const MISSING_TTL = 60 * GLib.USEC_PER_SEC;
const REQUEST_INTERVAL = 1500 * 1000;
const HTTP_TOO_MANY_REQUESTS = 429;

async function waitForRequestSlot(milliseconds, cancellable) {
    let cancelId;
    await new Promise(resolve => {
        let timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => {
            timer = 0;
            resolve();
            return GLib.SOURCE_REMOVE;
        });
        cancelId = cancellable.connect(() => {
            if (timer)
                GLib.source_remove(timer);
            resolve();
        });
    });
    if (cancelId)
        cancellable.disconnect(cancelId);
}

function normalize(value) {
    return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function lyricsQuery(metadata) {
    const clean = value => typeof value === 'string' ? value.trim() : '';
    const title = clean(metadata?.['xesam:title']);
    const artists = metadata?.['xesam:artist'];
    const artist = Array.isArray(artists) ? clean(artists[0]) : '';
    if (!title || !artist || title.length > 512 || artist.length > 512)
        return null;

    const query = {track_name: title, artist_name: artist};
    const album = clean(metadata['xesam:album']);
    if (album && album.length <= 512)
        query.album_name = album;
    const duration = Math.round(Number(metadata['mpris:length']) / GLib.USEC_PER_SEC);
    if (duration >= 1 && duration <= 3600)
        query.duration = duration;
    return query;
}

function matchSearch(records, query) {
    const title = normalize(query.track_name);
    const artist = normalize(query.artist_name);
    const album = normalize(query.album_name);
    const distance = record => query.duration ? Math.abs(query.duration - record.duration) : 0;
    const sameAlbum = record => Number(!!album && normalize(record.albumName) === album);
    return records.filter(record => record &&
        typeof record.syncedLyrics === 'string' && record.syncedLyrics.trim() &&
        normalize(record.trackName) === title &&
        normalize(record.artistName) === artist &&
        distance(record) <= 5)
        .sort((a, b) => sameAlbum(b) - sameAlbum(a) || distance(a) - distance(b))[0];
}

function readLyrics(record) {
    if (record?.instrumental)
        return {instrumental: true};
    const synced = typeof record?.syncedLyrics === 'string' ? record.syncedLyrics : '';
    const lines = [];
    if (synced.length <= LYRICS_LIMIT) {
        const offset = Number(synced.match(/^\[offset:([+-]?\d+)\]/im)?.[1] ?? 0);
        for (const row of synced.split(/\r?\n/)) {
            const prefix = row.match(/^(?:\[\d+:\d{2}(?:[.:]\d+)?\])+/)?.[0];
            if (!prefix)
                continue;
            const text = row.slice(prefix.length).trim();
            for (const [, minutes, seconds, fraction = '0'] of prefix.matchAll(/\[(\d+):(\d{2})(?:[.:](\d+))?\]/g)) {
                const at = (+minutes * 60 + +seconds + Number(`0.${fraction}`)) * GLib.USEC_PER_SEC - offset * 1000;
                if (Number.isFinite(at))
                    lines.push({at, text});
            }
        }
    }
    if (lines.some(line => line.text))
        return {lines: lines.sort((a, b) => a.at - b.at)};

    return null;
}

export class Lyrics {
    constructor(version) {
        this.session = new Soup.Session({
            timeout: 10,
            user_agent: `Melody Island v${version} (https://github.com/Glebsolopdf/Melody-Island)`,
        });
        this.cache = new Map();
        this.expiryId = 0;
        this.retryAt = 0;
        this.nextRequestAt = 0;
        this.requestQueue = Promise.resolve();
        this.closed = false;
    }

    async lookup(query, key, cancellable) {
        if (this.closed || cancellable.is_cancelled())
            return null;

        const now = GLib.get_monotonic_time();
        const cached = this.cache.get(key);
        this.cache.delete(key);
        if (cached?.expires > now) {
            this.cache.set(key, cached);
            return cached.result;
        }

        let result = readLyrics(await this.request('get', query, cancellable));
        if (!result && !cancellable.is_cancelled()) {
            const {track_name, artist_name} = query;
            const records = await this.request('search', {track_name, artist_name}, cancellable);
            if (Array.isArray(records))
                result = readLyrics(matchSearch(records, query));
        }
        if (this.closed || cancellable.is_cancelled())
            return null;

        this.cache.set(key, {
            result,
            expires: GLib.get_monotonic_time() + (result ? LYRICS_TTL : MISSING_TTL),
        });
        if (this.cache.size > CACHE_LIMIT)
            this.cache.delete(this.cache.keys().next().value);
        this.scheduleExpiry();
        return result;
    }

    request(endpoint, query, cancellable) {
        const request = this.requestQueue.then(() => this.sendWhenAllowed(endpoint, query, cancellable));
        this.requestQueue = request.catch(() => {});
        return request;
    }

    async sendWhenAllowed(endpoint, query, cancellable) {
        if (this.closed || cancellable.is_cancelled())
            return null;

        const now = GLib.get_monotonic_time();
        if (now < this.retryAt)
            throw new Error('LRCLIB retry delay is active');

        const delay = Math.ceil((this.nextRequestAt - now) / 1000);
        if (delay > 0)
            await waitForRequestSlot(delay, cancellable);
        if (this.closed || cancellable.is_cancelled())
            return null;

        try {
            return await this.sendRequest(endpoint, query, cancellable);
        } finally {
            this.nextRequestAt = GLib.get_monotonic_time() + REQUEST_INTERVAL;
        }
    }

    sendRequest(endpoint, query, cancellable) {
        const params = Object.entries(query)
            .map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('&');
        const message = Soup.Message.new('GET', `${API_URL}/${endpoint}?${params}`);
        message.request_headers.append('Accept', 'application/json');
        return new Promise((resolve, reject) => {
            this.session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable, (session, response) => {
                try {
                    const bytes = session.send_and_read_finish(response);
                    const status = message.status_code;
                    if (status === Soup.Status.NOT_FOUND) {
                        resolve(null);
                        return;
                    }
                    if (status === HTTP_TOO_MANY_REQUESTS || status === Soup.Status.SERVICE_UNAVAILABLE) {
                        const retryAfter = message.response_headers.get_one('Retry-After')?.trim() ?? '';
                        const seconds = /^\d+$/.test(retryAfter)
                            ? Number(retryAfter)
                            : (Date.parse(retryAfter) - Date.now()) / 1000;
                        const fallback = status === HTTP_TOO_MANY_REQUESTS ? 60 : 30;
                        const wait = Math.max(1, Number.isFinite(seconds) ? seconds : fallback);
                        this.retryAt = GLib.get_monotonic_time() + wait * (1 + Math.random() * 0.2) * GLib.USEC_PER_SEC;
                    }
                    if (status !== Soup.Status.OK)
                        throw new Error(`LRCLIB returned HTTP ${status}`);
                    resolve(JSON.parse(new TextDecoder().decode(bytes.get_data())));
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    scheduleExpiry() {
        if (this.expiryId)
            GLib.source_remove(this.expiryId);
        this.expiryId = 0;
        if (!this.cache.size)
            return;

        const next = Math.min(...Array.from(this.cache.values(), entry => entry.expires));
        const delay = Math.max(1, Math.ceil((next - GLib.get_monotonic_time()) / 1000));
        this.expiryId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this.expiryId = 0;
            const now = GLib.get_monotonic_time();
            for (const [key, entry] of this.cache) {
                if (entry.expires <= now)
                    this.cache.delete(key);
            }
            this.scheduleExpiry();
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        this.closed = true;
        if (this.expiryId)
            GLib.source_remove(this.expiryId);
        this.expiryId = 0;
        this.cache.clear();
        this.session.abort();
    }
}
