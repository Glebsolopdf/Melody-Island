import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';
import {updateCoverIcon} from './coverIcon.js';

// A separate view of the shared MPRIS / CAVA state, owned by the panel menu.
export class PanelPlayer {
    constructor(menu, settings, drawWave, getMpris) {
        this.settings = settings;
        this.getMpris = getMpris;
        menu.box.add_style_class_name('melody-popup');
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false, style_class: 'melody-menu-item'});
        this.layer = new St.Widget({layout_manager: new Clutter.BinLayout(), x_expand: true});
        this.wave = new St.DrawingArea({style_class: 'melody-wave', x_expand: true, y_expand: true, reactive: false});
        this.wave.connect('repaint', actor => drawWave(actor, settings.get_boolean('panel-show-wave')));
        this.layer.add_child(this.wave);
        this.content = new St.BoxLayout({style_class: 'melody-content', x_expand: true});
        this.layer.add_child(this.content); item.add_child(this.layer); menu.addMenuItem(item);
        this.cover = new St.Bin({style_class: 'melody-cover', y_align: Clutter.ActorAlign.CENTER});
        this.coverIcon = new St.Icon({icon_name: 'audio-x-generic-symbolic', style_class: 'melody-cover-icon', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        this.cover.set_child(this.coverIcon); this.content.add_child(this.cover);
        const right = new St.BoxLayout({vertical: true, style_class: 'melody-details', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this.content.add_child(right);
        const top = new St.BoxLayout({style_class: 'melody-top', x_expand: true});
        const labels = new St.BoxLayout({vertical: true, style_class: 'melody-labels', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this.track = new St.Label({style_class: 'melody-track', text: 'Нет музыки'});
        this.artist = new St.Label({style_class: 'melody-artist', text: ''});
        labels.add_child(this.track); labels.add_child(this.artist); top.add_child(labels);
        const controls = new St.BoxLayout({style_class: 'melody-controls', y_align: Clutter.ActorAlign.CENTER});
        const button = (icon, method) => {
            const b = new St.Button({style_class: 'melody-control', can_focus: true, child: new St.Icon({icon_name: icon, icon_size: 20})});
            b.connect('clicked', () => this.getMpris()?.action(method)); controls.add_child(b); return b;
        };
        this.prev = button('media-skip-backward-symbolic', 'Previous');
        this.play = button('media-playback-start-symbolic', 'PlayPause'); this.play.add_style_class_name('melody-play');
        this.next = button('media-skip-forward-symbolic', 'Next');
        top.add_child(controls); right.add_child(top);
        this.progress = new Slider.Slider(0); right.add_child(this.progress);
        this.progress.connect('drag-begin', () => { this.dragging = true; });
        this.progress.connect('drag-end', () => { this.dragging = false; this.getMpris()?.seek(this.progress.value); });
        this.progress.connect('scroll-event', () => Clutter.EVENT_STOP);
        const times = new St.BoxLayout({style_class: 'melody-times'});
        this.elapsed = new St.Label({text: '0:00', style_class: 'melody-time'});
        this.duration = new St.Label({text: '—', style_class: 'melody-time'});
        times.add_child(this.elapsed); times.add_child(new St.Widget({x_expand: true})); times.add_child(this.duration); right.add_child(times);
        this.message = new St.Label({style_class: 'melody-message', text: ''}); right.add_child(this.message);
        this.playerButton = new St.Button({style_class: 'melody-player-choice', can_focus: true, x_align: Clutter.ActorAlign.START});
        this.playerLabel = new St.Label({style_class: 'melody-player-choice-label'}); this.playerButton.child = this.playerLabel;
        this.playerButton.connect('clicked', () => { const m = this.getMpris(), all = [...m.players.values()]; if (all.length > 1) m.select(all[(all.indexOf(m.active) + 1) % all.length].name); });
        right.add_child(this.playerButton);
        this.resize();
    }
    resize() {
        const width = this.settings.get_int('panel-player-width'), size = this.settings.get_int('panel-cover-size');
        this.layer.set_size(width + 32, Math.max(size + 32, 128)); this.content.style = `width: ${width}px;`;
        this.cover.style = `width:${size}px;height:${size}px;`;
    }
    setArtwork(uri) { this.resize(); updateCoverIcon(this.coverIcon, uri, this.settings.get_int('panel-cover-size')); }
    setColor(hex) { this.progress.style = hex ? `-barlevel-active-background-color: ${hex};` : ''; this.wave.queue_repaint(); }
    update(player, title, artist, playerCount, error) {
        this.resize();
        if (this.lastTitle !== title || this.lastArtist !== artist) {
            this.lastTitle = title; this.lastArtist = artist; this.track.text = title; this.artist.text = artist;
            if (this.settings.get_boolean('animations')) for (const actor of [this.track, this.artist, this.cover]) {
                actor.remove_all_transitions(); actor.opacity = 0; actor.translation_y = 5;
                actor.ease({opacity: 255, translation_y: 0, duration: 220, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            }
        }
        this.play.child.icon_name = player?.status === 'Playing' ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        this.play.reactive = !!player && (player.status === 'Playing' ? player.canPause : player.canPlay);
        this.prev.reactive = !!player?.canPrevious; this.next.reactive = !!player?.canNext;
        this.progress.reactive = !!player?.canSeek && Number(player?.metadata?.['mpris:length'] || 0) > 0;
        this.playerButton.visible = playerCount > 1; this.playerLabel.text = player ? `${player.identity}  ▾` : '';
        this.message.text = error; this.message.visible = !!error;
    }
    updateProgress(elapsed, duration, fraction) {
        this.elapsed.text = elapsed; this.duration.text = duration;
        if (!this.dragging) this.progress.value = fraction;
    }
}
