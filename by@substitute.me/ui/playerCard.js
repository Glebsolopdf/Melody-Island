import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';
import {updateCoverIcon} from './coverIcon.js';
import {LyricsView} from './lyricsView.js';

export class PlayerCard {
    constructor(settings, {widthKey, coverSizeKey, styleClass}, drawWave, getMpris) {
        this.settings = settings;
        this.widthKey = widthKey;
        this.coverSizeKey = coverSizeKey;
        this.getMpris = getMpris;

        this.actor = new St.Widget({layout_manager: new Clutter.BinLayout(), x_expand: true});
        if (styleClass)
            this.actor.add_style_class_name(styleClass);
        this.wave = new St.DrawingArea({
            style_class: 'melody-wave',
            x_expand: true,
            y_expand: true,
            reactive: false,
        });
        this.wave.connect('repaint', drawWave);
        this.actor.add_child(this.wave);

        const foreground = new St.BoxLayout({vertical: true, x_expand: true});
        this.content = new St.BoxLayout({style_class: 'melody-content', x_expand: true});
        this.lyricsView = new LyricsView();
        foreground.add_child(this.content);
        foreground.add_child(this.lyricsView.actor);
        this.actor.add_child(foreground);

        this.cover = new St.Bin({style_class: 'melody-cover', y_align: Clutter.ActorAlign.CENTER});
        this.coverIcon = new St.Icon({
            icon_name: 'audio-x-generic-symbolic',
            style_class: 'melody-cover-icon',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.cover.set_child(this.coverIcon);
        this.content.add_child(this.cover);

        const details = new St.BoxLayout({
            vertical: true,
            style_class: 'melody-details',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.content.add_child(details);
        const header = new St.BoxLayout({style_class: 'melody-top', x_expand: true});
        const labels = new St.BoxLayout({
            vertical: true,
            style_class: 'melody-labels',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.track = new St.Label({style_class: 'melody-track', text: 'Нет музыки'});
        this.artist = new St.Label({style_class: 'melody-artist'});
        labels.add_child(this.track);
        labels.add_child(this.artist);
        header.add_child(labels);

        const controls = new St.BoxLayout({style_class: 'melody-controls', y_align: Clutter.ActorAlign.CENTER});
        this.prev = this.playbackButton('media-skip-backward-symbolic', 'Previous');
        this.play = this.playbackButton('media-playback-start-symbolic', 'PlayPause');
        this.play.add_style_class_name('melody-play');
        this.next = this.playbackButton('media-skip-forward-symbolic', 'Next');
        for (const button of [this.prev, this.play, this.next])
            controls.add_child(button);
        header.add_child(controls);
        details.add_child(header);

        this.progress = new Slider.Slider(0);
        details.add_child(this.progress);
        this.progress.connect('drag-begin', () => { this.dragging = true; });
        this.progress.connect('drag-end', () => {
            if (!this.dragging)
                return;
            this.dragging = false;
            this.getMpris()?.seek(this.progress.value);
        });
        this.progress.connect('scroll-event', () => Clutter.EVENT_STOP);

        const times = new St.BoxLayout({style_class: 'melody-times'});
        this.elapsed = new St.Label({text: '0:00', style_class: 'melody-time'});
        this.duration = new St.Label({text: '—', style_class: 'melody-time'});
        times.add_child(this.elapsed);
        times.add_child(new St.Widget({x_expand: true}));
        times.add_child(this.duration);
        details.add_child(times);
        this.message = new St.Label({style_class: 'melody-message'});
        details.add_child(this.message);

        this.playerLabel = new St.Label({style_class: 'melody-player-choice-label'});
        this.playerButton = new St.Button({
            style_class: 'melody-player-choice',
            child: this.playerLabel,
            can_focus: true,
            x_align: Clutter.ActorAlign.START,
        });
        this.playerButton.connect('clicked', () => {
            const mpris = this.getMpris();
            if (!mpris || mpris.players.size < 2)
                return;
            const players = Array.from(mpris.players.values());
            const next = (players.indexOf(mpris.active) + 1) % players.length;
            mpris.select(players[next].name);
        });
        details.add_child(this.playerButton);
        this.resize();
    }

    playbackButton(iconName, method) {
        const button = new St.Button({
            style_class: 'melody-control',
            can_focus: true,
            child: new St.Icon({icon_name: iconName, icon_size: 20}),
        });
        button.connect('clicked', () => this.getMpris()?.action(method));
        return button;
    }

    resize() {
        const width = this.settings.get_int(this.widthKey);
        const size = this.settings.get_int(this.coverSizeKey);
        this.actor.set_width(width + 32);
        this.lyricsView.setWidth(width + 32);
        this.content.set_height(Math.max(size + 32, 128));
        this.content.style = `width: ${width}px;`;
        this.cover.style = `width: ${size}px; height: ${size}px;`;
    }

    setArtwork(icon) {
        updateCoverIcon(this.coverIcon, icon, this.settings.get_int(this.coverSizeKey));
    }

    setColor(hex) {
        this.progress.style = hex ? `-barlevel-active-background-color: ${hex};` : '';
        this.wave.queue_repaint();
    }

    update(player, title, artist, playerCount, error) {
        this.resize();
        if (this.player !== player || this.trackRevision !== player?.trackRevision) {
            this.player = player;
            this.trackRevision = player?.trackRevision;
            this.dragging = false;
        }
        if (this.track.text !== title || this.artist.text !== artist) {
            this.track.text = title;
            this.artist.text = artist;
            if (this.settings.get_boolean('animations')) {
                for (const actor of [this.track, this.artist, this.cover]) {
                    actor.remove_all_transitions();
                    actor.opacity = 0;
                    actor.translation_y = 5;
                    actor.ease({opacity: 255, translation_y: 0, duration: 220, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
                }
            }
        }

        const playing = player?.status === 'Playing';
        this.play.child.icon_name = playing ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        this.play.reactive = !!(playing ? player.canPause : player?.canPlay);
        this.prev.reactive = !!player?.canPrevious;
        this.next.reactive = !!player?.canNext;
        this.progress.reactive = !!player?.canSeek && Number(player.metadata['mpris:length'] || 0) > 0;
        this.playerButton.visible = playerCount > 1;
        this.playerLabel.text = player ? `${player.identity}  ▾` : '';
        this.message.text = error;
        this.message.visible = !!error;
    }

    updateProgress(elapsed, duration, fraction) {
        this.elapsed.text = elapsed;
        this.duration.text = duration;
        if (!this.dragging)
            this.progress.value = fraction;
    }
}
