import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {Artwork} from './services/artwork.js';
import {Lyrics, lyricsQuery} from './services/lyrics.js';
import {Mpris} from './services/mpris.js';
import {Visualizer} from './services/visualizer.js';
import {PlayerCard} from './ui/playerCard.js';

function formatTime(position) {
    const seconds = Math.floor(Math.max(0, position) / GLib.USEC_PER_SEC);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export default class MelodyIsland extends Extension {
    enable() {
        this.shuttingDown = false;
        this.settings = this.getSettings();
        this.lyrics = new Lyrics(this.metadata.version);
        this.viz = new Visualizer(this.settings, () => this.refresh());
        this.buildIndicator();
        this.buildMenus();

        this.artwork = new Artwork((icon, color) => {
            if (this.shuttingDown)
                return;
            this.coverArt = icon;
            this.coverColor = color;
            this.updateArtwork();
            const hex = color && '#' + color.map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('');
            for (const card of this.cards)
                card.setColor(hex);
        });
        this.mpris = new Mpris(() => this.refresh());

        this.settingsId = this.settings.connect('changed', (_settings, key) => {
            if (['position', 'panel-order', 'panel-offset'].includes(key))
                this.moveIndicator();
            if (key === 'bars') {
                this.viz.stop();
                this.viz.rebuild();
            }
            if (key === 'quick-position')
                this.moveQuickCard();
            if (key.startsWith('lyrics-'))
                this.configureLyricsViews();
            this.refresh();
        });
        this.moveIndicator();
        this.timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this.updateProgress();
            return GLib.SOURCE_CONTINUE;
        });
        this.refresh();
    }

    buildIndicator() {
        this.indicator = new PanelMenu.Button(0.5, 'Melody Island', false);
        this.indicator.connect('destroy', () => { this.shuttingDown = true; });
        this.indicator.add_style_class_name('melody-panel');
        const row = new St.BoxLayout({style_class: 'melody-panel-row'});
        this.titleViewport = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            clip_to_allocation: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.title = new St.Label({
            text: 'Melody Island',
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.titleViewport.add_child(this.title);
        row.add_child(this.titleViewport);
        this.panelSpectrum = this.viz.create(15);
        row.add_child(this.panelSpectrum);
        this.indicator.add_child(row);

        this.indicator._clickGesture.set_enabled(false);
        const gesture = new Clutter.ClickGesture({recognize_on_press: true});
        gesture.connect('recognize', () => this.togglePlayer());
        this.indicator.add_action(gesture);
        this.indicator.connect('key-press-event', (_actor, event) => {
            const key = event.get_key_symbol();
            if (![Clutter.KEY_Return, Clutter.KEY_space, Clutter.KEY_KP_Enter].includes(key))
                return Clutter.EVENT_PROPAGATE;
            this.togglePlayer();
            return Clutter.EVENT_STOP;
        });
    }

    buildMenus() {
        this.panelMenu = this.indicator.menu;
        this.panelMenu.box.add_style_class_name('melody-popup');
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'melody-menu-item',
        });
        this.panelPlayer = new PlayerCard(this.settings, {
            widthKey: 'panel-player-width',
            coverSizeKey: 'panel-cover-size',
        }, area => this.drawWave(area, 'panel-show-wave'), () => this.mpris);
        item.add_child(this.panelPlayer.actor);
        this.panelMenu.addMenuItem(item);

        this.quickSettings = Main.panel.statusArea.quickSettings;
        this.quickMenu = this.quickSettings.menu;
        this.quickIndicator = new QuickSettings.SystemIndicator();
        this.quickPlayer = new PlayerCard(this.settings, {
            widthKey: 'quick-width',
            coverSizeKey: 'quick-cover-size',
            styleClass: 'melody-quick-card',
        }, area => this.drawWave(area, 'show-wave'), () => this.mpris);
        this.quickIndicator.quickSettingsItems.push(this.quickPlayer.actor);
        this.quickSettings.addExternalIndicator(this.quickIndicator, 2);
        this.moveQuickCard();

        this.cards = [this.panelPlayer, this.quickPlayer];
        this.configureLyricsViews();
        this.panelMenuId = this.panelMenu.connect('open-state-changed', () => this.refresh());
        this.quickMenuId = this.quickMenu.connect('open-state-changed', () => this.refresh());
        this.viz.onFrame = () => this.repaintCards();
    }

    togglePlayer() {
        if (this.settings.get_boolean('show-panel-player'))
            this.panelMenu.toggle();
        else if (this.settings.get_boolean('show-quick'))
            this.quickMenu.toggle();
    }

    moveIndicator() {
        const requestedPosition = this.settings.get_string('position');
        const position = ['left', 'center', 'right'].includes(requestedPosition) ? requestedPosition : 'center';
        const order = this.settings.get_int('panel-order');
        if (!this.placed) {
            Main.panel.addToStatusArea('melodybar', this.indicator, order, position);
            this.placed = true;
        } else {
            const parent = this.indicator.get_parent();
            const box = position === 'left' ? Main.panel._leftBox :
                position === 'right' ? Main.panel._rightBox : Main.panel._centerBox;
            const target = Math.min(order, box.get_n_children() - (parent === box ? 1 : 0));
            if (parent !== box || box.get_children().indexOf(this.indicator) !== target) {
                parent?.remove_child(this.indicator);
                box.insert_child_at_index(this.indicator, Math.min(order, box.get_n_children()));
            }
        }
        this.indicator.translation_x = this.settings.get_int('panel-offset');
    }

    moveQuickCard() {
        const grid = this.quickMenu._grid;
        const card = this.quickPlayer.actor;
        if (!grid || card.get_parent() !== grid)
            return;

        const position = this.settings.get_string('quick-position');
        if (position === 'top') {
            const first = grid.get_first_child();
            if (first && first !== card)
                grid.set_child_above_sibling(card, first);
        } else if (position === 'before-apps') {
            const background = this.quickSettings._backgroundApps?.quickSettingsItems?.at(-1);
            if (background?.get_parent() === grid)
                grid.set_child_below_sibling(card, background);
            else
                grid.set_child_above_sibling(card, null);
        } else {
            grid.set_child_above_sibling(card, null);
        }
    }

    repaintCards() {
        if (this.shuttingDown)
            return;
        if (this.quickMenu.isOpen && this.quickPlayer.actor.visible)
            this.quickPlayer.wave.queue_repaint();
        if (this.panelMenu.isOpen)
            this.panelPlayer.wave.queue_repaint();
    }

    drawWave(area, setting) {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();
        const values = this.settings.get_boolean(setting) ? this.viz.values : [];
        if (width > 0 && height > 0 && values.length > 1) {
            const color = this.settings.get_boolean('custom-color') ? this.settings.get_string('color') : '';
            const rgb = /^#[0-9a-fA-F]{6}$/.test(color)
                ? [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16) / 255)
                : this.coverColor ?? [0.60, 0.56, 0.94];
            const step = width / values.length;
            const radius = Math.min(20, width / 2, height / 2);
            cr.newPath();
            cr.moveTo(0, 0);
            cr.lineTo(width, 0);
            cr.lineTo(width, height - radius);
            cr.arc(width - radius, height - radius, radius, 0, Math.PI / 2);
            cr.lineTo(radius, height);
            cr.arc(radius, height - radius, radius, Math.PI / 2, Math.PI);
            cr.closePath();
            cr.clip();
            cr.setLineWidth(Math.max(1.5, Math.min(4.5, step * 0.55)));
            cr.setLineCap(Cairo.LineCap.BUTT);

            const gradient = new Cairo.LinearGradient(0, height * 0.28, 0, height);
            gradient.addColorStopRGBA(0, ...rgb, 0.80);
            gradient.addColorStopRGBA(1, ...rgb, 0.32);
            cr.setSource(gradient);
            for (let i = 0; i < values.length; i++) {
                const value = Math.max(0, Math.min(1, values[i]));
                const barHeight = Math.sqrt(value) * height * 0.55;
                if (barHeight < 1)
                    continue;
                const x = (i + 0.5) * step;
                cr.moveTo(x, height);
                cr.lineTo(x, height - barHeight);
            }
            cr.stroke();
        }
        cr.$dispose();
    }

    refresh() {
        if (!this.mpris || this.shuttingDown)
            return;

        const player = this.mpris.active;
        const metadata = player?.metadata ?? {};
        const title = String(metadata['xesam:title'] || 'Нет музыки');
        const artists = metadata['xesam:artist'];
        const artist = Array.isArray(artists) ? artists.join(', ') : '';
        const settings = this.settings;
        this.indicator.visible = settings.get_boolean('show-panel') &&
            (!!player || !settings.get_boolean('hide-inactive'));
        this.quickPlayer.actor.visible = settings.get_boolean('show-quick') &&
            (!!player || !settings.get_boolean('quick-hide-inactive'));
        if ((!this.indicator.visible || !settings.get_boolean('show-panel-player')) && this.panelMenu.isOpen)
            this.panelMenu.close();
        this.titleViewport.visible = settings.get_boolean('show-title');
        this.panelSpectrum.visible = settings.get_boolean('show-spectrum');
        this.title.text = artist && settings.get_boolean('show-artist') ? `${artist} — ${title}` : title;
        this.updateTitleLayout();

        this.updatePlaybackTrack(player);
        const playing = player?.status === 'Playing';
        const needsSpectrum = (settings.get_boolean('show-panel') && settings.get_boolean('show-spectrum')) ||
            (this.quickPlayer.actor.visible && this.quickMenu.isOpen && settings.get_boolean('show-wave')) ||
            (this.panelMenu.isOpen && settings.get_boolean('panel-show-wave'));
        if (playing && needsSpectrum && !this.viz.proc && !this.viz.error)
            this.viz.start();
        else if ((!playing || !needsSpectrum) && this.viz.proc)
            this.viz.stop();

        for (const card of this.cards)
            card.update(player, title, artist, this.mpris.players.size, this.viz.error);
        this.artwork.setSources(metadata['mpris:artUrl'], metadata['xesam:url']);
        this.updateArtwork();
        this.refreshLyrics(metadata);
        this.updateProgress();
        this.repaintCards();
    }

    updatePlaybackTrack(player) {
        if (this.playbackPlayer === player && this.playbackTrackRevision === player?.trackRevision)
            return;

        this.playbackPlayer = player;
        this.playbackTrackRevision = player?.trackRevision;
        this.clearLyrics();
    }

    configureLyricsViews() {
        const options = {
            showIntro: this.settings.get_boolean('lyrics-show-intro'),
            scroll: this.settings.get_boolean('lyrics-scroll'),
            opacity: this.settings.get_int('lyrics-background-opacity'),
        };
        this.panelPlayer.lyricsView.configure(options);
        this.quickPlayer.lyricsView.configure(options);
    }

    refreshLyrics(metadata) {
        const enabled = this.settings.get_boolean('lyrics-enabled');
        const panelEnabled = enabled && this.settings.get_boolean('panel-show-lyrics');
        const quickEnabled = enabled && this.settings.get_boolean('quick-show-lyrics');
        this.showPanelLyrics = panelEnabled && this.indicator.menu.isOpen;
        this.showQuickLyrics = quickEnabled && this.quickPlayer.actor.visible && this.quickMenu.isOpen;
        if (!this.showPanelLyrics && !this.showQuickLyrics) {
            if ((!panelEnabled && !quickEnabled) || this.lyricsRequest?.done)
                this.clearLyrics();
            else
                this.renderLyrics();
            return;
        }

        const query = lyricsQuery(metadata);
        if (!query) {
            this.clearLyrics();
            return;
        }

        const key = JSON.stringify(query);
        if (this.lyricsRequest?.key === key) {
            this.renderLyrics();
            return;
        }

        this.clearLyrics();
        const request = {key, cancellable: new Gio.Cancellable(), done: false, result: null};
        this.lyricsRequest = request;
        this.lyrics.lookup(query, key, request.cancellable).then(
            result => this.finishLyrics(request, result),
            () => this.finishLyrics(request, null)
        ).catch(logError);
    }

    finishLyrics(request, result) {
        if (this.lyricsRequest !== request)
            return;

        request.done = true;
        request.result = result?.lines ? result : null;
        if (!this.showPanelLyrics && !this.showQuickLyrics)
            this.clearLyrics();
        else
            this.renderLyrics();
    }

    renderLyrics() {
        const result = this.lyricsRequest?.result ?? null;
        this.panelPlayer.lyricsView.setLyrics(this.showPanelLyrics ? result : null);
        this.quickPlayer.lyricsView.setLyrics(this.showQuickLyrics ? result : null);
        if (!result || (!this.showPanelLyrics && !this.showQuickLyrics)) {
            if (this.lyricsTimer)
                GLib.source_remove(this.lyricsTimer);
            this.lyricsTimer = 0;
            return;
        }

        this.updateLyricsPosition();
        this.lyricsTimer ||= GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
            this.updateLyricsPosition();
            return GLib.SOURCE_CONTINUE;
        });
    }

    updateLyricsPosition() {
        const position = this.mpris.position(this.mpris.active);
        this.panelPlayer.lyricsView.updatePosition(position);
        this.quickPlayer.lyricsView.updatePosition(position);
    }

    clearLyrics() {
        this.lyricsRequest?.cancellable.cancel();
        this.lyricsRequest = null;
        this.renderLyrics();
    }

    stopTitleScroll() {
        if (this.titleScrollId)
            GLib.source_remove(this.titleScrollId);
        this.titleScrollId = 0;
        this.title.translation_x = 0;
    }

    updateTitleLayout() {
        const mode = this.settings.get_string('width-mode');
        const limit = this.settings.get_int('max-width');
        const animate = this.settings.get_boolean('animations');
        const signature = JSON.stringify([this.title.text, mode, limit, animate]);
        if (signature === this.titleLayoutSignature)
            return;
        this.titleLayoutSignature = signature;
        this.stopTitleScroll();

        this.title.set_width(-1);
        this.title.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        const [, preferred] = this.title.get_preferred_width(-1);
        const natural = Math.max(1, Math.ceil(preferred));
        const width = mode === 'fixed' ? limit : Math.min(limit, natural);
        const scrolling = mode === 'scroll' && animate && natural > width;
        this.titleViewport.set_width(width);
        this.title.set_width(scrolling ? natural : width);
        this.title.clutter_text.ellipsize = scrolling ? Pango.EllipsizeMode.NONE : Pango.EllipsizeMode.END;
        if (!scrolling)
            return;

        const distance = natural - width;
        const start = GLib.get_monotonic_time();
        const delay = 1_200_000;
        const travel = Math.max(900_000, distance / 32 * GLib.USEC_PER_SEC);
        const cycle = 2 * (delay + travel);
        this.titleScrollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 33, () => {
            const phase = (GLib.get_monotonic_time() - start) % cycle;
            const forward = Math.max(0, Math.min(1, (phase - delay) / travel));
            const backward = Math.max(0, Math.min(1, (phase - 2 * delay - travel) / travel));
            this.title.translation_x = -distance * (forward - backward);
            return GLib.SOURCE_CONTINUE;
        });
    }

    updateArtwork() {
        for (const card of this.cards)
            card.setArtwork(this.coverArt);
    }

    updateProgress() {
        const player = this.mpris.active;
        const length = Number(player?.metadata?.['mpris:length'] || 0);
        const position = this.mpris.position(player);
        const elapsed = formatTime(length ? Math.min(position, length) : position);
        const duration = length ? formatTime(length) : '—';
        const fraction = length ? Math.min(1, position / length) : 0;
        for (const card of this.cards)
            card.updateProgress(elapsed, duration, fraction);
    }

    disable() {
        this.shuttingDown = true;
        if (this.timer)
            GLib.source_remove(this.timer);
        this.timer = 0;
        this.settings.disconnect(this.settingsId);
        this.stopTitleScroll();
        this.titleLayoutSignature = null;
        this.clearLyrics();
        this.lyrics.destroy();
        this.mpris.destroy();
        this.artwork.destroy();
        this.quickMenu.disconnect(this.quickMenuId);
        this.panelMenu.disconnect(this.panelMenuId);
        this.viz.destroy();
        this.quickPlayer.actor.destroy();
        this.quickIndicator.destroy();
        this.indicator.destroy();

        this.cards = [];
        this.panelPlayer = null;
        this.quickPlayer = null;
        this.indicator = null;
        this.coverArt = null;
        this.playbackPlayer = null;
        this.mpris = null;
        this.settings = null;
        this.placed = false;
    }
}
