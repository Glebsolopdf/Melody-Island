import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Cogl from 'gi://Cogl';
import Shell from 'gi://Shell';

const RoundedCoverEffect = GObject.registerClass(
class RoundedCoverEffect extends Shell.GLSLEffect {
    vfunc_build_pipeline() {
        this.add_glsl_snippet(Cogl.SnippetHook.FRAGMENT, '', `
            vec2 corner = max(abs(cogl_tex_coord.st - vec2(0.5)) - vec2(0.35), vec2(0.0));
            float distance = length(corner) - 0.15;
            float alpha = 1.0 - smoothstep(-0.01, 0.0, distance);
            cogl_color_out *= alpha;
        `, false);
    }
});

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
        if (!icon.get_effect('melody-rounded-cover'))
            icon.add_effect_with_name('melody-rounded-cover', new RoundedCoverEffect());
        icon.style_class = 'melody-cover-art-icon';
        icon.icon_size = size;
        icon.gicon = new Gio.FileIcon({file});
    } else {
        const effect = icon.get_effect('melody-rounded-cover');
        if (effect) icon.remove_effect(effect);
        icon.style_class = 'melody-cover-icon';
        icon.gicon = null;
        icon.icon_name = 'audio-x-generic-symbolic';
        icon.icon_size = 30;
    }
    icon.visible = true;
}
