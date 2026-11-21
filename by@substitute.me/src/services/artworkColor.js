import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';

// Only sample artwork in memory; the visible image is loaded by Gio.FileIcon.
export class ArtworkColor {
    constructor(onChange) {
        this.onChange = onChange;
        this.uri = null;
        this.cancel = null;
        this.generation = 0;
    }

    setUri(uri) {
        if (uri === this.uri) return;
        this.uri = uri;
        this.cancel?.cancel();
        this.cancel = new Gio.Cancellable();
        const cancel = this.cancel;
        const generation = ++this.generation;
        this.onChange(null);
        if (typeof uri !== 'string' || !/^(file|https?):\/\//i.test(uri)) return;
        let file;
        try { file = Gio.File.new_for_uri(uri); } catch (_) { return; }
        file.read_async(GLib.PRIORITY_DEFAULT, cancel, (source, result) => {
            let stream;
            try { stream = source.read_finish(result); } catch (_) { return; }
            GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(stream, 48, 48, true, cancel, (_source, res) => {
                try {
                    const pixbuf = GdkPixbuf.Pixbuf.new_from_stream_finish(res);
                    if (cancel.is_cancelled() || generation !== this.generation) return;
                    const pixels = pixbuf.get_pixels();
                    const channels = pixbuf.get_n_channels(), stride = pixbuf.get_rowstride();
                    const sums = [0, 0, 0]; let weight = 0;
                    for (let y = 0; y < pixbuf.get_height(); y++) {
                        for (let x = 0; x < pixbuf.get_width(); x++) {
                            const at = y * stride + x * channels;
                            const r = pixels[at] / 255, g = pixels[at + 1] / 255, b = pixels[at + 2] / 255;
                            const max = Math.max(r, g, b), saturation = max - Math.min(r, g, b);
                            if (max < 0.12 || (max > 0.97 && saturation < 0.12)) continue;
                            const w = 0.05 + saturation * saturation * 3;
                            sums[0] += r * w; sums[1] += g * w; sums[2] += b * w; weight += w;
                        }
                    }
                    if (weight) {
                        const rgb = sums.map(v => v / weight), max = Math.max(...rgb);
                        this.onChange(rgb.map(v => Math.min(1, v * (0.90 / Math.max(0.1, max)))));
                    }
                } catch (_) {
                    // Artwork remains visible via Gio.FileIcon even if color sampling fails.
                } finally {
                    stream.close_async(GLib.PRIORITY_DEFAULT, null, null);
                }
            });
        });
    }

    destroy() { this.generation++; this.cancel?.cancel(); }
}
