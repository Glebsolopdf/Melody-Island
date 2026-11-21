import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class MelodyBarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.title = 'Настройки Melody Island';
        window.set_default_size(540, 680);
        window.search_enabled = true;
        const page = new Adw.PreferencesPage({title: 'В баре', icon_name: 'audio-x-generic-symbolic'});
        const quickPage = new Adw.PreferencesPage({title: 'Быстрые настройки', icon_name: 'emblem-system-symbolic'});
        window.add(page); window.add(quickPage);

        const group = (title, description = '', target = page) => {
            const section = new Adw.PreferencesGroup({title, description});
            target.add(section); return section;
        };
        const toggle = (section, key, title, subtitle = '') => {
            const row = new Adw.SwitchRow({title, subtitle});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            section.add(row); return row;
        };
        const spin = (section, key, title, min, max, subtitle = '') => {
            const row = new Adw.SpinRow({title, subtitle, adjustment: new Gtk.Adjustment({lower: min, upper: max, step_increment: 1, page_increment: 10})});
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
            section.add(row); return row;
        };

        const panel = group('Верхняя панель');
        toggle(panel, 'show-panel', 'Показывать в верхней панели');
        const choices = ['left', 'center', 'right'];
        const position = new Adw.ComboRow({title: 'Положение', model: Gtk.StringList.new(['Слева', 'По центру', 'Справа'])});
        const updatePosition = () => { position.selected = Math.max(0, choices.indexOf(settings.get_string('position'))); };
        updatePosition();
        position.connect('notify::selected', () => settings.set_string('position', choices[position.selected]));
        const positionChanged = settings.connect('changed::position', updatePosition);
        panel.add(position);
        spin(panel, 'panel-order', 'Порядок в части панели', 0, 20, '0 — первая позиция среди элементов');
        spin(panel, 'panel-offset', 'Сдвиг по горизонтали', -150, 150, 'В пикселях; большие сдвиги могут перекрывать соседние элементы');
        toggle(panel, 'show-title', 'Показывать название трека');
        toggle(panel, 'show-artist', 'Показывать исполнителя', 'Рядом с названием трека');
        toggle(panel, 'show-spectrum', 'CAVA в верхней панели', 'Выключает столбики рядом с названием; фон плеера настраивается отдельно');
        toggle(panel, 'hide-inactive', 'Скрывать без плеера');
        const widthModes = ['dynamic', 'fixed', 'scroll'];
        const widthMode = new Adw.ComboRow({title: 'Ширина названия', subtitle: 'Компактная, фиксированная или с прокруткой', model: Gtk.StringList.new(['По длине текста', 'Фиксированная', 'Прокручивать длинное'])});
        const syncWidthMode = () => { widthMode.selected = Math.max(0, widthModes.indexOf(settings.get_string('width-mode'))); };
        syncWidthMode();
        widthMode.connect('notify::selected', () => settings.set_string('width-mode', widthModes[widthMode.selected]));
        const widthModeChanged = settings.connect('changed::width-mode', syncWidthMode);
        window.connect('close-request', () => { settings.disconnect(widthModeChanged); return false; });
        panel.add(widthMode);
        spin(panel, 'max-width', 'Доступная ширина текста', 100, 500, 'В пикселях; в компактном режиме — максимум');

        const panelPlayer = group('Карточка плеера', 'Открывается нажатием на виджет в верхней панели.');
        toggle(panelPlayer, 'show-panel-player', 'Показывать плеер под виджетом', 'Когда выключено, нажатие открывает быстрые настройки');
        toggle(panelPlayer, 'panel-show-wave', 'Показывать спектр на фоне');
        spin(panelPlayer, 'panel-cover-size', 'Размер обложки', 48, 160, 'В пикселях');
        spin(panelPlayer, 'panel-player-width', 'Ширина плеера', 280, 480, 'В пикселях');

        const player = group('Плеер', 'Карточка внизу меню быстрых настроек.', quickPage);
        toggle(player, 'show-quick', 'Показывать плеер в быстрых настройках');
        const quickPositions = ['top', 'before-apps', 'bottom'];
        const quickPosition = new Adw.ComboRow({title: 'Положение в меню', model: Gtk.StringList.new(['Вверху', 'Перед фоновыми приложениями', 'Внизу'])});
        const syncQuickPosition = () => { quickPosition.selected = Math.max(0, quickPositions.indexOf(settings.get_string('quick-position'))); };
        syncQuickPosition();
        quickPosition.connect('notify::selected', () => settings.set_string('quick-position', quickPositions[quickPosition.selected]));
        const quickPositionChanged = settings.connect('changed::quick-position', syncQuickPosition);
        window.connect('close-request', () => { settings.disconnect(quickPositionChanged); return false; });
        player.add(quickPosition);
        toggle(player, 'quick-hide-inactive', 'Скрывать без плеера');
        spin(player, 'quick-cover-size', 'Размер обложки', 48, 160, 'В пикселях');
        spin(player, 'quick-width', 'Ширина плеера', 280, 440, 'В пикселях');
        toggle(player, 'show-wave', 'Показывать спектр на фоне плеера', 'Визуализация использует звук системного выхода');
        toggle(player, 'animations', 'Анимация при смене трека', 'Применяется к обеим карточкам');

        const spectrum = group('Визуализатор', 'Для работы необходима CAVA.', quickPage);
        spin(panel, 'bars', 'Количество столбиков в панели', 8, 12);
        spin(spectrum, 'animation-speed', 'Скорость реакции', 1, 10);
        const useColor = toggle(spectrum, 'custom-color', 'Пользовательский цвет', 'Если выключено, фон плеера использует цвет обложки');
        const colorRow = new Adw.ActionRow({title: 'Цвет спектра'});
        const colorButton = new Gtk.ColorDialogButton({dialog: new Gtk.ColorDialog({title: 'Цвет спектра', with_alpha: false}), valign: Gtk.Align.CENTER});
        const updateColor = () => { const rgba = new Gdk.RGBA(); if (rgba.parse(settings.get_string('color'))) colorButton.rgba = rgba; };
        updateColor();
        colorButton.connect('notify::rgba', () => {
            const c = colorButton.rgba;
            const hex = '#' + [c.red, c.green, c.blue].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
            if (hex !== settings.get_string('color')) settings.set_string('color', hex);
        });
        const colorChanged = settings.connect('changed::color', updateColor);
        window.connect('close-request', () => { settings.disconnect(positionChanged); settings.disconnect(colorChanged); return false; });
        settings.bind('custom-color', colorRow, 'sensitive', Gio.SettingsBindFlags.GET);
        colorRow.add_suffix(colorButton); colorRow.activatable_widget = colorButton; spectrum.add(colorRow);

        const other = group('По умолчанию', '', quickPage);
        const reset = new Adw.ActionRow({title: 'Сбросить настройки', subtitle: 'Вернуть стандартный вид и поведение'});
        const resetButton = new Gtk.Button({label: 'Сбросить', valign: Gtk.Align.CENTER});
        resetButton.connect('clicked', () => {
            for (const key of ['quick-position', 'show-panel-player', 'panel-show-wave', 'panel-cover-size', 'panel-player-width', 'show-panel', 'show-quick', 'quick-hide-inactive', 'quick-width', 'quick-cover-size', 'position', 'width-mode', 'panel-order', 'panel-offset', 'show-title', 'show-artist', 'show-spectrum', 'show-wave', 'hide-inactive', 'max-width', 'cover-size', 'player-width', 'animations', 'bars', 'animation-speed', 'custom-color', 'color']) settings.reset(key);
        });
        reset.add_suffix(resetButton); reset.activatable_widget = resetButton; other.add(reset);
    }
}
