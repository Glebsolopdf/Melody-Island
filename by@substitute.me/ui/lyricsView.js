import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

const LYRICS_HEIGHT = 36;
const SCROLL_DELAY = 400;
const SCROLL_END_PAUSE = 650;
const SCROLL_SPEED = 60;

export class LyricsView {
    constructor() {
        this.actor = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            style_class: 'melody-lyrics',
            height: LYRICS_HEIGHT,
            x_expand: true,
            clip_to_allocation: true,
            visible: false,
        });
        this.backdrop = new St.Bin({
            style_class: 'melody-lyrics-backdrop',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        this.viewport = new St.Widget({
            layout_manager: new Clutter.FixedLayout(),
            clip_to_allocation: true,
        });
        this.line = new St.Label({style_class: 'melody-lyrics-line'});
        this.line.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this.line.clutter_text.single_line_mode = true;
        this.viewport.add_child(this.line);
        this.backdrop.set_child(this.viewport);
        this.actor.add_child(this.backdrop);
        this.actor.connect('notify::mapped', () => this.updateScroll());
        this.line.connect('style-changed', () => this.updateScroll());
        this.actor.connect('destroy', () => this.timeline?.stop());
    }

    setLyrics(lyrics) {
        if (lyrics === this.lyrics)
            return;

        this.lyrics = lyrics;
        this.lines = lyrics?.lines;
        this.firstLineAt = this.lines?.find(line => line.text)?.at ?? 0;
        const seconds = Math.floor(this.firstLineAt / 1_000_000);
        const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
        // Translators: %s is a playback timestamp such as 0:48.
        this.introText = _('Lyrics start at %s').format(time);
        this.showLine('');
        this.actor.visible = !!this.lines?.length;
    }

    updatePosition(position) {
        if (!this.lines)
            return;

        if (position < this.firstLineAt) {
            this.showLine(this.showIntro ? this.introText : '');
            return;
        }

        let start = 0;
        let end = this.lines.length;
        while (start < end) {
            const middle = Math.floor((start + end) / 2);
            if (this.lines[middle].at <= position)
                start = middle + 1;
            else
                end = middle;
        }
        this.showLine(this.lines[start - 1]?.text ?? '');
    }

    showLine(text) {
        if (text === this.line.text)
            return;

        this.line.text = text;
        this.backdrop.visible = !!text;
        this.updateScroll();
    }

    setWidth(width) {
        if (width === this.width)
            return;

        this.width = width;
        this.updateScroll();
    }

    configure({showIntro, scroll, opacity}) {
        this.showIntro = showIntro;
        if (opacity !== this.backgroundOpacity) {
            this.backgroundOpacity = opacity;
            this.backdrop.style = `background-color: rgba(12,12,16,${opacity / 100});`;
        }
        if (scroll !== this.scrollLongLines) {
            this.scrollLongLines = scroll;
            this.updateScroll();
        }
    }

    updateScroll() {
        this.timeline?.stop();
        this.timeline = null;
        this.line.translation_x = 0;
        if (!this.actor.mapped || !this.line.text || !this.width)
            return;

        const padding = this.actor.get_theme_node().get_horizontal_padding() +
            this.backdrop.get_theme_node().get_horizontal_padding();
        this.line.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this.line.set_width(-1);
        const [, natural] = this.line.get_preferred_width(-1);
        const lineWidth = Math.ceil(natural);
        const viewportWidth = Math.max(1, Math.min(lineWidth, Math.floor(this.width - padding)));
        this.line.set_width(this.scrollLongLines ? lineWidth : viewportWidth);
        this.viewport.set_width(viewportWidth);
        const distance = lineWidth - viewportWidth;
        if (!this.scrollLongLines) {
            this.line.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            return;
        }
        if (distance <= 0)
            return;

        const travel = Math.max(500, Math.ceil(distance / SCROLL_SPEED * 1000));
        this.timeline = Clutter.Timeline.new_for_actor(this.line, SCROLL_DELAY + travel + SCROLL_END_PAUSE);
        this.timeline.set_repeat_count(-1);
        this.timeline.connect('new-frame', (_timeline, elapsed) => {
            const progress = Math.max(0, Math.min(1, (elapsed - SCROLL_DELAY) / travel));
            this.line.translation_x = -distance * progress;
        });
        this.timeline.start();
    }
}
