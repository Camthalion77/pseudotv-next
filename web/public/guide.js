'use strict'
(() => {
const $ = id => document.getElementById(id)
const HOUR = 3600000, WINDOW = 3*HOUR
let start = Math.floor(Date.now()/HOUR)*HOUR
let data = {channels:[],programmes:[]}
const fmt = t => new Date(t).toLocaleTimeString('el-GR',{hour:'2-digit',minute:'2-digit'})
const dt = t => new Date(t).toLocaleString('el-GR',{dateStyle:'medium',timeStyle:'short'})
const el = (tag, cls, text) => {let x=document.createElement(tag);if(cls)x.className=cls;if(text!=null)x.textContent=String(text);return x}
function open(item) {
  const body = $('detailBody');body.replaceChildren()
  if (item.artworkId) {const img=el('img','poster');img.src='/api/epg-image/'+item.artworkId;img.alt='Αφίσα';body.append(img)}
  body.append(el('h2','',item.type==='episode'?item.showTitle:item.title))
  if(item.type==='episode')body.append(el('h3','',`${item.title} · S${item.season||'?'}E${item.episode||'?'}`))
  body.append(el('p','',item.summary||'Δεν υπάρχει διαθέσιμη περίληψη.'))
  const dl=el('dl'); for (const [k,v] of [['Ώρα',`${dt(item.start)}–${fmt(item.stop)}`],['Έτος',item.year],['Είδος',(item.genres||[]).join(', ')],['Σκηνοθέτες',(item.directors||[]).join(', ')],['Ηθοποιοί',(item.actors||[]).join(', ')],['Καταλληλότητα',item.rating],['Βαθμολογία',item.starRating]]) if(v){dl.append(el('dt','',k),el('dd','',v))}body.append(dl)
  $('details').showModal()
}
function render() {
 const q=$('search').value.trim().toLocaleLowerCase('el')
 $('window').textContent = `${dt(start)} — ${dt(start+WINDOW)} · Κάντε κλικ σε μια εκπομπή για λεπτομέρειες.`
 const timeline=$('timeline');timeline.replaceChildren(el('div','station','Κανάλι'))
 const ticks=el('div','ticks');for(let i=0;i<=3;i++)ticks.append(el('span','',fmt(start+i*HOUR)));timeline.append(ticks)
 const rows=$('rows');rows.replaceChildren()
 for(const channel of data.channels) {
  let shows=data.programmes.filter(x=>x.channel===Number(channel.number) && x.stop>start && x.start<start+WINDOW)
  if(q)shows=shows.filter(x=>[x.title,x.showTitle,x.summary,...(x.genres||[])].join(' ').toLocaleLowerCase('el').includes(q))
  if(q&&!shows.length)continue
  const row=el('div','guide-row'),name=el('div','station');
  if(channel.icon){const img=el('img');img.src=channel.icon;img.alt='';name.append(img)}
  name.append(el('span','',`${channel.number} · ${channel.name}`));row.append(name)
  const programs=el('div','programs')
  if(!shows.length) programs.append(el('div','empty','Χωρίς πρόγραμμα'))
  for (const item of shows) {
    const left=Math.max(start,item.start),right=Math.min(start+WINDOW,item.stop)
    const button=el('button','programme',item.type==='episode'?item.showTitle:item.title)
    button.style.left=`${(left-start)/WINDOW*100}%`;button.style.width=`${(right-left)/WINDOW*100}%`
    button.title=`${item.title} • ${fmt(item.start)}–${fmt(item.stop)}`
    button.append(el('small','',`${fmt(item.start)}–${fmt(item.stop)}`))
    button.onclick=()=>open(item);programs.append(button)
  }
  const now=Date.now();if(now>=start&&now<start+WINDOW){const line=el('div','nowline');line.style.left=`${(now-start)/WINDOW*100}%`;programs.append(line)}
  row.append(programs);rows.append(row)
 }
}
async function load() {
 $('status').textContent='Φόρτωση…'
 try {
  const res=await fetch(`/api/epg?at=${encodeURIComponent(start)}&hours=4`,{cache:'no-store'})
  if(!res.ok)throw Error('HTTP '+res.status)
  data=await res.json();render();$('status').textContent=`${data.channels.length} κανάλια`
 }catch(err){$('status').textContent='Σφάλμα οδηγού: '+err.message}
}
$('prev').onclick=()=>{start-=WINDOW;load()}
$('next').onclick=()=>{start+=WINDOW;load()}
$('now').onclick=()=>{start=Math.floor(Date.now()/HOUR)*HOUR;load()}
$('search').oninput=()=>render()
$('close').onclick=()=>$('details').close()
$('refresh').onclick=async()=>{const r=await fetch('/api/epg/refresh',{method:'POST'});$('status').textContent=r.ok?'Ενημέρωση Plex ξεκίνησε':'Δεν ξεκίνησε η ενημέρωση'}
load()
})()
