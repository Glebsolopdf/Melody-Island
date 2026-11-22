import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
const BUS='org.freedesktop.DBus', PATH='/org/mpris/MediaPlayer2', ROOT='org.mpris.MediaPlayer2', PLAYER=ROOT+'.Player', PROP='org.freedesktop.DBus.Properties';
function trackChanged(previous, next) {
    for (const key of ['mpris:trackid', 'xesam:url', 'xesam:title']) {
        if ((previous[key] ?? '') !== (next[key] ?? ''))
            return true;
    }

    const oldArtist = previous['xesam:artist']?.join?.(', ');
    const newArtist = next['xesam:artist']?.join?.(', ');
    const oldAlbum = previous['xesam:album'];
    const newAlbum = next['xesam:album'];
    return !!((oldArtist && newArtist && oldArtist !== newArtist) ||
        (oldAlbum && newAlbum && oldAlbum !== newAlbum));
}

export class Mpris {
 constructor(changed) { this.changed=changed; this.players=new Map(); this.active=null; this.selected=null; this.alive=true; this.bus=Gio.DBus.session; this.sub=this.bus.signal_subscribe(BUS,BUS,'NameOwnerChanged','/org/freedesktop/DBus',null,Gio.DBusSignalFlags.NONE,(_c,_s,_p,_i,_n,args)=>{let [name,old,owner]=args.deepUnpack(); if(!name.startsWith(ROOT+'.'))return; if(old)this.remove(name); if(owner)this.add(name);}); this.bus.call(BUS,'/org/freedesktop/DBus',BUS,'ListNames',null,new GLib.VariantType('(as)'),Gio.DBusCallFlags.NONE,-1,null,(b,r)=>{try{for(const n of b.call_finish(r).deepUnpack()[0]) if(n.startsWith(ROOT+'.'))this.add(n);}catch(e){logError(e);}}); }
 call(name, iface, method, args = null, reply = null, callback = null) {
    this.bus.call(name, PATH, iface, method, args, reply, Gio.DBusCallFlags.NONE, 3000, null, (bus, result) => {
        let value = null;
        try {
            value = bus.call_finish(result);
        } catch (_) {
            // The player may have gone away while the call was in progress.
        }
        if (this.alive)
            callback?.(value);
    });
 }
 add(name) {
    if (!this.alive || this.players.has(name))
        return;

    const player = {
        name,
        identity: name.slice(ROOT.length + 1),
        status: 'Stopped',
        metadata: {},
        trackRevision: 0,
        position: 0,
        stamp: GLib.get_monotonic_time(),
        canSeek: false,
        canPlay: false,
        canPause: false,
        canNext: false,
        canPrevious: false,
    };
    this.players.set(name, player);

    // Signals can arrive before GetAll finishes. Keep those newer values.
    let changes = new Set();
    player.sub = this.bus.signal_subscribe(name, PROP, 'PropertiesChanged', PATH, null,
        Gio.DBusSignalFlags.NONE, (_connection, _sender, _path, _iface, _signal, args) => {
            const [iface, props] = args.deepUnpack();
            if (iface === PLAYER) {
                for (const key of Object.keys(props))
                    changes?.add(key);
                const revision = player.trackRevision;
                this.update(player, props);
                if (player.trackRevision !== revision || props.PlaybackStatus?.deepUnpack() === 'Stopped')
                    changes?.add('Position');
            } else if (iface === ROOT && props.Identity) {
                player.identity = props.Identity.deepUnpack();
                this.choose();
            }
        });
    player.seekSub = this.bus.signal_subscribe(name, PLAYER, 'Seeked', PATH, null,
        Gio.DBusSignalFlags.NONE, (_connection, _sender, _path, _iface, _signal, args) => {
            changes?.add('Position');
            this.setPosition(player, Number(args.deepUnpack()[0]));
            this.choose();
        });

    const reply = new GLib.VariantType('(a{sv})');
    this.call(name, PROP, 'GetAll', new GLib.Variant('(s)', [ROOT]), reply, result => {
        if (result && this.players.get(name) === player) {
            const [props] = result.deepUnpack();
            if (props.Identity)
                player.identity = props.Identity.deepUnpack();
            this.choose();
        }
    });
    this.call(name, PROP, 'GetAll', new GLib.Variant('(s)', [PLAYER]), reply, result => {
        const seen = changes;
        changes = null;
        if (result && this.players.get(name) === player) {
            const [props] = result.deepUnpack();
            for (const key of seen)
                delete props[key];
            this.update(player, props);
        }
    });
    this.choose();
 }

 update(player, props) {
    if (this.players.get(player.name) !== player)
        return;

    const get = key => props[key]?.deepUnpack();
    const status = get('PlaybackStatus');
    if (status !== undefined && status !== player.status) {
        const position = status === 'Stopped' ? 0 : this.position(player);
        this.setPosition(player, position);
        player.status = status;
    }

    const metadata = get('Metadata');
    if (metadata !== undefined) {
        const next = Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, value.deepUnpack()]));
        if (trackChanged(player.metadata, next)) {
            player.trackRevision++;
            // MPRIS reports a nonzero start via Seeked. GetAll can also include Position.
            this.setPosition(player, 0);
        }
        player.metadata = next;
    }

    const position = get('Position');
    if (position !== undefined)
        this.setPosition(player, Number(position));

    for (const [key, field] of [['CanSeek', 'canSeek'], ['CanPlay', 'canPlay'],
        ['CanPause', 'canPause'], ['CanGoNext', 'canNext'], ['CanGoPrevious', 'canPrevious']]) {
        const value = get(key);
        if (value !== undefined)
            player[field] = value;
    }
    this.choose();
 }

 setPosition(player, position) {
    if (Number.isFinite(position)) {
        player.position = Math.max(0, position);
        player.stamp = GLib.get_monotonic_time();
    }
 }

 position(p){if(!p)return 0; return Math.max(0,p.position+(p.status==='Playing'?GLib.get_monotonic_time()-p.stamp:0));}
 choose(){if(!this.alive)return; let all=[...this.players.values()];this.active=this.players.get(this.selected)||all.find(p=>p.status==='Playing')||all.find(p=>p.status==='Paused')||all[0]||null;this.changed();}
 select(name){this.selected=name;this.choose();} remove(name){let p=this.players.get(name);if(!p)return;this.bus.signal_unsubscribe(p.sub);this.bus.signal_unsubscribe(p.seekSub);this.players.delete(name);if(this.selected===name)this.selected=null;this.choose();}
 action(method){if(this.active)this.call(this.active.name,PLAYER,method);}
 seek(fraction){let p=this.active, m=p?.metadata, length=Number(m?.['mpris:length']||0), id=m?.['mpris:trackid'];if(p?.canSeek&&length>0&&id&&id!=='/org/mpris/MediaPlayer2/TrackList/NoTrack')this.call(p.name,PLAYER,'SetPosition',new GLib.Variant('(ox)',[id,Math.round(length*fraction)]));}
 destroy(){this.alive=false;this.bus.signal_unsubscribe(this.sub);for(const p of this.players.values()){this.bus.signal_unsubscribe(p.sub);this.bus.signal_unsubscribe(p.seekSub);}this.players.clear();}
}
