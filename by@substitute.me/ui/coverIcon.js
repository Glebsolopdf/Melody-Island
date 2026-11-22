import GObject from 'gi://GObject';
import Cogl from 'gi://Cogl';
import Shell from 'gi://Shell';

const RoundedCoverEffect = GObject.registerClass(
class RoundedCoverEffect extends Shell.GLSLEffect {
    vfunc_build_pipeline() {
        this.add_glsl_snippet(Cogl.SnippetHook.FRAGMENT, '', `
            vec2 corner = max(abs(cogl_tex_coord0_in.st - vec2(0.5)) - vec2(0.35), vec2(0.0));
            float distance = length(corner) - 0.15;
            float alpha = 1.0 - smoothstep(-0.01, 0.0, distance);
            cogl_color_out *= alpha;
        `, false);
    }
});

export function updateCoverIcon(icon, image, size) {
    if (icon._melodyImage === image && icon._melodySize === size)
        return;
    icon._melodyImage = image;
    icon._melodySize = size;
    if (image) {
        if (!icon.get_effect('melody-rounded-cover'))
            icon.add_effect_with_name('melody-rounded-cover', new RoundedCoverEffect());
        icon.style_class = 'melody-cover-art-icon';
        icon.icon_size = size;
        icon.gicon = image;
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
