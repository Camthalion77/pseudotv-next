'use strict'

// Normalise independently muxed MPEG-TS segments into one HTTP transport stream.
// Only transport headers and timestamps are rewritten; ES video/audio bytes are untouched.
const PACKET = 188
const CLOCK_WRAP = 2 ** 33
const STEP = 9000 // 100ms between successive segment PCR positions (90 kHz)

function pidOf(p) { return ((p[1] & 31) << 8) | p[2] }
function pcrOffset(p) {
    if (!(p[3] & 0x20)) return -1
    const len = p[4]
    if (len < 7 || !(p[5] & 0x10)) return -1
    return 6
}
function getPCR(p, i) {
    return p[i] * 2 ** 25 + p[i+1] * 2 ** 17 + p[i+2] * 2 ** 9 + p[i+3] * 2 + (p[i+4] >>> 7)
}
function setPCR(p, i, base) {
    base = ((base % CLOCK_WRAP) + CLOCK_WRAP) % CLOCK_WRAP
    const ext = ((p[i+4] & 1) << 8) | p[i+5]
    p[i] = Math.floor(base / 2**25) & 255
    p[i+1] = Math.floor(base / 2**17) & 255
    p[i+2] = Math.floor(base / 2**9) & 255
    p[i+3] = Math.floor(base / 2) & 255
    p[i+4] = ((base % 2) << 7) | 0x7e | (ext >>> 8)
    p[i+5] = ext & 255
}
function pesTimeOffset(p) {
    if (!(p[1] & 0x40) || !(p[3] & 0x10)) return -1
    const adaptation = (p[3] & 0x20) ? 1 + p[4] : 0
    const i = 4 + adaptation
    if (i + 14 > PACKET || p[i] !== 0 || p[i+1] !== 0 || p[i+2] !== 1) return -1
    if ((p[i+7] & 0xc0) === 0) return -1
    return i + 9
}
function getPTS(p, i) {
    return ((p[i] >>> 1) & 7) * 2**30 + p[i+1] * 2**22 + (p[i+2] >>> 1) * 2**15 + p[i+3] * 2**7 + (p[i+4] >>> 1)
}
function setPTS(p, i, time) {
    time = ((time % CLOCK_WRAP) + CLOCK_WRAP) % CLOCK_WRAP
    p[i] = (p[i] & 0xf0) | ((Math.floor(time / 2**30) & 7) << 1) | 1
    p[i+1] = Math.floor(time / 2**22) & 255
    p[i+2] = ((Math.floor(time / 2**15) & 127) << 1) | 1
    p[i+3] = Math.floor(time / 2**7) & 255
    p[i+4] = ((time % 128) << 1) | 1
}

class MpegTsJoiner {
    constructor() {
        this.counters = new Map()
        this.lastPCR = null
        this.lastPTS = null
        this.partial = Buffer.alloc(0)
        this.pending = []
        this.delta = null
        this.first = true
    }
    beginSegment() {
        if (this.partial.length) throw new Error('Incomplete MPEG-TS packet at segment boundary')
        if (this.pending.length) throw new Error('Pending MPEG-TS packets at segment boundary')
        this.delta = this.first ? 0 : null
        this.first = false
    }
    // Feed a chunk from an FFmpeg process; returns a Buffer of complete packets.
    feed(chunk) {
        const input = this.partial.length ? Buffer.concat([this.partial, chunk]) : chunk
        const output = []
        let pos = 0
        while (pos + PACKET <= input.length) {
            const p = Buffer.from(input.subarray(pos, pos + PACKET))
            pos += PACKET
            if (p[0] !== 0x47) throw new Error('MPEG-TS sync byte missing')
            this.pending.push(p)
            if (this.delta === null) {
                const ix = pcrOffset(p)
                const pi = pesTimeOffset(p)
                if (ix >= 0) this.delta = (this.lastPCR ?? this.lastPTS ?? 0) + STEP - getPCR(p, ix)
                else if (pi >= 0 && this.pending.length >= 128) {
                    this.delta = (this.lastPTS ?? this.lastPCR ?? 0) + STEP - getPTS(p, pi)
                }
            }
            if (this.delta !== null) {
                for (const q of this.pending) output.push(this.rewrite(q))
                this.pending = []
            }
        }
        this.partial = Buffer.from(input.subarray(pos))
        return output.length ? Buffer.concat(output) : Buffer.alloc(0)
    }
    rewrite(p) {
        const pid = pidOf(p)
        const adaptation = (p[3] >>> 4) & 3
        if (adaptation === 0) throw new Error('Reserved MPEG-TS adaptation control')
        const ix = pcrOffset(p)
        if (ix >= 0) {
            const newTime = getPCR(p, ix) + this.delta
            setPCR(p, ix, newTime)
            this.lastPCR = ((newTime % CLOCK_WRAP) + CLOCK_WRAP) % CLOCK_WRAP
        }
        const pi = pesTimeOffset(p)
        if (pi >= 0) {
            const original = getPTS(p, pi)
            const shifted = original + this.delta
            setPTS(p, pi, shifted)
            this.lastPTS = ((shifted % CLOCK_WRAP) + CLOCK_WRAP) % CLOCK_WRAP
            const header = pi - 9
            if ((p[header+7] & 0xc0) === 0xc0 && header + 19 <= PACKET) {
                setPTS(p, pi + 5, getPTS(p, pi + 5) + this.delta)
            }
        }
        if (adaptation & 1) {
            const next = this.counters.get(pid) ?? 0
            p[3] = (p[3] & 0xf0) | next
            this.counters.set(pid, (next + 1) & 15)
        } else {
            p[3] = (p[3] & 0xf0) | ((this.counters.get(pid) ?? 1) + 15 & 15)
        }
        return p
    }
    endSegment() {
        if (this.partial.length) throw new Error('FFmpeg ended with an incomplete MPEG-TS packet')
        if (this.delta === null) {
            // No timestamps found: forward SI-only segments without time manipulation.
            this.delta = 0
            const result = Buffer.concat(this.pending.map(p => this.rewrite(p)))
            this.pending = []
            return result
        }
        return Buffer.alloc(0)
    }
}
module.exports = { MpegTsJoiner, getPCR, getPTS, pidOf, pcrOffset, pesTimeOffset }
