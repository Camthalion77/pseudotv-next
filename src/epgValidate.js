'use strict'

// Validate the schedule before atomically replacing the published XMLTV file.
// Parsing XML and XMLTV DTD element-order checks are also exercised in CI.
function validateGuide(channels, entries, content) {
    const known = new Set()
    for (const channel of channels) {
        const id = String(channel.number)
        if (known.has(id)) throw new Error(`Duplicate XMLTV channel ID: ${id}`)
        known.add(id)
    }
    const previous = new Map()
    for (const p of entries) {
        if (!known.has(String(p.channel))) throw new Error('XMLTV programme references an unknown channel')
        if (!Number.isFinite(p.start) || !Number.isFinite(p.stop) || p.stop <= p.start)
            throw new Error('Invalid XMLTV programme timestamps')
        const last = previous.get(String(p.channel))
        if (last !== undefined && p.start < last) throw new Error('Overlapping or out-of-order XMLTV programmes')
        previous.set(String(p.channel), p.stop)
    }
    if (!content.startsWith('<?xml') || !content.includes('<tv ') || !content.includes('</tv>'))
        throw new Error('XMLTV document is missing a root element')
    if (/X-Plex-Token|<script[\s>]/i.test(content))
        throw new Error('XMLTV contains forbidden private Plex URLs or markup')
    return { channels: known.size, programmes: entries.length }
}
module.exports = {validateGuide}
