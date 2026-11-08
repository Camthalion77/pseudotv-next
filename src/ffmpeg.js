const { spawn } = require('child_process')
const { EventEmitter } = require('events')

// MPEG-TS remuxer. Video and audio are never decoded or re-encoded.
// Keep the public event interface used by src/video.js and HDHomeRun streams.
class FFMPEG extends EventEmitter {
    constructor(opts, channel) {
        super()
        this.opts = opts
        this.channel = channel
        this.ffmpegPath = opts.ffmpegPath
        this.offset = 0
        this.ffmpeg = null
        this.stopped = false
    }

    selectTrack(item, type, preference) {
        const streams = Array.isArray(item.streams) ? item.streams : []
        const candidates = streams.map((stream, position) => ({ stream, position }))
            .filter(({ stream }) => stream.streamType === type && Number.isInteger(Number(stream.index ?? 0)))
        const selectedPosition = Number(preference)
        const preferred = preference !== undefined && preference !== null &&
            String(preference) !== '-1' && String(preference) !== '-2'
            ? candidates.find(({ position, stream }) => position === selectedPosition || Number(stream.index) === selectedPosition)
            : null
        const match = preferred || candidates.find(({ stream }) => stream.selected || stream.default) || candidates[0]
        if (match) {
            // Plex stream.index is the absolute FFmpeg stream index when available.
            const index = Number(match.stream.index ?? match.position)
            return `0:${index}`
        }
        return type === 1 ? '0:v:0' : '0:a:0?'
    }

    spawn(item) {
        if (this.stopped) return
        if (!item || !item.file || !Number.isFinite(Number(item.duration)) || Number(item.duration) <= 0) {
            this.emit('error', { message: 'Invalid media item or duration' })
            return
        }
        const options = item.opts || {}
        const start = Math.max(0, Number(item.start) || 0) / 1000
        const duration = Number(item.duration) / 1000
        const videoMap = this.selectTrack(item, 1, options.videoIndex)
        const audioMap = this.selectTrack(item, 2, options.audioIndex)
        const args = [
            '-hide_banner', '-nostdin', '-loglevel', 'error',
            '-ss', String(start), '-re', '-i', item.file,
            '-t', String(duration),
            '-map', videoMap, '-map', audioMap,
            '-c:v', 'copy', '-c:a', 'copy',
            '-sn', '-dn',
            '-metadata', 'service_provider=PseudoTV',
            '-metadata', `service_name=${this.channel.name}`,
            '-f', 'mpegts',
            '-output_ts_offset', String(this.offset),
            'pipe:1'
        ]
        this.offset += duration
        const child = spawn(this.ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
        this.ffmpeg = child
        let errorDetails = ''
        child.stdout.on('data', chunk => this.emit('data', chunk))
        child.stderr.on('data', chunk => {
            if (this.opts.logFfmpeg) process.stderr.write(chunk)
            errorDetails = (errorDetails + chunk.toString()).slice(-2048)
        })
        child.on('error', err => {
            this.emit('error', { message: err.message })
        })
        child.on('close', code => {
            if (this.ffmpeg === child) this.ffmpeg = null
            if (this.stopped || code === null || code === 255) this.emit('close', code)
            else if (code === 0) this.emit('end')
            else this.emit('error', { code, message: errorDetails.trim() || 'FFmpeg remux failed' })
        })
    }

    kill() {
        this.stopped = true
        if (this.ffmpeg && !this.ffmpeg.killed) this.ffmpeg.kill()
    }
}

module.exports = FFMPEG
