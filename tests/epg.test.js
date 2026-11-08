'use strict'
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), os=require('node:os'), path=require('node:path')
const {generateSchedule,xmltv,formatDate,plexFields,detectLanguage}=require('../src/epg')
const {WriteXMLTV}=require('../src/xmltv')
function sample() {return [{number:101,name:'Κινηματογράφος',startTime:new Date('2026-11-08T00:00:00Z').toISOString(),duration:180000,
  programs:[{title:'Ελληνική ταινία & φίλοι',type:'movie',year:1970,summary:'Περίληψη <δοκιμή>',duration:120000,actualDuration:120000,genres:['Δράμα'],directors:['Director A'],actors:['Actor B'],rating:'PG',starRating:8.5,server:{host:'plex',port:'32400',token:'SECRET'},key:'/library/metadata/1',icon:'http://plex:32400/library/metadata/1/thumb?X-Plex-Token=SECRET'},
  {title:'Επεισόδιο 1',showTitle:'Η σειρά',type:'episode',season:2,episode:5,duration:60000,actualDuration:60000,summary:'Γειά σου',server:{host:'plex',token:'SECRET'},key:'/library/metadata/2'}]}]}
test('EPG start/end times have no gaps in repeated cycle',()=>{const x=sample(), now=Date.parse('2026-11-08T00:01:00Z');const a=generateSchedule(x,now,1,0);assert.ok(a.length>10);for(let i=1;i<a.length;i++)assert.equal(a[i-1].stop,a[i].start)})
test('XMLTV handles Greek, proper escaping, categories, credits and seasons',()=>{const ch=sample(),prog=generateSchedule(ch,Date.parse('2026-11-08T00:00:00Z'),1,0);const s=xmltv(ch,prog,'http://zima.lan:8098');assert.match(s,/lang="el"/);assert.match(s,/&amp;/);assert.match(s,/&lt;δοκιμή&gt;/);assert.match(s,/<category lang="el">Δράμα<\/category>/);assert.match(s,/<director>Director A<\/director>/);assert.match(s,/system="xmltv_ns">1\.4\./);assert.doesNotMatch(s,/SECRET|X-Plex-Token/);assert.match(s,/\/api\/epg-image\/[0-9a-f]{32}/)})
test('No language guessing when metadata is unmarked English',()=>{assert.equal(detectLanguage({title:'A movie',summary:'hello'}),'und')})
test('Plex metadata fields map correctly',()=>{assert.deepEqual(plexFields({Genre:[{tag:'Drama'}],Role:[{tag:'Jane'}],Director:[{tag:'John'}],rating:8}).genres,['Drama'])})
test('UTC XMLTV dates stable',()=>{assert.equal(formatDate(Date.parse('2026-11-08T12:30:00Z')),'20261108123000 +0000')})
test('Atomic XMLTV write emits a readable file',async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'epg-test-'));try{const f=path.join(dir,'guide.xml');await WriteXMLTV(sample(),{file:f,cache:1},'http://localhost:8098');assert.match(fs.readFileSync(f,'utf8'),/<\/tv>/)}finally{fs.rmSync(dir,{recursive:true,force:true})}})

test('EPG API schedule strips credentials and token-bearing artwork URLs',()=>{const json=JSON.stringify(generateSchedule(sample(),Date.parse('2026-11-08T00:00:00Z'),1,0));assert.doesNotMatch(json,/SECRET|X-Plex-Token|32400|\"server\"/);assert.match(json,/artworkId/)})
