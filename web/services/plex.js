const Plex = require('../../src/plex')
module.exports = function ($http, $window, $interval) {
    const proxiedPlex = server => ({
        Get: path => $http.get('/api/plex-library/' + encodeURIComponent(server._id), {
            params: { path }, timeout: 20000
        }).then(response => response.data)
    })
    const plexArt = (server, imagePath) => imagePath
        ? '/api/plex-art/' + encodeURIComponent(server._id) + '?path=' + encodeURIComponent(imagePath)
        : ''
    return {
        login: async (plex) => {
            const headers = {
                'Accept': 'application/json',
                'X-Plex-Product': 'PseudoTV Next',
                'X-Plex-Version': '1.0',
                'X-Plex-Client-Identifier': 'rg14zekk3pa5zp4safjwaa8z',
                'X-Plex-Model': 'PseudoTV Next'
            }
            const pinResponse = await $http({
                method: 'POST',
                url: 'https://plex.tv/api/v2/pins?strong=true',
                headers
            })
            const pin = pinResponse.data
            if (!pin || !pin.id || !pin.code) throw new Error('Plex did not return an authorization code')
            const authURL = 'https://app.plex.tv/auth/#!?clientID=rg14zekk3pa5zp4safjwaa8z' +
                '&context[device][version]=1.0&context[device][model]=PseudoTV%20Next' +
                '&context[device][product]=PseudoTV%20Next&code=' + encodeURIComponent(pin.code)
            const popup = $window.open(authURL, '_blank')
            if (!popup) throw new Error('Allow popups to authorize your Plex account')
            return new Promise((resolve, reject) => {
                let busy = false
                let settled = false
                const finish = (error, result) => {
                    if (settled) return
                    settled = true
                    $interval.cancel(polling)
                    $interval.cancel(timeout)
                    if (error) reject(error)
                    else resolve(result)
                }
                const polling = $interval(async () => {
                    if (busy || settled) return
                    busy = true
                    try {
                        const status = await $http({
                            method: 'GET',
                            url: `https://plex.tv/api/v2/pins/${pin.id}`,
                            headers
                        })
                        const token = status.data && status.data.authToken
                        if (typeof token === 'string' && token.length) {
                            const checked = await $http.post('/api/plex-verify', {
                                protocol: plex.protocol,
                                host: plex.host,
                                port: plex.port,
                                token
                            })
                            finish(null, { token, name: checked.data.name })
                        }
                    } catch (err) {
                        const serverError = err && err.data && err.data.error
                        if (serverError) finish(new Error(serverError))
                        else if (err.status && err.status !== 404) finish(new Error('Plex authentication failed; check the browser console'))
                    } finally {
                        busy = false
                    }
                }, 2000)
                const timeout = $interval(() => finish(new Error('Plex sign-in timed out (2 minutes)')), 120000, 1)
            })
        },
        getLibrary: async (server) => {
            var client = proxiedPlex(server)
            const res = await client.Get('/library/sections')
            var sections = []
            for (let i = 0, l = typeof res.Directory !== 'undefined' ? res.Directory.length : 0; i < l; i++)
                if (res.Directory[i].type === 'movie' || res.Directory[i].type === 'show')
                    sections.push({
                        title: res.Directory[i].title,
                        key: `/library/sections/${res.Directory[i].key}/all`,
                        icon: plexArt(server, res.Directory[i].composite),
                        type: res.Directory[i].type
                    })
            return sections
        },
        getPlaylists: async (server) => {
            var client = proxiedPlex(server)
            const res = await client.Get('/playlists')
            var playlists = []
            for (let i = 0, l = typeof res.Metadata !== 'undefined' ? res.Metadata.length : 0; i < l; i++)
                if (res.Metadata[i].playlistType === 'video')
                    playlists.push({
                        title: res.Metadata[i].title,
                        key: res.Metadata[i].key,
                        icon: plexArt(server, res.Metadata[i].composite),
                        duration: res.Metadata[i].duration
                    })
            return playlists
        },
        getStreams: async (server, key) => {
            var client = proxiedPlex(server)
            return client.Get(key).then((res) => { 
                let streams =  res.Metadata[0].Media[0].Part[0].Stream
                for (let i = 0, l = streams.length; i < l; i++) {
                    if (typeof streams[i].key !== 'undefined') {
                        streams[i].key = `${server.protocol}://${server.host}:${server.port}${streams[i].key}?X-Plex-Token=${server.token}`
                    }
                }
                return streams
            })
        },
        getNested: async (server, key) => {
            var client = proxiedPlex(server)
            const res = await client.Get(key)
            var nested = []
            for (let i = 0, l = typeof res.Metadata !== 'undefined' ? res.Metadata.length : 0; i < l; i++) {
                // Skip any videos (movie or episode) without a duration set...
                if (typeof res.Metadata[i].duration === 'undefined' && (res.Metadata[i].type === "episode" || res.Metadata[i].type === "movie"))
                    continue
                if (res.Metadata[i].duration <= 0 && (res.Metadata[i].type === "episode" || res.Metadata[i].type === "movie"))
                    continue
                var program = {
                    title: res.Metadata[i].title,
                    key: res.Metadata[i].key,
                    server: server,
                    icon: plexArt(server, res.Metadata[i].thumb),
                    type: res.Metadata[i].type,
                    duration: res.Metadata[i].duration,
                    actualDuration: res.Metadata[i].duration,
                    durationStr: msToTime(res.Metadata[i].duration),
                    subtitle: res.Metadata[i].subtitle,
                    summary: res.Metadata[i].summary,
                    rating: res.Metadata[i].contentRating,
                    date: res.Metadata[i].originallyAvailableAt,
                    year: res.Metadata[i].year,
                }
                if (program.type === 'episode' || program.type === 'movie') {
                    program.file = `${server.protocol}://${server.host}:${server.port}${res.Metadata[i].Media[0].Part[0].key}?X-Plex-Token=${server.token}`
                    program.opts = { deinterlace: false, videoIndex: '-1', audioIndex: '-1', subtitleIndex: '-2' }
                }
                if (program.type === 'episode') {
                    program.showTitle = res.Metadata[i].grandparentTitle
                    program.episode = res.Metadata[i].index
                    program.season = res.Metadata[i].parentIndex
                    program.icon = plexArt(server, res.Metadata[i].grandparentThumb)
                    program.episodeIcon = plexArt(server, res.Metadata[i].thumb)
                    program.seasonIcon = plexArt(server, res.Metadata[i].parentThumb)
                    program.showIcon = plexArt(server, res.Metadata[i].grandparentThumb)
                }
                else if (program.type === 'movie') {
                    program.showTitle = res.Metadata[i].title
                    program.episode = 1
                    program.season = 1
                }
                nested.push(program)
            }
            return nested
        }
    }
}

function msToTime(duration) {
    var milliseconds = parseInt((duration % 1000) / 100),
        seconds = Math.floor((duration / 1000) % 60),
        minutes = Math.floor((duration / (1000 * 60)) % 60),
        hours = Math.floor((duration / (1000 * 60 * 60)) % 24);

    hours = (hours < 10) ? "0" + hours : hours;
    minutes = (minutes < 10) ? "0" + minutes : minutes;
    seconds = (seconds < 10) ? "0" + seconds : seconds;

    return hours + ":" + minutes + ":" + seconds + "." + milliseconds;
}
