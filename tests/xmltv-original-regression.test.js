'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {WriteXMLTV} = require('../src/xmltv')

test('original XMLTV output is refreshed with a newly added channel', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pseudotv-xmltv-original-'))
  try {
    const file = path.join(dir, 'xmltv.xml')
    const startTime = new Date(Date.now() - 86400000).toISOString()
    const p = (title) => ({ type:'movie', title, summary:'Δοκιμή & <ελληνικά>', duration:600000 })
    const channel = (number, title) => ({number, name:title, startTime, duration:600000, programs:[p(title)]})
    await WriteXMLTV([channel(500, 'Κανάλι 1')], {file,cache:1})
    let xml = fs.readFileSync(file,'utf8')
    assert.match(xml, /<channel id="500">/)
    assert.doesNotMatch(xml, /<channel id="501">/)
    await WriteXMLTV([channel(500,'Κανάλι 1'), channel(501,'Νέο Κανάλι')], {file,cache:1})
    xml = fs.readFileSync(file,'utf8')
    assert.match(xml, /<channel id="501">/)
    assert.match(xml, /<programme [^>]*channel="501"/)
    assert.match(xml, /Δοκιμή &amp; &lt;ελληνικά&gt;/)
    assert.match(xml, /<\/tv>/)
  } finally { fs.rmSync(dir,{recursive:true,force:true}) }
})
test('empty new channels do not block the whole XMLTV refresh', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pseudotv-xmltv-empty-'))
  try {
    const file = path.join(dir, 'xmltv.xml')
    const startTime = new Date(Date.now() - 86400000).toISOString()
    const channels = [
      {number:500,name:'Empty',startTime,duration:0,programs:[]},
      {number:501,name:'Valid',startTime,duration:600000,programs:[{type:'movie',title:'OK',duration:600000}]}
    ]
    await WriteXMLTV(channels,{file,cache:1})
    const xml = fs.readFileSync(file,'utf8')
    assert.match(xml, /<channel id="500">/)
    assert.match(xml, /<programme [^>]*channel="501"/)
    assert.match(xml, /<\/tv>/)
  } finally { fs.rmSync(dir,{recursive:true,force:true}) }
})
