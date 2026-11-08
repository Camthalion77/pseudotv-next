'use strict'
module.exports = {
    getCurrentProgramAndTimeElapsed,
    createLineup
}

function getCurrentProgramAndTimeElapsed(date, channel) {
    if (!Array.isArray(channel.programs) || !channel.programs.length) throw new Error('Channel has no programmes')
    const cycle = Number(channel.duration)
    const start = new Date(channel.startTime).getTime()
    if (!Number.isFinite(start) || !Number.isFinite(cycle) || cycle <= 0 || start > date) throw new Error('Invalid channel start or duration')
    let elapsed = (Number(date) - start) % cycle
    for (let index = 0; index < channel.programs.length; index++) {
        const duration = Number(channel.programs[index].duration)
        if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid programme duration')
        if (elapsed < duration) return { program: channel.programs[index], timeElapsed: elapsed, programIndex: index }
        elapsed -= duration
    }
    throw new Error('Programme durations do not match channel cycle')
}

// Existing commercial scheduling remains supported, without forcing commercials
// or requiring the adverts array to be present in imported Plex metadata.
function createLineup({ program, timeElapsed }) {
    if (!program || !program.file) throw new Error('Missing Plex media URL')
    const mediaDuration = Number(program.actualDuration)
    if (!(mediaDuration > 0)) throw new Error('Invalid programme media duration')
    const slots = [[], [], [], [], []]
    for (const item of program.commercials || []) {
        if (!Number.isInteger(item.commercialPosition) || item.commercialPosition < 0 || item.commercialPosition > 4) continue
        slots[item.commercialPosition].push(item)
    }
    const pieces = []
    const add = (source, type, start, duration) => {
        if (duration > 0) pieces.push({ type, file: source.file, streams: source.streams || [], start, duration, opts: source.opts || {} })
    }
    for (let i = 0; i < 5; i++) {
        for (const commercial of slots[i]) add(commercial, 'commercial', 0, Number(commercial.duration))
        if (i < 4) {
            const begin = mediaDuration * i / 4
            add(program, 'program', begin, mediaDuration * (i + 1) / 4 - begin)
        }
    }
    let position = Math.max(0, Number(timeElapsed) || 0)
    const current = []
    for (const piece of pieces) {
        if (position >= piece.duration) { position -= piece.duration; continue }
        const adjusted = { ...piece, start: piece.start + position, duration: piece.duration - position }
        position = 0
        // Merge consecutive parts of the same original video: avoids artificial
        // FFmpeg process boundaries at 25/50/75% of each feature.
        const previous = current[current.length - 1]
        if (previous && previous.type === adjusted.type && previous.file === adjusted.file &&
            Math.abs(previous.start + previous.duration - adjusted.start) < 1) previous.duration += adjusted.duration
        else current.push(adjusted)
    }
    return current
}
