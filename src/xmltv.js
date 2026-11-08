'use strict'
const fs = require('fs')
const path = require('path')
const { generateSchedule, xmltv } = require('./epg')
// Atomic XMLTV replacement: consumers never receive a half-written guide.
async function WriteXMLTV(channels, settings, baseUrl) {
    const now = Date.now()
    const hours = Math.min(24*31, Math.max(1, Number(settings.cache) || 336))
    const entries = generateSchedule(channels, now, hours)
    const content = xmltv(channels, entries, baseUrl)
    const file = settings.file
    fs.mkdirSync(path.dirname(file), {recursive:true})
    const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
    try {
        await fs.promises.writeFile(tmp, content, 'utf8')
        await fs.promises.rename(tmp, file)
    } finally { await fs.promises.rm(tmp, {force:true}).catch(()=>{}) }
    return { programmes:entries.length, hours }
}
module.exports = { WriteXMLTV }
