'use strict'
const fs = require('fs')
const path = require('path')
const { createHash } = require('crypto')

const HOUR = 3600000
const MAX_PROGRAMMES = 20000
const METADATA_TTL = 6 * HOUR
const safeText = value => value == null ? '' : String(value)
const xmlEscape = value => safeText(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
const tag = (name, value, attr = '') => value == null || value === '' ? '' : `<${name}${attr}>${xmlEscape(value)}</${name}>`
const uid = (server, key) => createHash('sha256').update(`${server && (server._id || `${server.host}:${server.port}`)}|${key}`).digest('hex').slice(0, 32)
function detectLanguage(program) {
    const explicit = safeText(program.language || program.metadataLanguage || program.summaryLanguage || program.lang).toLowerCase()
    if (/^(el|ell|gre)(-|$)/.test(explicit)) return 'el'
    if (/^(en|eng)(-|$)/.test(explicit)) return 'en'
    // Do not falsely mark original Plex metadata as English when unknown.
    return /[\u0370-\u03ff\u1f00-\u1fff]/.test(`${program.title || ''} ${program.summary || ''}`) ? 'el' : 'und'
}
function legacyThumb(program) {
    try { const u = new URL(program.icon); return /^\/(?:library\/|photo\/)/.test(u.pathname) ? u.pathname : null } catch {return null}
}
function imageId(program) { return uid(program.server, program.thumbPath || program.iconPath || legacyThumb(program) || program.key || program.title) }
function sanitize(raw) {
    const p = { ...raw }
    delete p.file; delete p.server; delete p.streams; delete p.opts; delete p.commercials
    delete p.key; delete p.thumbPath; delete p.iconPath; delete p._cachedAt
    // Older channel entries contain token-bearing artwork URLs.
    for (const key of Object.keys(p)) if (/token|password|auth|^icon$|.*Icon$|^url$/i.test(key)) delete p[key]
    return p
}
function generateSchedule(channels, now = Date.now(), hours = 336, historyHours = 2) {
    const span = Math.min(24 * 31, Math.max(1, Number(hours) || 336)) * HOUR
    const low = now - historyHours * HOUR, high = now + span
    const result = []
    for (const channel of channels) {
        const programs = Array.isArray(channel.programs) ? channel.programs : []
        const durations = programs.map(p => Number(p.duration))
        const cycle = durations.reduce((a,b) => a+b, 0)
        const anchor = new Date(channel.startTime).getTime()
        if (!programs.length || !Number.isFinite(anchor) || !durations.every(d => Number.isFinite(d) && d > 0) || cycle <= 0) continue
        // Compute current cycle without iterating years of old broadcasts.
        if (anchor >= high) continue
        let cycleStart = anchor + Math.max(0, Math.floor((low - anchor) / cycle)) * cycle
        let counter = 0
        while (cycleStart < high && counter < MAX_PROGRAMMES) {
            let t = cycleStart
            for (let i = 0; i < programs.length && counter < MAX_PROGRAMMES; i++) {
                const end = t + durations[i]
                if (end > low && t < high) {
                    const p = programs[i]
                    result.push({channel: Number(channel.number), start: t, stop: end,
                        ...sanitize(p), language: detectLanguage(p), artworkId: (p.thumbPath || p.iconPath || legacyThumb(p)) ? imageId(p) : null,
                        contentId: uid(p.server, p.key || p.title)})
                    counter++
                }
                t = end
            }
            cycleStart += cycle
        }
    }
    return result.sort((a,b) => a.start-b.start || a.channel-b.channel)
}
function formatDate(millis) {
    const d = new Date(millis)
    // UTC XMLTV timestamps are unambiguous and TVHeadend converts them to local time.
    return `${d.toISOString().replace(/[-:T]/g, '').replace(/\.\d{3}Z$/, '')} +0000`
}
function xmltv(channels, schedule, baseUrl = '') {
    const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<tv generator-info-name="PseudoTV Next EPG 2.0">']
    for (const ch of channels) {
        const id = xmlEscape(ch.number)
        out.push(`<channel id="${id}">`, tag('display-name', ch.name, ' lang="und"'))
        // Never expose a Plex X-Plex-Token in channel or programme images.
        if (ch.icon && !/X-Plex-Token/i.test(ch.icon) && /^(https?:\/\/|\/images\/)/.test(ch.icon)) {
            let src = ch.icon.startsWith('/') ? baseUrl + ch.icon : ch.icon
            out.push(`<icon src="${xmlEscape(src)}"/>`)
        }
        out.push('</channel>')
    }
    for (const p of schedule) {
        const lang = ['el','en'].includes(p.language) ? p.language : 'und'
        out.push(`<programme start="${formatDate(p.start)}" stop="${formatDate(p.stop)}" channel="${xmlEscape(p.channel)}">`)
        const episode = p.type === 'episode'
        out.push(tag('title', episode ? (p.showTitle || p.title) : p.title, ` lang="${lang}"`))
        if (episode) {
            out.push(tag('sub-title', p.title, ` lang="${lang}"`))
        } else out.push(tag('sub-title', p.subtitle, ` lang="${lang}"`))
        out.push(tag('desc', p.summary, ` lang="${lang}"`))
        // XMLTV DTD requires credits before date/category, and icon before episode-num/rating.
        const directors = p.directors || [], actors = p.actors || [], writers = p.writers || []
        if (directors.length || actors.length || writers.length) {
            out.push('<credits>')
            for (const v of directors) out.push(tag('director', v))
            for (const v of actors) out.push(tag('actor', v))
            for (const v of writers) out.push(tag('writer', v))
            out.push('</credits>')
        }
        if (p.originallyAvailableAt || p.year) out.push(tag('date', p.originallyAvailableAt || p.year))
        for (const g of p.genres || []) out.push(tag('category', g, ` lang="${lang}"`))
        if (p.actualDuration > 0) out.push(tag('length', Math.round(p.actualDuration / 60000), ' units="minutes"'))
        if (p.artworkId && baseUrl) out.push(`<icon src="${xmlEscape(`${baseUrl}/api/epg-image/${p.artworkId}`)}"/>`)
        if (episode) {
            const season = Number(p.season), ep = Number(p.episode)
            if (season > 0 && ep > 0) out.push(tag('episode-num', `${season-1}.${ep-1}.`, ' system="xmltv_ns"'))
        }
        if (p.rating) out.push(`<rating system="content">${tag('value', p.rating)}</rating>`)
        if (p.starRating != null && Number.isFinite(Number(p.starRating))) out.push(`<star-rating system="0-10">${tag('value', `${Math.max(0,Math.min(10,Number(p.starRating)))}/10`)}</star-rating>`)
        out.push('</programme>')
    }
    out.push('</tv>')
    return out.join('\n') + '\n'
}
function plexFields(item) {
    const names = (key) => Array.isArray(item[key]) ? item[key].map(x => x.tag || x.name).filter(Boolean) : []
    return { genres:names('Genre'), actors:names('Role'), directors:names('Director'), writers:names('Writer'),
        year:item.year, starRating:item.rating, rating:item.contentRating, summary:item.summary,
        originallyAvailableAt:item.originallyAvailableAt, studio:item.studio,
        thumbPath:item.thumb || item.grandparentThumb, language:item.language || item.summaryLanguage }
}
function createService(db, dataDir) {
    const cacheFile = path.join(dataDir, 'epg-metadata.json')
    let cache = {}
    try { cache = JSON.parse(fs.readFileSync(cacheFile,'utf8')) } catch {}
    let inflight = null
    const save = () => {
        const tmp = `${cacheFile}.${process.pid}.tmp`
        fs.writeFileSync(tmp, JSON.stringify(cache))
        fs.renameSync(tmp, cacheFile)
    }
    function enrich(channel) {
        return {...channel, programs: (channel.programs || []).map(program => {
            const k = uid(program.server, program.key)
            return { ...program, ...(cache[k] || {}) }
        })}
    }
    async function refresh(force = false) {
        if (inflight) return inflight
        inflight = (async () => {
            const channels = db.channels.find()
            let queried = 0, updated = 0, failed = 0
            const seen = new Set()
            for (const channel of channels) for (const program of channel.programs || []) {
                if (!program.server || !program.key || !program.server.token) continue
                const k = uid(program.server, program.key)
                if (seen.has(k)) continue
                seen.add(k)
                if (!force && cache[k] && Date.now() - cache[k]._cachedAt < METADATA_TTL) continue
                try {
                    const server = program.server
                    if (!/^\/library\/metadata\/\d+/.test(program.key)) throw new Error('Invalid metadata key')
                    const proto = server.protocol === 'https' ? 'https' : 'http'
                    const requestUrl = new URL(`${proto}://${server.host}:${server.port}${program.key}`)
                    const response = await fetch(requestUrl, {headers:{Accept:'application/json','X-Plex-Token':server.token},signal:AbortSignal.timeout(9000)})
                    if (!response.ok) throw new Error(`Plex HTTP ${response.status}`)
                    const res = (await response.json()).MediaContainer
                    const item = res && res.Metadata && res.Metadata[0]
                    if (!item) throw new Error('Missing Plex metadata')
                    cache[k] = {...plexFields(item), _cachedAt: Date.now()}
                    updated++
                } catch { failed++ }
                queried++
                // Yield periodically to avoid blocking streaming request handlers.
                if (queried % 5 === 0) await new Promise(resolve => setImmediate(resolve))
            }
            if (updated) save()
            return {updated, failed, cached:Object.keys(cache).length}
        })().finally(() => { inflight = null })
        return inflight
    }
    const channels = () => db.channels.find().map(enrich)
    const listing = (now, hours) => generateSchedule(channels(), now, hours)
    const artwork = id => {
        for (const channel of channels()) for (const program of channel.programs || []) {
            if (imageId(program) !== id) continue
            const thumb = program.thumbPath || program.iconPath || legacyThumb(program)
            if (!thumb || !program.server || !program.server.token) return null
            return {server:program.server, thumb}
        }
        return null
    }
    return {refresh, channels, listing, artwork, get cachedCount() {return Object.keys(cache).length}}
}
module.exports = {generateSchedule, xmltv, plexFields, createService, detectLanguage, imageId, uid, xmlEscape, formatDate}
