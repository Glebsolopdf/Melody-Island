import Gio from 'gi://Gio';

// Match GNOME Shell's built-in media controls: load the MPRIS URI as a FileIcon.
export function updateCoverIcon(icon, uri, size) {
    let file = null;
    if (typeof uri === 'string' && /^(file|https?):\/\//i.test(uri)) {
        try { file = Gio.File.new_for_uri(uri); } catch (_) {}
    }
    const key = `${file ? uri : ''}|${size}`;
    if (icon._melodyIconKey === key) return;
    icon._melodyIconKey = key;
    if (file) {
        icon.style_class = 'melody-cover-art-icon';
        icon.icon_size = size;
        icon.gicon = new Gio.FileIcon({file});
    } else {
        icon.style_class = 'melody-cover-icon';
        icon.gicon = null;
        icon.icon_name = 'audio-x-generic-symbolic';
        icon.icon_size = 30;
    }
    icon.visible = true;
}
