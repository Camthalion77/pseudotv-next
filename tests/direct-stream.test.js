'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const FFMPEG = require('../src/ffmpeg')

const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg'
const ffprobePath = process.env.FFPROBE_PATH || 'ffprobe'
const available = spawnSync(ffmpegPath, ['-version']).status === 0 &&
    spawnSync(ffprobePath, ['-version']).status === 0

function run(command, args) {
    const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
    assert.equal(result.status, 0, result.stderr || 'Media utility failed')
    return result.stdout
}

function packetPids(buffer) {
    const pids = new Set()
    assert.equal(buffer.length % 188, 0, 'Output must consist of complete MPEG-TS packets')
    for (let i = 0; i < buffer.length; i += 188) {
        assert.equal(buffer[i], 0x47, 'Every MPEG-TS packet must have a sync byte')
        pids.add(((buffer[i+1] & 0x1f) << 8) | buffer[i+2])
    }
    return pids
}

function runItem(engine, item) {
    return new Promise((resolve, reject) => {
        const chunks = []
        const onData = chunk => chunks.push(chunk)
        const onError = err => cleanup(() => reject(new Error(JSON.stringify(err))))
        const onEnd = () => cleanup(() => resolve(Buffer.concat(chunks)))
        const cleanup = callback => {
            engine.off('data', onData)
            engine.off('error', onError)
            engine.off('end', onEnd)
            callback()
        }
        engine.on('data', onData)
        engine.once('error', onError)
        engine.once('end', onEnd)
        engine.spawn(item)
    })
}

test('consecutive programmes remain MPEG-TS with unchanged codecs and stable PIDs', {skip: !available}, async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pseudotv-next-'))
    try {
        const engine = new FFMPEG({ ffmpegPath, logFfmpeg: false }, { number: 101, name: 'Test Cinema' })
        const outputs = []
        for (let i = 0; i < 2; i++) {
            const file = path.join(tmp, `clip-${i}.ts`)
            run(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=320x240:rate=25:duration=1.4`,
                '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1.4',
                '-c:v', 'mpeg2video', '-c:a', 'mp2', '-f', 'mpegts', file])
            const item = { file, start: 0, duration: 1400, streams: [], opts: {} }
            const output = await runItem(engine, item)
            const outFile = path.join(tmp, `out-${i}.ts`)
            fs.writeFileSync(outFile, output)
            outputs.push(output)
            const metadata = JSON.parse(run(ffprobePath, ['-v', 'error', '-show_entries', 'stream=codec_name,codec_type', '-of', 'json', outFile]))
            assert.equal(metadata.streams.find(s => s.codec_type === 'video').codec_name, 'mpeg2video')
            assert.equal(metadata.streams.find(s => s.codec_type === 'audio').codec_name, 'mp2')
            const pids = packetPids(output)
            assert.ok(pids.has(0), 'PAT must exist')
            assert.ok(pids.has(4096), 'PMT PID must be fixed')
            assert.ok(pids.has(256), 'Video PID must be fixed')
            assert.ok(pids.has(257), 'Audio PID must be fixed')
        }
        assert.deepEqual([...packetPids(outputs[0])].sort(), [...packetPids(outputs[1])].sort())
        fs.writeFileSync(path.join(tmp,'combined.ts'), Buffer.concat(outputs))
        assert.ok(fs.statSync(path.join(tmp,'combined.ts')).size > 0)
        engine.kill()
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true })
    }
})
