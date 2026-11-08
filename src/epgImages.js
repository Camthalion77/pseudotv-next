'use strict'
const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')
const {URL} = require('url')
const MAX_BYTES = 5 * 1024 * 1024
function createImageHandler(epg, dataDir) {
    const dir = path.join(dataDir, 'epg-images')
    fs.mkdirSync(dir, { recursive:true })
    function typeFromBytes(bytes) {
        if (bytes.length > 7 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png'
        if (bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216) return 'image/jpeg'
        if (bytes.length > 12 && bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP') return 'image/webp'
        if (bytes.length > 6 && bytes.toString('ascii',0,3)==='GIF') return 'image/gif'
        return null
    }
    return (req,res) => {
        const id = req.params.id
        if (!/^[0-9a-f]{32}$/.test(id)) return res.status(400).end()
        const file = path.join(dir, id)
        if (fs.existsSync(file)) {
            return fs.readFile(file,(err, body) => {
                if (err) return res.status(404).end()
                const mime = typeFromBytes(body)
                if (!mime) return res.status(415).end()
                res.type(mime).set('Cache-Control','public, max-age=86400').send(body)
            })
        }
        const entry = epg.artwork(id)
        if (!entry) return res.status(404).end()
        const {server, thumb} = entry
        // Never accept arbitrary URLs from the client. Request only an image path
        // provided by a configured Plex server and recorded metadata.
        if (!/^\/(?:library\/|photo\/)/.test(thumb) || thumb.includes('..') || thumb.includes('?')) return res.status(404).end()
        let remote
        try {
            remote = new URL(`${server.protocol}://${server.host}:${server.port}${thumb}`)
            if (!['http:','https:'].includes(remote.protocol) || remote.username || remote.password) throw Error('unsafe')
            remote.searchParams.set('X-Plex-Token',server.token)
        } catch { return res.status(400).end() }
        const client = remote.protocol === 'https:' ? https : http
        const call = client.get(remote, {timeout:8000}, incoming => {
            if (incoming.statusCode !== 200 || !/^image\/(jpeg|png|webp|gif)(?:;|$)/i.test(incoming.headers['content-type'] || '')) {
                incoming.resume(); return res.status(502).end()
            }
            const chunks = []
            let size = 0, stopped = false
            incoming.on('data', chunk => {
                size += chunk.length
                if (size > MAX_BYTES) { stopped = true; incoming.destroy();if (!res.headersSent)res.status(413).end();return }
                chunks.push(chunk)
            })
            incoming.on('end', () => {
                if (stopped) return
                const body = Buffer.concat(chunks)
                const mime = typeFromBytes(body)
                if (!mime) return res.status(415).end()
                fs.writeFile(file,body,{flag:'wx'},()=>{})
                res.type(mime).set('Cache-Control','public, max-age=86400').send(body)
            })
            incoming.on('error', () => {if (!res.headersSent) res.status(502).end()})
        })
        call.on('timeout',()=>call.destroy(new Error('timeout')))
        call.on('error',()=>{ if (!res.headersSent) res.status(502).end() })
    }
}
module.exports = createImageHandler
