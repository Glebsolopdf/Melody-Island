import Clutter from 'gi://Clutter';
import Cairo from 'cairo';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {Mpris} from './services/mpris.js';
import {Visualizer} from './services/visualizer.js';
import {ArtworkColor} from './services/artworkColor.js';
import {PanelPlayer} from './panelPlayer.js';
import {updateCoverIcon} from './coverIcon.js';
const fmt=n=>{let s=Math.floor(Math.max(0,n)/1000000);return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};
export default class MelodyBar extends Extension {
 enable(){this.shuttingDown=false;this.settings=this.getSettings();this.indicator=new PanelMenu.Button(0.5,'Melody Island',false);this.indicator.connect('destroy',()=>{this.shuttingDown=true;});this.indicator.add_style_class_name('melody-panel');this.row=new St.BoxLayout({style_class:'melody-panel-row'});this.titleViewport=new St.Widget({layout_manager:new Clutter.BinLayout(),clip_to_allocation:true,y_align:Clutter.ActorAlign.CENTER});this.title=new St.Label({text:'Melody Island',x_align:Clutter.ActorAlign.START,y_align:Clutter.ActorAlign.CENTER});this.titleViewport.add_child(this.title);this.row.add_child(this.titleViewport);this.viz=new Visualizer(this.settings,()=>this.refresh());this.panelSpectrum=this.viz.create(15);this.row.add_child(this.panelSpectrum);this.indicator.add_child(this.row);this.indicator._clickGesture.set_enabled(false);this.panelGesture=new Clutter.ClickGesture({recognize_on_press:true});this.panelGesture.connect('recognize',()=>this.togglePanelPlayer());this.indicator.add_action(this.panelGesture);this.indicator.connect('key-press-event',(_actor,event)=>{let key=event.get_key_symbol();if(key===Clutter.KEY_Return||key===Clutter.KEY_space||key===Clutter.KEY_KP_Enter){this.togglePanelPlayer();return Clutter.EVENT_STOP;}return Clutter.EVENT_PROPAGATE;});this.buildMenu();this.artworkColor=new ArtworkColor(color=>{if(this.shuttingDown)return;this.coverColor=color;this.updateTimelineColor();this.wave.queue_repaint();});this.mpris=new Mpris(()=>this.refresh());this.settingsId=this.settings.connect('changed',(_s,key)=>{if(key==='position'||key==='panel-order'||key==='panel-offset')this.move();if(key==='bars'){this.viz.stop();this.viz.rebuild();}if(key==='quick-position')this.moveQuickCard();this.refresh();});this.move();this.timer=GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,1,()=>{this.updateProgress();return GLib.SOURCE_CONTINUE;});this.refresh();}
 move(){let where=this.settings.get_string('position');let order=this.settings.get_int('panel-order');if(!this.placed){Main.panel.addToStatusArea('melodybar',this.indicator,order,['left','center','right'].includes(where)?where:'center');this.placed=true;}else{let parent=this.indicator.get_parent();let box=where==='left'?Main.panel._leftBox:where==='right'?Main.panel._rightBox:Main.panel._centerBox;let current=box.get_children().indexOf(this.indicator);let target=Math.min(order,box.get_n_children()-(parent===box?1:0));if(parent!==box||current!==target){if(parent)parent.remove_child(this.indicator);box.insert_child_at_index(this.indicator,Math.min(order,box.get_n_children()));}}this.indicator.translation_x=this.settings.get_int('panel-offset');}
 togglePanelPlayer(){if(this.settings.get_boolean('show-panel-player'))this.indicator.menu.toggle();else if(this.settings.get_boolean('show-quick'))this.quickMenu.toggle();}
 buildMenu(){
 this.panelPlayer=new PanelPlayer(this.indicator.menu,this.settings,(actor,enabled)=>this.drawWave(actor,enabled),()=>this.mpris);
 this.panelMenuId=this.indicator.menu.connect('open-state-changed',(_menu,open)=>{if(open)this.panelPlayer.wave.queue_repaint();this.refresh();});
 this.quickMenu=Main.panel.statusArea.quickSettings.menu;
 this.quickIndicator=new QuickSettings.SystemIndicator();
 this.layer=new St.Widget({layout_manager:new Clutter.BinLayout(),x_expand:true,style_class:'melody-quick-card'});this.layer.set_size(this.settings.get_int('quick-width')+32,Math.max(this.settings.get_int('quick-cover-size')+32,112));
 this.wave=new St.DrawingArea({style_class:'melody-wave',x_expand:true,y_expand:true,reactive:false});
 this.wave.connect('repaint',area=>this.drawWave(area));this.layer.add_child(this.wave);
 this.content=new St.BoxLayout({style_class:'melody-content',x_expand:true});this.layer.add_child(this.content);
 this.quickIndicator.quickSettingsItems.push(this.layer);
 Main.panel.statusArea.quickSettings.addExternalIndicator(this.quickIndicator,2);
 this.moveQuickCard();
 this.cover=new St.Bin({style_class:'melody-cover',y_align:Clutter.ActorAlign.CENTER});
 this.coverIcon=new St.Icon({icon_name:'audio-x-generic-symbolic',style_class:'melody-cover-icon',x_align:Clutter.ActorAlign.CENTER,y_align:Clutter.ActorAlign.CENTER});this.cover.set_child(this.coverIcon);this.content.add_child(this.cover);
 let right=new St.BoxLayout({vertical:true,style_class:'melody-details',x_expand:true,y_align:Clutter.ActorAlign.CENTER});this.content.add_child(right);
 let top=new St.BoxLayout({style_class:'melody-top',x_expand:true});let labels=new St.BoxLayout({vertical:true,style_class:'melody-labels',x_expand:true,y_align:Clutter.ActorAlign.CENTER});
 this.track=new St.Label({style_class:'melody-track',text:'Нет музыки'});this.artist=new St.Label({style_class:'melody-artist',text:''});labels.add_child(this.track);labels.add_child(this.artist);top.add_child(labels);
 let controls=new St.BoxLayout({style_class:'melody-controls',y_align:Clutter.ActorAlign.CENTER});this.prev=this.button('media-skip-backward-symbolic',()=>this.mpris.action('Previous'));this.play=this.button('media-playback-start-symbolic',()=>this.mpris.action('PlayPause'));this.play.add_style_class_name('melody-play');this.next=this.button('media-skip-forward-symbolic',()=>this.mpris.action('Next'));for(let b of [this.prev,this.play,this.next])controls.add_child(b);top.add_child(controls);right.add_child(top);
 this.progress=new Slider.Slider(0);right.add_child(this.progress);this.progress.connect('drag-end',()=>{this.dragging=false;this.mpris.seek(this.progress.value);});this.progress.connect('drag-begin',()=>{this.dragging=true;});this.progress.connect('scroll-event',()=>Clutter.EVENT_STOP);
 let times=new St.BoxLayout({style_class:'melody-times'});this.elapsed=new St.Label({text:'0:00',style_class:'melody-time'});this.duration=new St.Label({text:'—',style_class:'melody-time'});let spacer=new St.Widget({x_expand:true});times.add_child(this.elapsed);times.add_child(spacer);times.add_child(this.duration);right.add_child(times);
 this.message=new St.Label({style_class:'melody-message',text:''});right.add_child(this.message);
 this.playerButton=new St.Button({style_class:'melody-player-choice',can_focus:true,x_align:Clutter.ActorAlign.START});
 this.playerLabel=new St.Label({text:'',style_class:'melody-player-choice-label'});this.playerButton.child=this.playerLabel;
 this.playerButton.connect('clicked',()=>{let all=[...this.mpris.players.values()];if(all.length>1){let index=all.indexOf(this.mpris.active);this.mpris.select(all[(index+1)%all.length].name);}});right.add_child(this.playerButton);
 this.viz.onFrame=()=>{if(this.quickMenu.isOpen&&this.layer.visible)this.wave.queue_repaint();if(this.indicator.menu.isOpen&&this.settings.get_boolean('show-panel-player'))this.panelPlayer.wave.queue_repaint();};
 this.quickMenuId=this.quickMenu.connect('open-state-changed',(_menu,open)=>{if(open)this.wave.queue_repaint();this.refresh();});

 }
 moveQuickCard(){
  const grid=this.quickMenu._grid;if(!grid||this.layer.get_parent()!==grid)return;
  const position=this.settings.get_string('quick-position');
  if(position==='top'){
   const first=grid.get_first_child();if(first&&first!==this.layer)grid.set_child_above_sibling(this.layer,first);
  }else if(position==='before-apps'){
   const background=Main.panel.statusArea.quickSettings._backgroundApps?.quickSettingsItems?.at(-1);
   if(background&&background.get_parent()===grid)grid.set_child_below_sibling(this.layer,background);
   else grid.set_child_above_sibling(this.layer,null);
  }else grid.set_child_above_sibling(this.layer,null);
 }

 drawWave(area,enabled=this.settings.get_boolean('show-wave')){
 let cr=area.get_context();let [width,height]=area.get_surface_size();let values=enabled?this.viz.values:[];
 if(width>0&&height>0&&values.length>1){
  let color=this.settings.get_boolean('custom-color')?this.settings.get_string('color'):'';
  let rgb=/^#[0-9a-fA-F]{6}$/.test(color)?[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255):(this.coverColor||[0.60,0.56,0.94]);
  let step=width/values.length;let bottom=height;let radius=Math.min(20,width/2,height/2);
  cr.newPath();cr.moveTo(0,0);cr.lineTo(width,0);cr.lineTo(width,height-radius);cr.arc(width-radius,height-radius,radius,0,Math.PI/2);cr.lineTo(radius,height);cr.arc(radius,height-radius,radius,Math.PI/2,Math.PI);cr.closePath();cr.clip();
  cr.setLineWidth(Math.max(1.5,Math.min(4.5,step*0.55)));cr.setLineCap(Cairo.LineCap.BUTT);
  let gradient=new Cairo.LinearGradient(0,height*0.28,0,bottom);
  gradient.addColorStopRGBA(0,...rgb,0.80);gradient.addColorStopRGBA(1,...rgb,0.32);cr.setSource(gradient);
  for(let i=0;i<values.length;i++){
   let v=Math.max(0,Math.min(1,values[i]));let barHeight=Math.sqrt(v)*height*0.55;
   if(barHeight<1)continue;
   let x=(i+0.5)*step;cr.moveTo(x,bottom);cr.lineTo(x,bottom-barHeight);
  }
  cr.stroke();
 }
 cr.$dispose();
 }

 button(icon,cb){let b=new St.Button({style_class:'melody-control',can_focus:true,child:new St.Icon({icon_name:icon,icon_size:20})});b.connect('clicked',cb);return b;}
 refresh(){if(!this.mpris||this.shuttingDown)return;let p=this.mpris.active,m=p?.metadata||{},title=String(m['xesam:title']||'Нет музыки'),artist=Array.isArray(m['xesam:artist'])?m['xesam:artist'].join(', '):'';this.indicator.visible=this.settings.get_boolean('show-panel')&&(!!p||!this.settings.get_boolean('hide-inactive'));this.layer.visible=this.settings.get_boolean('show-quick')&&(!!p||!this.settings.get_boolean('quick-hide-inactive'));if((!this.indicator.visible||!this.settings.get_boolean('show-panel-player'))&&this.indicator.menu.isOpen)this.indicator.menu.close();this.titleViewport.visible=this.settings.get_boolean('show-title');this.panelSpectrum.visible=this.settings.get_boolean('show-spectrum');let width=this.settings.get_int('quick-width');let size=this.settings.get_int('quick-cover-size');this.layer.set_size(width+32,Math.max(size+32,128));this.content.style=`width: ${width}px;`;let art=m['mpris:artUrl']||'';this.coverSize=size;this.setArtwork(art);
 if(this.lastTitle!==title||this.lastArtist!==artist){this.lastTitle=title;this.lastArtist=artist;this.track.text=title;this.artist.text=artist;if(this.settings.get_boolean('animations')){for(let a of [this.track,this.artist,this.cover]){a.remove_all_transitions();a.opacity=0;a.translation_y=5;a.ease({opacity:255,translation_y:0,duration:220,mode:Clutter.AnimationMode.EASE_OUT_QUAD});}}}
 this.title.text=artist&&this.settings.get_boolean('show-artist')?`${artist} — ${title}`:title;this.updateTitleLayout();this.wave.queue_repaint();
 this.play.child.icon_name=p?.status==='Playing'?'media-playback-pause-symbolic':'media-playback-start-symbolic';this.play.reactive=!!p&&(p.status==='Playing'?p.canPause:p.canPlay);this.prev.reactive=!!p?.canPrevious;this.next.reactive=!!p?.canNext;this.progress.reactive=!!p?.canSeek&&Number(m['mpris:length']||0)>0;this.playerButton.visible=this.mpris.players.size>1;this.playerLabel.text=p?`${p.identity}  ▾`:'';this.panelPlayer.update(p,title,artist,this.mpris.players.size,this.viz.error);let running=!!p&&p.status==='Playing'&&((this.settings.get_boolean('show-panel')&&this.settings.get_boolean('show-spectrum'))||(this.layer.visible&&this.settings.get_boolean('show-wave')&&this.quickMenu.isOpen)||(this.indicator.visible&&this.settings.get_boolean('show-panel-player')&&this.settings.get_boolean('panel-show-wave')&&this.indicator.menu.isOpen));if(running&&!this.viz.proc&&!this.viz.error)this.viz.start();else if(!running&&this.viz.proc)this.viz.stop();this.message.text=this.viz.error;this.message.visible=!!this.viz.error;this.updateProgress();}
 stopTitleScroll(){if(this.titleScrollId){GLib.source_remove(this.titleScrollId);this.titleScrollId=0;}this.title.translation_x=0;}
 updateTitleLayout(){
  let mode=this.settings.get_string('width-mode'),limit=this.settings.get_int('max-width'),animate=this.settings.get_boolean('animations');
  let signature=JSON.stringify([this.title.text,mode,limit,animate]);if(signature===this.titleLayoutSignature)return;this.titleLayoutSignature=signature;this.stopTitleScroll();
  this.title.set_width(-1);this.title.clutter_text.ellipsize=Pango.EllipsizeMode.NONE;let [,natural]=this.title.get_preferred_width(-1);natural=Math.max(1,Math.ceil(natural));
  let width=mode==='fixed'?limit:Math.min(limit,natural);this.titleViewport.set_width(width);
  let scrolling=mode==='scroll'&&animate&&natural>width;this.title.set_width(scrolling?natural:width);this.title.clutter_text.ellipsize=scrolling?Pango.EllipsizeMode.NONE:Pango.EllipsizeMode.END;
  if(!scrolling)return;
  let distance=natural-width,start=GLib.get_monotonic_time(),delay=1200000,travel=Math.max(900000,distance/32*1000000),cycle=delay+travel+delay+travel;
  this.titleScrollId=GLib.timeout_add(GLib.PRIORITY_DEFAULT,33,()=>{let phase=(GLib.get_monotonic_time()-start)%cycle;let offset=phase<delay?0:phase<delay+travel?(phase-delay)/travel*distance:phase<delay+travel+delay?distance:(1-(phase-delay-travel-delay)/travel)*distance;this.title.translation_x=-offset;return GLib.SOURCE_CONTINUE;});
 }

 setArtwork(uri){
  this.artUri=uri;let size=this.coverSize||this.settings.get_int('quick-cover-size');
  this.cover.style=`width:${size}px;height:${size}px;`;
  updateCoverIcon(this.coverIcon,uri,size);
  this.panelPlayer.setArtwork(uri);
  this.artworkColor.setUri(uri);
 }

 updateTimelineColor(){let color=this.coverColor;if(!color){this.progress.style='';this.panelPlayer.setColor(null);return;}let hex='#'+color.map(c=>Math.round(c*255).toString(16).padStart(2,'0')).join('');this.progress.style=`-barlevel-active-background-color: ${hex};`;this.panelPlayer.setColor(hex);}
 updateProgress(){if(!this.mpris)return;let p=this.mpris.active,length=Number(p?.metadata?.['mpris:length']||0),position=this.mpris.position(p);if(length)position=Math.min(position,length);this.elapsed.text=fmt(position);this.duration.text=length?fmt(length):'—';if(!this.dragging)this.progress.value=length?Math.min(1,position/length):0;this.panelPlayer.updateProgress(fmt(position),length?fmt(length):'—',length?Math.min(1,position/length):0);}
 disable(){this.shuttingDown=true;if(this.timer)GLib.source_remove(this.timer);this.timer=0;this.settings.disconnect(this.settingsId);this.stopTitleScroll();this.mpris.destroy();this.artworkColor.destroy();this.quickMenu.disconnect(this.quickMenuId);this.indicator.menu.disconnect(this.panelMenuId);this.viz.destroy();this.layer.destroy();this.quickIndicator.destroy();this.indicator.destroy();this.mpris=null;this.indicator=null;this.settings=null;this.placed=false;}
}