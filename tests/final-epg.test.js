'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const {generateSchedule, xmltv} = require('../src/epg')
const {validateGuide} = require('../src/epgValidate')
const start = Date.parse('2020-01-01T00:00:00Z')
function channels() {return [{number:101,name:'Δοκιμή',startTime:new Date(start).toISOString(),duration:5400000,
    programs:[{type:'episode',title:'Επεισόδιο',showTitle:'Η σειρά',summary:'Ελληνική περιγραφή & φίλοι',season:2,episode:5,
      year:2024,genres:['Drama'],actors:['Actor A'],directors:['Director B'],duration:5400000,actualDuration:5400000}]}]}
test('XMLTV produces 14 days from a years-old channel start date with valid references',()=>{
    const now=Date.parse('2026-11-08T12:00:00Z'), ch=channels()
    const entries=generateSchedule(ch,now,336)
    assert.ok(entries.length>=220 && entries.length<240)
    const doc=xmltv(ch,entries,'http://example:8098')
    assert.equal(validateGuide(ch,entries,doc).programmes,entries.length)
    assert.match(doc,/lang="el"/)
    assert.doesNotMatch(doc,/X-Plex-Token/)
    const program=doc.slice(doc.indexOf('<programme '),doc.indexOf('</programme>'))
    const ordered=['<title','<sub-title','<desc','<credits','<date','<category','<length','<episode-num']
    const positions=ordered.map(x=>program.indexOf(x))
    assert.ok(positions.every(x=>x>=0))
    assert.deepEqual(positions.slice().sort((a,b)=>a-b),positions)
})
test('XMLTV rejects overlapping programme times',()=>{
    const ch=channels(), now=Date.now()
    const a=[{channel:101,start:now,stop:now+10000},{channel:101,start:now+9000,stop:now+20000}]
    assert.throws(()=>validateGuide(ch,a,'<?xml version="1.0"?><tv generator="x"></tv>'),/Overlapping/)
})
