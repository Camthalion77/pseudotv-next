'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const FFMPEG = require('../src/ffmpeg')
const { getPCR, getPTS, pidOf, pcrOffset, pesTimeOffset } = require('../src/mpegts')
const helper = require('../src/helperFuncs')

function run(command, args) {
    const r = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 6 * 1024 * 1024 })
    assert.equal(r.status, 0, r.stderr || `${command} failed`)
    return r.stdout
}
function packets(data) {
    assert.equal(data.length % 188, 0)
    const result = []
    for (let i = 0; i < data.length; i += 188) {
        assert.equal(data[i], 0x47)
        result.push(data.subarray(i, i + 188))
    }
    return result
}
function streamItem(engine, file, duration = 1200) {
    return new Promise((resolve, reject) => {
        const result = []
        const onData = x => result.push(x)
        const done = () => { engine.off('data', onData); engine.off('error', fail); engine.off('end', success) }
        const fail = error => { done(); reject(new Error(JSON.stringify(error))) }
        const success = () => { done(); resolve(Buffer.concat(result)) }
        engine.on('data', onData)
        engine.once('error', fail)
        engine.once('end', success)
        engine.spawn({ file, duration, start: 0, streams: [], opts: {} })
    })
}
const available = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0

test('strict stream-copy: codecs unchanged; PIDs, continuity and PCR times remain coherent across clips', {skip: !available}, async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pseudotv-complete-'))
    try {
        const engine = new FFMPEG({ffmpegPath: 'ffmpeg', logFfmpeg: false}, {number: 101, name: 'Cinema'})
        const segments = []
        for (let i = 0; i < 3; i++) {
            const input = path.join(tmp, `src${i}.ts`)
            run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
                `testsrc2=size=320x240:rate=25:duration=1.2`, '-f', 'lavfi', '-i',
                'sine=frequency=440:sample_rate=48000:duration=1.2', '-c:v', 'mpeg2video',
                '-c:a', 'mp2', '-f', 'mpegts', input])
            const output = await streamItem(engine, input)
            segments.push(output)
            const probeFile = path.join(tmp, `output${i}.ts`)
            fs.writeFileSync(probeFile, output)
            const metadata = JSON.parse(run('ffprobe', ['-v', 'error', '-show_entries',
                'stream=codec_name,codec_type', '-of', 'json', probeFile]))
            assert.equal(metadata.streams.find(x => x.codec_type === 'video').codec_name, 'mpeg2video')
            assert.equal(metadata.streams.find(x => x.codec_type === 'audio').codec_name, 'mp2')
        }
        engine.kill()
        const all = packets(Buffer.concat(segments))
        const pids = new Set(all.map(pidOf))
        for (const pid of [0, 4096, 256, 257]) assert.ok(pids.has(pid), `PID ${pid}`)
        const lastCounter = new Map()
        for (const p of all) {
            const pid = pidOf(p)
            const af = (p[3] >>> 4) & 3
            if (af & 1) {
                if (lastCounter.has(pid)) assert.equal(p[3] & 15, (lastCounter.get(pid) + 1) & 15, `PID ${pid} counter`)
                lastCounter.set(pid, p[3] & 15)
            }
        }
        const pcrs = all.filter(p => pcrOffset(p) >= 0).map(p => getPCR(p, pcrOffset(p)))
        assert.ok(pcrs.length > 3)
        for (let i = 1; i < pcrs.length; i++) {
            const diff = (pcrs[i] - pcrs[i-1] + 2**33) % (2**33)
            assert.ok(diff < 90000 * 2, `PCR jump ${diff / 90000} seconds`)
        }
        const pts = all.filter(p => pesTimeOffset(p) >= 0).map(p => getPTS(p, pesTimeOffset(p)))
        assert.ok(pts.length > 3)
        fs.writeFileSync(path.join(tmp, 'joined.ts'), Buffer.concat(segments))
        run('ffprobe', ['-v', 'error', '-show_programs', path.join(tmp, 'joined.ts')])
    } finally { fs.rmSync(tmp, {recursive: true, force: true}) }
})

test('programme scheduling merges adjacent movie quarters and advances deterministically', () => {
    const movie = {file: 'http://example/plex1', actualDuration: 8000, duration: 8000, streams: [], opts: {}}
    assert.deepEqual(helper.createLineup({program: movie, timeElapsed: 3000}).map(x => [x.start, x.duration]), [[3000, 5000]])
    assert.deepEqual(helper.createLineup({program: movie, timeElapsed: 0}).map(x => [x.start, x.duration]), [[0, 8000]])
    const channel = {startTime: '2020-01-01T00:00:00Z', duration: 16000, programs: [movie, movie]}
    const p = helper.getCurrentProgramAndTimeElapsed(Date.parse(channel.startTime) + 9000, channel)
    assert.equal(p.programIndex, 1)
    assert.equal(p.timeElapsed, 1000)
})

test('FFmpeg arguments are immutable direct-copy and optional audio track is explicit', () => {
    const e = new FFMPEG({ffmpegPath:'ffmpeg'}, {number:1,name:'Test'})
    assert.equal(e.selectTrack({streams:[]}, 1, '-1'), '0:v:0')
    assert.equal(e.selectTrack({streams:[]}, 2, '-1'), '0:a:0?')
    assert.equal(e.selectTrack({streams:[{streamType:1,index:0},{streamType:2,index:1,selected:true}]}, 2, '-1'), '0:1')
})
