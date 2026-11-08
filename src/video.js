const express = require('express')
const helperFuncs = require('./helperFuncs')
const FFMPEG = require('./ffmpeg')
const FFMPEG_TEXT = require('./ffmpegText')
const fs = require('fs')

module.exports = { router: video }

function video(db) {
    const router = express.Router()

    // Keep the original setup stream and HDHomeRun endpoint contract.
    router.get('/setup', (req, res) => {
        const settings = db['ffmpeg-settings'].find()[0]
        if (!fs.existsSync(settings.ffmpegPath)) return res.status(500).send('FFmpeg not found')
        const ffmpeg = new FFMPEG_TEXT(settings, 'PseudoTV (No Channels Configured)', 'Configure your channels using the PseudoTV Web UI')
        let closed = false
        ffmpeg.on('data', chunk => { if (!closed && !res.destroyed) res.write(chunk) })
        ffmpeg.on('error', err => {
            console.error('Setup FFmpeg error', err)
            if (!res.headersSent) res.status(500).end('Setup stream failed')
            else res.destroy()
        })
        ffmpeg.on('close', () => { if (!res.writableEnded) res.end() })
        res.on('close', () => { closed = true; ffmpeg.kill() })
    })

    router.get('/video', (req, res) => {
        const number = Number(req.query.channel)
        if (!Number.isInteger(number) || number <= 0) return res.status(400).send('Invalid channel')
        const channel = db['channels'].find({ number })[0]
        if (!channel) return res.status(404).send('Channel not found')
        const settings = db['ffmpeg-settings'].find()[0]
        if (!settings || !fs.existsSync(settings.ffmpegPath)) return res.status(500).send('FFmpeg not found')

        let prog, lineup
        try {
            prog = helperFuncs.getCurrentProgramAndTimeElapsed(Date.now(), channel)
            lineup = helperFuncs.createLineup(prog)
            if (!lineup.length) throw new Error('Empty channel lineup')
        } catch (err) {
            console.error('Invalid channel schedule', err)
            return res.status(422).send('Invalid channel schedule')
        }

        res.setHeader('Content-Type', 'video/mp2t')
        res.setHeader('Cache-Control', 'no-store')
        const ffmpeg = new FFMPEG(settings, channel)
        let closed = false
        ffmpeg.on('data', chunk => {
            if (!closed && !res.destroyed) res.write(chunk)
        })
        ffmpeg.on('error', err => {
            console.error(`Channel ${number} remux error`, err)
            if (!res.headersSent) res.status(502).end('Media cannot be remuxed as MPEG-TS')
            else res.destroy()
            ffmpeg.kill()
        })
        ffmpeg.on('close', () => {
            if (!res.writableEnded) res.end()
        })
        ffmpeg.on('end', () => {
            if (closed) return
            if (lineup.length === 0) {
                try {
                    prog = helperFuncs.getCurrentProgramAndTimeElapsed(Date.now(), channel)
                    lineup = helperFuncs.createLineup(prog)
                    if (!lineup.length) throw new Error('Empty channel lineup')
                } catch (err) {
                    console.error(`Channel ${number} schedule error`, err)
                    return res.destroy()
                }
            }
            ffmpeg.spawn(lineup.shift())
        })
        res.on('close', () => { closed = true; ffmpeg.kill() })
        ffmpeg.spawn(lineup.shift())
    })
    return router
}
