import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';

const COVER_SIZE = 320;

function artworkUri(uri) {
    if (typeof uri !== 'string')
        return '';
    const spotifyImage = /^spotify:image:([0-9a-f]{40})$/i.exec(uri);
    if (spotifyImage)
        return `https://i.scdn.co/image/${spotifyImage[1]}`;
    return /^(file|https?):\/\//i.test(uri) ? uri : '';
}

function readFile(uri, cancel) {
    const file = Gio.File.new_for_uri(uri);
    return new Promise((resolve, reject) => {
        file.read_async(GLib.PRIORITY_DEFAULT, cancel, (source, result) => {
            try {
                resolve(source.read_finish(result));
            } catch (error) {
                reject(error);
            }
        });
    });
}

function readPixbuf(stream, cancel) {
    return new Promise((resolve, reject) => {
        GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(stream, COVER_SIZE, COVER_SIZE, true, cancel, (_source, result) => {
            try {
                resolve(GdkPixbuf.Pixbuf.new_from_stream_finish(result));
            } catch (error) {
                reject(error);
            } finally {
                stream.close_async(GLib.PRIORITY_DEFAULT, null, null);
            }
        });
    });
}

function readEmbeddedCover(uri, cancel) {
    const path = Gio.File.new_for_uri(uri).get_path();
    const ffmpeg = GLib.find_program_in_path('ffmpeg');
    if (!path || !ffmpeg || cancel.is_cancelled())
        return null;

    const process = Gio.Subprocess.new([
        ffmpeg, '-v', 'error', '-nostdin', '-protocol_whitelist', 'file,pipe', '-i', path,
        '-map', '0:v:disp:attached_pic', '-frames:v', '1',
        '-vf', `scale=${COVER_SIZE}:${COVER_SIZE}:force_original_aspect_ratio=decrease`,
        '-c:v', 'mjpeg', '-f', 'image2pipe', 'pipe:1',
    ], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);

    return new Promise((resolve, reject) => {
        const cancelId = cancel.connect(() => process.force_exit());
        let timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
            timeout = 0;
            process.force_exit();
            return GLib.SOURCE_REMOVE;
        });
        process.communicate_async(null, cancel, (source, result) => {
            cancel.disconnect(cancelId);
            if (timeout)
                GLib.source_remove(timeout);
            try {
                const [, bytes] = source.communicate_finish(result);
                const stream = source.get_successful() && bytes?.get_size()
                    ? Gio.MemoryInputStream.new_from_bytes(bytes)
                    : null;
                resolve(stream);
            } catch (error) {
                reject(error);
            }
        });
    });
}

function sampleColor(pixbuf) {
    const sample = pixbuf.scale_simple(48, 48, GdkPixbuf.InterpType.BILINEAR);
    const pixels = sample.get_pixels();
    const channels = sample.get_n_channels();
    const stride = sample.get_rowstride();
    const sums = [0, 0, 0];
    let weight = 0;
    for (let y = 0; y < sample.get_height(); y++) {
        for (let x = 0; x < sample.get_width(); x++) {
            const at = y * stride + x * channels;
            const r = pixels[at] / 255;
            const g = pixels[at + 1] / 255;
            const b = pixels[at + 2] / 255;
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            if (max < 0.12 || (max > 0.97 && min > 0.75))
                continue;
            const w = 0.05 + (max - min) ** 2 * 0.6;
            sums[0] += r * w;
            sums[1] += g * w;
            sums[2] += b * w;
            weight += w;
        }
    }
    if (!weight)
        return null;

    const rgb = sums.map(value => value / weight);
    const max = Math.max(...rgb);
    return rgb.map(value => Math.min(1, value * (0.90 / Math.max(0.1, max))));
}

export class Artwork {
    constructor(onChange) {
        this.onChange = onChange;
    }

    setSources(artUrl, trackUrl) {
        const cover = artworkUri(artUrl);
        const track = typeof trackUrl === 'string' && /^file:\/\//i.test(trackUrl) ? trackUrl : '';
        if (cover === this.cover && track === this.track)
            return;

        this.cover = cover;
        this.track = track;
        this.cancel?.cancel();
        const cancel = new Gio.Cancellable();
        this.cancel = cancel;
        this.onChange(null, null);
        this.load(cover, track, cancel).then(pixbuf => {
            if (this.cancel !== cancel || !pixbuf)
                return;

            const [, png] = pixbuf.save_to_bufferv('png', [], []);
            const icon = Gio.BytesIcon.new(new GLib.Bytes(png));
            this.onChange(icon, sampleColor(pixbuf));
        }).catch(() => {
            // The generic icon remains visible when neither source provides artwork.
        });
    }

    async load(cover, track, cancel) {
        if (cover) {
            try {
                return await readPixbuf(await readFile(cover, cancel), cancel);
            } catch (_) {
                // Try the embedded picture if the player's artwork is unavailable.
            }
        }
        if (!track || cancel.is_cancelled())
            return null;

        const stream = await readEmbeddedCover(track, cancel);
        return stream ? readPixbuf(stream, cancel) : null;
    }

    destroy() {
        this.cancel?.cancel();
        this.cancel = null;
    }
}
