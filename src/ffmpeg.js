'use strict'
const { spawn } = require('node:child_process')
const { EventEmitter } = require('node:events')
const { MpegTsJoiner } = require('./mpegts')

// Each active viewer receives the channel's current programme, direct-copy only.
// The joiner keeps transport continuity across separate FFmpeg muxing sessions.
class FFMPEG extends EventEmitter {
    constructor(opts, channel) {
        super()
        this.opts = opts || {}
        this.channel = channel
        this.ffmpegPath = opts.ffmpegPath
        this.ts = new MpegTsJoiner()
        this.ffmpeg = null
        this.stopped = false
    }

    selectTrack(item, type, preference) {
        const streams = Array.isArray(item.streams) ? item.streams : []
        const candidates = streams.map((stream, position) => ({ stream, position })).filter(({ stream }) => Number(stream.streamType) === type)
        const prefer = String(preference)
        const preferred = preference !== undefined && preference !== null && prefer !== '-1' && prefer !== '-2'
            ? candidates.find(({ position, stream }) => position === Number(preference) || Number(stream.index) === Number(preference))
            : null
        const chosen = preferred || candidates.find(({ stream }) => stream.selected || stream.default) || candidates[0]
        if (chosen && Number.isInteger(Number(chosen.stream.index)) && Number(chosen.stream.index) >= 0)
            return `0:${chosen.stream.index}`
        // Fallback by stream type when Plex index is absent (never guess an absolute index).
        return type === 1 ? '0:v:0' : '0:a:0?'
    }

    // Only embedded DVB bitmap subtitles are safe to stream-copy to MPEG-TS.
    // Legacy -2 and default -1 mean auto compatible; -3 means explicitly off.
    selectCompatibleSubtitle(item, preference) {
        if (String(preference) === '-3') return null
        const streams = Array.isArray(item.streams) ? item.streams : []
        const compatible = streams.filter(stream => {
            const codec = String(stream.codec || stream.codecName || '').toLowerCase().trim().replace(/[\s-]/g, '_')
            return Number(stream.streamType) === 3 && !stream.key && !stream.external &&
                (codec === 'dvbsub' || codec === 'dvb_subtitle') &&
                Number.isInteger(Number(stream.index)) && Number(stream.index) >= 0
        })
        const explicit = preference !== undefined && preference !== null &&
            !['', '-1', '-2', '-3'].includes(String(preference))
        const rank = stream => {
            const lang = String(stream.language || stream.languageCode || '').toLowerCase()
            if (['ell', 'gre', 'el'].includes(lang)) return 0
            if (['eng', 'en'].includes(lang)) return 1
            return 2
        }
        const chosen = explicit
            ? compatible.find(stream => Number(stream.index) === Number(preference))
            : compatible.slice().sort((a, b) => rank(a) - rank(b))[0]
        if (!chosen) return null
        const lang = String(chosen.language || chosen.languageCode || '').toLowerCase()
        const language = ['ell','gre','el'].includes(lang) ? 'ell' :
            ['eng','en'].includes(lang) ? 'eng' : 'und'
        return { map: `0:${Number(chosen.index)}`, language }
    }

    spawn(item) {
        if (this.stopped) return
        if (!item || typeof item.file !== 'string' || !item.file ||
            !Number.isFinite(Number(item.duration)) || Number(item.duration) <= 0 ||
            !Number.isFinite(Number(item.start)) || Number(item.start) < 0) {
            this.emit('error', { message: 'Invalid Plex media URL or programme timing' })
            return
        }
        if (this.ffmpeg) {
            this.emit('error', { message: 'Attempted overlapping FFmpeg sessions' })
            return
        }
        const opts = item.opts || {}
        const subtitle = this.selectCompatibleSubtitle(item, opts.subtitleIndex)
        const args = [
            '-hide_banner', '-nostdin', '-loglevel', 'error',
            '-ss', String(Number(item.start) / 1000), '-re', '-i', item.file,
            '-t', String(Number(item.duration) / 1000),
            '-map', this.selectTrack(item, 1, opts.videoIndex),
            '-map', this.selectTrack(item, 2, opts.audioIndex),
            '-c:v', 'copy', '-c:a', 'copy',
            ...(subtitle ? ['-map', subtitle.map, '-c:s', 'copy',
                '-metadata:s:s:0', `language=${subtitle.language}`] : ['-sn']),
            '-dn',
            '-metadata', 'service_provider=PseudoTV Next',
            '-metadata', `service_name=${this.channel.name}`,
            '-mpegts_service_id', String(Math.max(1, Math.min(65535, Number(this.channel.number) || 1))),
            '-mpegts_start_pid', '256', '-mpegts_pmt_start_pid', '4096',
            '-mpegts_flags', '+resend_headers', '-pat_period', '0.1', '-sdt_period', '0.5',
            '-muxdelay', '0', '-muxpreload', '0', '-f', 'mpegts', 'pipe:1'
        ]
        this.ts.beginSegment()
        const child = spawn(this.ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
        this.ffmpeg = child
        let failure = false
        let stderr = ''
        child.stdout.on('data', chunk => {
            if (this.stopped || failure) return
            try {
                const result = this.ts.feed(chunk)
                if (result.length) this.emit('data', result)
            } catch (e) {
                failure = true
                this.emit('error', { message: e.message })
                child.kill()
            }
        })
        child.stderr.on('data', chunk => {
            stderr = (stderr + chunk.toString()).slice(-4096)
            if (this.opts.logFfmpeg) process.stderr.write(chunk)
        })
        child.once('error', err => {
            if (!failure && !this.stopped) {
                failure = true
                this.emit('error', { message: err.message })
            }
        })
        child.once('close', code => {
            if (this.ffmpeg === child) this.ffmpeg = null
            if (this.stopped || failure) { this.emit('close', code); return }
            if (code !== 0) {
                this.emit('error', { code, message: stderr.trim().replace(/X-Plex-Token=[^\s&]+/g, 'X-Plex-Token=REDACTED') || 'MPEG-TS remux failed' })
                return
            }
            try {
                const tail = this.ts.endSegment()
                if (tail.length) this.emit('data', tail)
                this.emit('end')
            } catch (err) { this.emit('error', { message: err.message }) }
        })
    }
    pause() { if (this.ffmpeg && this.ffmpeg.stdout) this.ffmpeg.stdout.pause() }
    resume() { if (this.ffmpeg && this.ffmpeg.stdout) this.ffmpeg.stdout.resume() }
    kill() {
        this.stopped = true
        if (this.ffmpeg && !this.ffmpeg.killed) this.ffmpeg.kill()
    }
}
module.exports = FFMPEG
