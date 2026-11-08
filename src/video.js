'use strict'
const express = require('express')
const fs = require('fs')
const helper = require('./helperFuncs')
const FFMPEG = require('./ffmpeg')

module.exports = { router: video }

function video(db) {
    const router = express.Router()

    function serveChannel(req, res, channel) {
        const settings = db['ffmpeg-settings'].find()[0]
        if (!settings || !fs.existsSync(settings.ffmpegPath)) return res.status(500).send('FFmpeg executable unavailable')
        if (!channel.programs || !channel.programs.length) return res.status(422).send('Channel has no programmes')

        let prog, lineup
        try {
            prog = helper.getCurrentProgramAndTimeElapsed(Date.now(), channel)
            lineup = helper.createLineup(prog)
            if (!lineup.length) throw new Error('Empty lineup')
        } catch (err) {
            console.error('Channel schedule error:', err.message)
            return res.status(422).send('Invalid channel schedule')
        }

        const remux = new FFMPEG(settings, channel)
        let closed = false
        let advanceScheduled = false
        res.setHeader('Content-Type', 'video/mp2t')
        res.setHeader('Cache-Control', 'no-store, no-transform')
        res.setHeader('X-Accel-Buffering', 'no')

        const close = () => {
            if (closed) return
            closed = true
            remux.kill()
        }
        const fail = err => {
            if (closed) return
            console.error(`PseudoTV channel ${channel.number}:`, err.message || err.code || err)
            if (!res.headersSent) res.status(502).end('Direct stream unavailable or codec unsupported in MPEG-TS')
            else res.destroy()
            close()
        }
        const advance = () => {
            if (closed || advanceScheduled) return
            advanceScheduled = true
            setImmediate(() => {
                advanceScheduled = false
                if (closed) return
                try {
                    if (!lineup.length) {
                        // Advance deterministically; don't rediscover the outgoing item
                        // from the wall clock at a slightly early FFmpeg EOF.
                        const nextIndex = (prog.programIndex + 1) % channel.programs.length
                        prog = { programIndex: nextIndex, program: channel.programs[nextIndex], timeElapsed: 0 }
                        lineup = helper.createLineup(prog)
                        if (!lineup.length) throw new Error('Empty next programme')
                    }
                    remux.spawn(lineup.shift())
                } catch (err) { fail(err) }
            })
        }
        remux.on('data', chunk => {
            if (!closed && !res.destroyed && !res.write(chunk)) remux.pause()
        })
        res.on('drain', () => remux.resume())
        remux.on('error', fail)
        remux.on('end', advance)
        remux.on('close', () => {
            if (!closed && !res.writableEnded) { res.end(); close() }
        })
        req.on('aborted', close)
        res.on('close', close)
        advance()
    }

    // No channel configured: return a diagnostic HTTP response instead of generating
    // synthetic H264/MPEG2 video (strict Direct Stream mode has no synthetic encoder).
    router.get('/setup', (_req, res) => res.status(503).type('text/plain').send('Configure at least one Plex channel in PseudoTV Next'))
    router.get('/video', (req, res) => {
        const number = Number(req.query.channel)
        if (!Number.isInteger(number) || number < 1 || number > 65535) return res.status(400).send('Invalid channel')
        const channel = db['channels'].find({ number })[0]
        if (!channel) return res.status(404).send('Channel not found')
        return serveChannel(req, res, channel)
    })
    return router
}
